//! Destructive-action safety policy — the enforced redline layer.
//!
//! See `apps/desktop/src-tauri/docs/safety-policy.md` for the full rationale.
//! In short: deletions inside *protected trees* must be **inspected before
//! deleted** (the Claude Code read-before-edit precedent), wildcard sweeps over
//! those trees are rejected outright, and a tiny *hard-deny* floor refuses a
//! handful of machine-ending actions even when reaffirmed.
//!
//! This module is **pure and deterministic**: it parses a command string and a
//! set of already-inspected paths, and returns a verdict. State (the
//! inspected-set) lives in the orchestrator, which mirrors the harness model —
//! the tool stays stateless, the harness holds the gate.

use std::collections::HashSet;

/// Protected trees — an approximation of "irreplaceable user data / app state."
/// Deletions targeting these require prior inspection; wildcard sweeps over them
/// are rejected. Stored tilde-rooted; matching expands `~` against the home dir.
pub const PROTECTED_TREES: &[&str] = &[
    "~/Library/Application Support",
    "~/Library/Containers",
    "~/Library/Group Containers",
    "~/Library/Messages",
    "~/Library/Mail",
    "~/Library/Mobile Documents",
    "~/Library/CloudStorage",
    "~/Library/Photos",
    "~/Pictures",
    "~/Documents",
    "~/Desktop",
    "~/Movies",
    "~/Music",
];

/// Path segments that mark regenerable data (caches/logs). A delete whose target
/// contains one of these is treated as regenerable even inside a protected tree,
/// so cache cleanup is never gated. Lowercased substring match.
pub const REGENERABLE_HINTS: &[&str] = &["/caches/", "/cache/", "/logs/", "/.cache/"];

/// Read-class command leaders that count as *inspection*. Running one of these
/// against a path records that path as inspected for the session.
const INSPECT_LEADERS: &[&str] = &["ls", "du", "find", "stat", "cat", "file", "tree", "head", "tail"];

/// The verdict the harness acts on.
#[derive(Debug, Clone, PartialEq)]
pub enum GateDecision {
    /// Not a protected-tree delete (or it's regenerable). Proceed to normal flow.
    Allow,
    /// Concrete delete inside a protected tree that hasn't been inspected.
    /// Carries a tip instructing the model to inspect first.
    RejectNeedsInspection { path: String, tip: String },
    /// Wildcard sweep over a protected tree. Never auto-clears.
    RejectWildcard { tree: String, tip: String },
    /// Machine-ending / identity-destroying action. Refused even if reaffirmed.
    HardDeny { reason: String },
}

impl GateDecision {
    /// True when the harness should stop the action and feed the tip back to
    /// the model instead of executing.
    pub fn is_rejection(&self) -> bool {
        !matches!(self, GateDecision::Allow)
    }

    /// The classification label for telemetry.
    pub fn classification(&self) -> &'static str {
        match self {
            GateDecision::Allow => "allow",
            GateDecision::RejectNeedsInspection { .. } => "inspect_then_delete",
            GateDecision::RejectWildcard { .. } => "reject_wildcard",
            GateDecision::HardDeny { .. } => "hard_deny",
        }
    }

    /// The message shown to the model when rejected (empty for Allow).
    pub fn message(&self) -> String {
        match self {
            GateDecision::Allow => String::new(),
            GateDecision::RejectNeedsInspection { tip, .. } => tip.clone(),
            GateDecision::RejectWildcard { tip, .. } => tip.clone(),
            GateDecision::HardDeny { reason } => reason.clone(),
        }
    }
}

/// Expand a leading `~` or `$HOME` against `home`. Leaves other paths untouched.
fn expand_home(path: &str, home: &str) -> String {
    let home = home.trim_end_matches('/');
    if let Some(rest) = path.strip_prefix("~/") {
        format!("{}/{}", home, rest)
    } else if path == "~" {
        home.to_string()
    } else if let Some(rest) = path.strip_prefix("$HOME/") {
        format!("{}/{}", home, rest)
    } else if path == "$HOME" {
        home.to_string()
    } else {
        path.to_string()
    }
}

/// Normalise for comparison: expand home, strip a trailing slash, lowercase
/// (macOS default volumes are case-insensitive — matches `is_dangerous_command`).
fn norm(path: &str, home: &str) -> String {
    let expanded = expand_home(path, home);
    let trimmed = expanded.trim_end_matches('/');
    // Don't collapse root "/" (or "///") into an empty string.
    if trimmed.is_empty() && expanded.starts_with('/') {
        return "/".to_string();
    }
    trimmed.to_lowercase()
}

/// True if `child` is `ancestor` or a descendant of it (both pre-normalised).
fn is_within(child: &str, ancestor: &str) -> bool {
    child == ancestor || child.starts_with(&format!("{}/", ancestor))
}

/// Does this path contain a glob metacharacter in a *path segment*? (We only
/// care about `*`, `?`, `[` — the unbounded-expansion forms.)
fn has_glob(path: &str) -> bool {
    path.contains('*') || path.contains('?') || path.contains('[')
}

/// Tokenise a single shell command into words, honouring backslash-escaped
/// spaces (`Application\ Support`) and single/double quotes. This is a pragmatic
/// tokenizer for *classification only*, not a full shell parser; it deliberately
/// errs toward keeping a path together so we don't under-detect a protected
/// target. Documented approximation — consistent with the policy.
fn tokenize(cmd: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut chars = cmd.chars().peekable();
    let mut in_single = false;
    let mut in_double = false;
    let mut started = false;
    while let Some(c) = chars.next() {
        match c {
            '\\' if !in_single => {
                if let Some(&next) = chars.peek() {
                    cur.push(next);
                    started = true;
                    chars.next();
                }
            }
            '\'' if !in_double => {
                in_single = !in_single;
                started = true;
            }
            '"' if !in_single => {
                in_double = !in_double;
                started = true;
            }
            c if c.is_whitespace() && !in_single && !in_double => {
                if started {
                    tokens.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            c => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        tokens.push(cur);
    }
    tokens
}

/// Split a compound command on `;`, `&&`, `||`, `|` into its constituent simple
/// commands so a sequence (`rm a; rm b`) is classified per-part. Crude but
/// sufficient: we only need the leaders and path operands of each part.
fn split_commands(cmd: &str) -> Vec<String> {
    cmd.split(|c| c == ';' || c == '\n')
        .flat_map(|s| s.split("&&"))
        .flat_map(|s| s.split("||"))
        .flat_map(|s| s.split('|'))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// The leader of a simple command, with a leading `sudo` stripped.
fn leader_and_args(part: &str) -> (String, Vec<String>) {
    let toks = tokenize(part);
    let mut idx = 0;
    if toks.get(0).map(|s| s.as_str()) == Some("sudo") {
        idx = 1;
        // skip sudo flags like -S, -n
        while toks.get(idx).map(|s| s.starts_with('-')).unwrap_or(false) {
            idx += 1;
        }
    }
    let leader = toks.get(idx).cloned().unwrap_or_default();
    let args = toks.get(idx + 1..).map(|s| s.to_vec()).unwrap_or_default();
    (leader, args)
}

/// Path operands of a command (non-flag tokens after the leader).
fn path_operands(args: &[String]) -> Vec<String> {
    args.iter()
        .filter(|a| !a.starts_with('-'))
        .cloned()
        .collect()
}

/// Hard-deny floor: machine-ending or identity-destroying actions, refused even
/// with inspection and reaffirmation. Returns the refusal reason.
pub fn hard_denied(cmd: &str, home: &str) -> Option<String> {
    for part in split_commands(cmd) {
        let (leader, args) = leader_and_args(&part);
        let operands = path_operands(&args);

        if leader == "rm" {
            for op in &operands {
                let n = norm(op, home);
                // root / system / whole-Users wipes
                if n == "/" || n == "/system" || n.starts_with("/system/")
                    || n == "/users" || n == "/usr" || n.starts_with("/usr/")
                {
                    return Some(format!(
                        "Refused: `{}` would damage the operating system itself. \
                         This is a hard limit — Noah will not run it even if asked. \
                         If the goal is free space, target user caches and large \
                         files instead.",
                        op
                    ));
                }
                // auth / identity stores
                let home_l = home.trim_end_matches('/').to_lowercase();
                if n.starts_with(&format!("{}/library/keychains", home_l))
                    || n.contains("/com.apple.tcc")
                    || n.contains("com.apple.security")
                {
                    return Some(
                        "Refused: this targets your Keychain / security identity. \
                         Deleting it would lock you out of saved passwords and app \
                         logins, irrecoverably. This is a hard limit."
                            .to_string(),
                    );
                }
            }
        }

        // secure-erase of a disk
        if leader == "diskutil" {
            let joined = args.join(" ").to_lowercase();
            if joined.contains("erasedisk") || joined.contains("erasevolume")
                || joined.contains("securerase") || joined.contains("zerodisk")
            {
                return Some(
                    "Refused: erasing a disk/volume is irreversible and outside \
                     what storage cleanup should ever do. This is a hard limit."
                        .to_string(),
                );
            }
        }
    }
    None
}

/// Classify a command against the inspected-set and return the gate decision.
///
/// `inspected` holds normalised (expanded, lowercased, trailing-slash-stripped)
/// paths recorded by prior read-class observations this session.
pub fn gate_decision(cmd: &str, home: &str, inspected: &HashSet<String>) -> GateDecision {
    if let Some(reason) = hard_denied(cmd, home) {
        return GateDecision::HardDeny { reason };
    }

    for part in split_commands(cmd) {
        let (leader, args) = leader_and_args(&part);
        if leader != "rm" {
            continue;
        }
        for op in path_operands(&args) {
            let n = norm(&op, home);

            // Regenerable (cache/log) → never gated.
            if REGENERABLE_HINTS.iter().any(|h| n.contains(h)) {
                continue;
            }

            // Which protected tree (if any) does this operand fall in?
            let tree = PROTECTED_TREES.iter().find_map(|t| {
                let tn = norm(t, home);
                if is_within(&n, &tn) {
                    Some(tn)
                } else {
                    None
                }
            });
            let Some(tree) = tree else { continue };

            // Wildcard sweep over a protected tree → never clears.
            if has_glob(&op) {
                return GateDecision::RejectWildcard {
                    tree: tree.clone(),
                    tip: format!(
                        "Held back: `{}` is a wildcard delete over a protected \
                         folder, which removes whatever happens to be inside \
                         (including data you can't get back). Instead: inspect \
                         the folder (e.g. `du -sh '{}'/*`), then delete the \
                         specific subdirectories you've confirmed are safe — one \
                         explicit path at a time.",
                        op, tree
                    ),
                };
            }

            // Concrete path: cleared only if inspected within the tree.
            let cleared = inspected.iter().any(|i| {
                is_within(i, &tree) && is_within(&n, i)
            });
            if !cleared {
                return GateDecision::RejectNeedsInspection {
                    path: n.clone(),
                    tip: format!(
                        "Held back: `{}` is inside a protected folder and Noah \
                         hasn't looked at it yet. Inspect it first (e.g. \
                         `ls -la '{}'` or `du -sh '{}'`) and confirm what it is \
                         and that it's safe to remove, then retry this exact \
                         delete.",
                        op, op, op
                    ),
                };
            }
        }
    }

    GateDecision::Allow
}

/// Paths that a command inspects, normalised, to fold into the session
/// inspected-set. Empty unless the command is a read-class observation.
pub fn inspected_paths(cmd: &str, home: &str) -> Vec<String> {
    let mut out = Vec::new();
    for part in split_commands(cmd) {
        let (leader, args) = leader_and_args(&part);
        if !INSPECT_LEADERS.contains(&leader.as_str()) {
            continue;
        }
        for op in path_operands(&args) {
            // Record the directory being listed. Strip a trailing `/*` or `/.`
            // so `du -sh ~/Foo/*` records `~/Foo` (you saw its children).
            let base = op
                .trim_end_matches("/*")
                .trim_end_matches("/.")
                .trim_end_matches("/*/");
            let n = norm(base, home);
            if !n.is_empty() && n != "/" {
                out.push(n);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOME: &str = "/Users/fbob";

    fn set(paths: &[&str]) -> HashSet<String> {
        paths.iter().map(|p| norm(p, HOME)).collect()
    }

    // ── The incident commands: every one of these must be held back ──────

    #[test]
    fn incident_wildcard_app_support_rejected() {
        let d = gate_decision("rm -rf ~/Library/Application\\ Support/*", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectWildcard { .. }), "{:?}", d);
    }

    #[test]
    fn incident_sudo_wildcard_app_support_rejected() {
        let d = gate_decision("sudo rm -rf ~/Library/Application\\ Support/*", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectWildcard { .. }), "{:?}", d);
    }

    #[test]
    fn incident_wildcard_containers_rejected() {
        let d = gate_decision("rm -rf ~/Library/Containers/*", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectWildcard { .. }), "{:?}", d);
    }

    #[test]
    fn incident_messages_container_rejected_uninspected() {
        let d = gate_decision("rm -rf ~/Library/Containers/com.apple.MobileSMS", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectNeedsInspection { .. }), "{:?}", d);
    }

    #[test]
    fn incident_messages_attachments_wildcard_rejected() {
        let d = gate_decision("rm -rf ~/Library/Messages/Attachments/*", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectWildcard { .. }), "{:?}", d);
    }

    #[test]
    fn incident_group_containers_wildcard_rejected() {
        let d = gate_decision("rm -rf ~/Library/Group\\ Containers/*", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectWildcard { .. }), "{:?}", d);
    }

    // ── The unroll bypass: specific deletes still need inspection ─────────

    #[test]
    fn unrolled_specific_app_delete_rejected_without_inspection() {
        // The exact bypass from the trace: enumerate instead of wildcard.
        let d = gate_decision("rm -rf ~/Library/Application\\ Support/Adobe", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::RejectNeedsInspection { .. }), "{:?}", d);
    }

    #[test]
    fn sequence_of_specific_deletes_rejected_at_first_uninspected() {
        let d = gate_decision(
            "rm -rf ~/Library/Application\\ Support/Adobe; rm -rf ~/Library/Application\\ Support/obs-studio",
            HOME,
            &set(&[]),
        );
        assert!(matches!(d, GateDecision::RejectNeedsInspection { .. }), "{:?}", d);
    }

    // ── "Be my guest": inspected → allowed ───────────────────────────────

    #[test]
    fn specific_app_delete_allowed_after_inspecting_it() {
        let inspected = set(&["~/Library/Application Support/Adobe"]);
        let d = gate_decision("rm -rf ~/Library/Application\\ Support/Adobe", HOME, &inspected);
        assert_eq!(d, GateDecision::Allow);
    }

    #[test]
    fn specific_app_delete_allowed_after_inspecting_parent_tree() {
        // Listing the tree root clears its descendants (you saw the listing).
        let inspected = set(&["~/Library/Application Support"]);
        let d = gate_decision("rm -rf ~/Library/Application\\ Support/Adobe", HOME, &inspected);
        assert_eq!(d, GateDecision::Allow);
    }

    #[test]
    fn wildcard_never_clears_even_after_inspection() {
        // Even having looked, the unbounded sweep stays rejected — enumerate.
        let inspected = set(&["~/Library/Application Support"]);
        let d = gate_decision("rm -rf ~/Library/Application\\ Support/*", HOME, &inspected);
        assert!(matches!(d, GateDecision::RejectWildcard { .. }), "{:?}", d);
    }

    #[test]
    fn inspecting_home_does_not_clear_protected_child() {
        // `ls ~` is above the tree root → clears nothing inside it.
        let inspected = set(&["~"]);
        let d = gate_decision("rm -rf ~/Library/Application\\ Support/Adobe", HOME, &inspected);
        assert!(matches!(d, GateDecision::RejectNeedsInspection { .. }), "{:?}", d);
    }

    // ── Regenerable: caches/logs never gated ─────────────────────────────

    #[test]
    fn caches_wildcard_allowed() {
        let d = gate_decision("rm -rf ~/Library/Caches/*", HOME, &set(&[]));
        assert_eq!(d, GateDecision::Allow);
    }

    #[test]
    fn app_support_cache_subdir_allowed() {
        let d = gate_decision(
            "rm -rf ~/Library/Application\\ Support/Foo/Caches/blobs",
            HOME,
            &set(&[]),
        );
        assert_eq!(d, GateDecision::Allow);
    }

    #[test]
    fn logs_allowed() {
        let d = gate_decision("rm -rf ~/Library/Logs/old", HOME, &set(&[]));
        assert_eq!(d, GateDecision::Allow);
    }

    // ── Non-protected and non-delete: untouched ──────────────────────────

    #[test]
    fn delete_outside_protected_tree_allowed() {
        let d = gate_decision("rm -rf ~/Downloads/installer.dmg", HOME, &set(&[]));
        assert_eq!(d, GateDecision::Allow);
    }

    #[test]
    fn non_rm_command_allowed() {
        let d = gate_decision("du -sh ~/Library/Application\\ Support/*", HOME, &set(&[]));
        assert_eq!(d, GateDecision::Allow);
    }

    // ── Hard-deny floor ──────────────────────────────────────────────────

    #[test]
    fn rm_root_hard_denied() {
        let d = gate_decision("rm -rf /", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::HardDeny { .. }), "{:?}", d);
    }

    #[test]
    fn rm_system_hard_denied() {
        let d = gate_decision("sudo rm -rf /System", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::HardDeny { .. }), "{:?}", d);
    }

    #[test]
    fn keychain_hard_denied_even_if_inspected() {
        let inspected = set(&["~/Library/Keychains"]);
        let d = gate_decision("rm -rf ~/Library/Keychains", HOME, &inspected);
        assert!(matches!(d, GateDecision::HardDeny { .. }), "{:?}", d);
    }

    #[test]
    fn diskutil_erase_hard_denied() {
        let d = gate_decision("diskutil eraseDisk APFS Blank disk0", HOME, &set(&[]));
        assert!(matches!(d, GateDecision::HardDeny { .. }), "{:?}", d);
    }

    // ── inspected_paths extraction ───────────────────────────────────────

    #[test]
    fn inspected_paths_records_du_target() {
        let p = inspected_paths("du -sh ~/Library/Application\\ Support/Adobe", HOME);
        assert_eq!(p, vec![norm("~/Library/Application Support/Adobe", HOME)]);
    }

    #[test]
    fn inspected_paths_strips_trailing_wildcard() {
        let p = inspected_paths("du -sh ~/Library/Application\\ Support/*", HOME);
        assert_eq!(p, vec![norm("~/Library/Application Support", HOME)]);
    }

    #[test]
    fn inspected_paths_handles_ls() {
        let p = inspected_paths("ls -la ~/Library/Containers/com.apple.MobileSMS", HOME);
        assert_eq!(p, vec![norm("~/Library/Containers/com.apple.MobileSMS", HOME)]);
    }

    #[test]
    fn inspected_paths_empty_for_rm() {
        assert!(inspected_paths("rm -rf ~/Library/Caches/*", HOME).is_empty());
    }

    // ── End-to-end: the careful path the harness is meant to produce ─────

    #[test]
    fn careful_flow_inspect_then_delete_succeeds() {
        // 1. Blind delete is rejected.
        let mut inspected: HashSet<String> = HashSet::new();
        let d1 = gate_decision("rm -rf ~/Library/Application\\ Support/Adobe", HOME, &inspected);
        assert!(matches!(d1, GateDecision::RejectNeedsInspection { .. }));

        // 2. Model inspects (as the tip instructs).
        for p in inspected_paths("du -sh ~/Library/Application\\ Support/Adobe", HOME) {
            inspected.insert(p);
        }

        // 3. Retry now clears — be my guest.
        let d2 = gate_decision("rm -rf ~/Library/Application\\ Support/Adobe", HOME, &inspected);
        assert_eq!(d2, GateDecision::Allow);
    }
}
