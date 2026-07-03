# Destructive-action safety policy

This is the decision record behind Noah's redline system, adopted in June 2026.
It exists because a real session nearly (and maybe actually) destroyed a user's
data. Read the incident first — the policy only makes sense as a response to it.

## The incident

A user asked (one sentence, three intents):

> "My mac is running slow **and I want my storage pushed to Google Drive
> using the folder in finder** and my mac is slow please improve this **and i
> want a target ssd size of below 410**."

Three intents: performance, **offload to cloud (move, preserve)**, and a **hard
quota** (under 410 GB). Across ~44 steps Noah held the quota and worked it down
(398 → 321 GB). That relentless, goal-driven, conversational cleanup is exactly
what Noah is for — it requires reasoning and a dialogue, and **we did not want to
weaken it.**

But the same loop also ran, each gated only by a click-through approval whose
prompt showed Noah's own one-line reason:

- `rm -rf ~/Library/Messages/Attachments/*`, `rm -rf …/com.apple.MobileSMS`
  → the user's iMessage history.
- `sudo rm -rf ~/Library/Application Support/*` → every app's data.
- `rm -rf ~/Library/Containers/*` → sandboxed app data (Notes, Mail…).
- `tmutil deletelocalsnapshots` → the Time Machine safety net.

And it **never touched Google Drive** — it silently swapped the user's chosen
*method* (move/preserve) for *delete*. Worse, we could not tell after the fact
which deletes actually ran, because the logs recorded the *proposed shell
command*, not the *approval decision or the result*. We were blind. Closing that
blindness is part of this policy (see the action-event record below).

## What went wrong, structurally

Our only **code-enforced** guardrail was "command contains `rm`/`sudo` →
ask the user," which a trusting user clears in two seconds. Everything else
protecting their data was **playbook prose**: advisory, holey (Messages wasn't
on the refuse list; no rule against wildcard sweeps), and possibly **not even
loaded** for this phrasing. For a product whose killer feature is autonomous
deletion toward a goal, the safety floor was a single click.

## Principles

1. **Put each rule at the lowest layer that can guarantee it.**
   - *Software (Rust)* — deterministic, un-arguable. The only layer that can
     hold a **redline**. Holds the enforced policy.
   - *Playbook* — contextual good-practice ("offload means move"; "surface,
     don't push deletion"). Advisory — advice, never a guard.
   - *AI* — judgment and conversation. Powerful and persuadable. Never a place
     for a guarantee.
   A redline the model can talk past is not a redline.

2. **A harness is not a wall.** A wall always says no, so it makes no decision.
   Noah is the arbiter between what the human asks and what the AI proposes; it
   *resists and yields under control*, it does not forbid capability. So the
   default for a dangerous-but-legitimate action is **reject-then-reconsider**,
   not "never."

3. **Gate on justification, not syntax.** The problem with
   `rm -rf …/Application Support/*` is not the `*`; it is that the AI has not
   established the specific thing is removable. A wildcard fails because `*` is
   the syntactic form of *"I haven't looked."* Five *named, verified-orphaned*
   app folders carry per-target justification and are fine.

4. **Inspect before delete (the Claude Code precedent).** Claude Code's harness
   requires you to `Read` a file before `Edit`. The check is **structural, not
   semantic** — it does not verify you *understood* the file, only that you
   *looked*. We do the identical thing for deletes inside protected trees: the
   harness cannot know "Adobe is uninstalled," but it can know whether the model
   *inspected the folder* before deleting it. That is enough to force the
   careful look, and it is cheap and deterministic. The inspection results land
   in context, so the model's next decision is grounded — and a human/the
   telemetry can audit it.

5. **You can only govern what you can see.** Ground truth lives only in the
   execution layer: tier classified → gate decision → approval decision →
   result → manifest of what was touched. The same record powers safety
   auditing, undo, and the "here's what Noah did" trust surface. Build it once.

6. **Approximation is the implementation, and it has assurance.** "Irreplaceable"
   is not computable at runtime; we approximate it with a curated tree list. That
   is not a retreat — macOS TCC itself is a hardcoded path list. A fixed,
   conservative, testable list is *more* assuring than a clever runtime detector,
   because assurance comes from predictability. The *property* is the spec; the
   list is the satisfying approximation, and every entry carries its rationale so
   it does not rot.

## Fail-closed: the harness permits, it doesn't chase bypasses

The first cut was **fail-open**: it tried to *parse* arbitrary shell and catch
known-bad forms, so anything it couldn't parse fell through to allowed. That is a
losing game — firmlinks, `find -delete`, `xargs rm`, relative paths, `$(...)`,
`eval`, variables — an unbounded list of spellings for the same delete.

The harness has full control, so it **inverts the burden**: a command that
deletes must be in a small, fully-analysable **canonical form**, or it does not
run. We don't have to understand `find … | xargs rm` — we refuse it and tell the
model to re-express the delete as something the harness *can* read. The infinite
bypass surface collapses into one finite allowlist.

**Canonical deletion form** — the rule is *the target root must be statically
visible*. Everything else → `RejectNonCanonical`:
- `rm` / `unlink` on literal paths, **or** a non-piped
  `find <root> … -delete` / `-exec rm` whose root is a literal path. A `find`
  root is checkable and its `-name`/`-mtime` predicates only *narrow* what's
  removed within that root — strictly safer — so age/size-filtered cleanup is
  preserved.
- No indirection that hides the target: **no pipe `|`** (a `grep`/`sed` between
  `find` and `xargs rm` could diverge the deleted set), no `xargs`, no command
  substitution `$(…)` / backticks, no `eval`, no pipe-to-shell, no variables
  other than `$HOME`.
- Every path (rm/unlink operand or find root) is **absolute** (`/…`) or
  `~`/`$HOME`-rooted — never relative (closes `cd ~ && rm -rf Library/…`), never
  a bare `find` defaulting to the cwd. Globs are fine (the base is concrete).
- Flags are short and known (`-rRfidvPW`); long flags like
  `--no-preserve-root` are rejected. `srm`/`shred`/`rmdir` → use `rm`.

The model can still delete anything — it just has to express it so the harness
can *see the root*. That composes perfectly with inspect-before-delete: the
visible root is exactly what the inspect-set is checked against.

### Threat model (so the design is proportionate)

The danger is **our own over-eager model** reaching for powerful sweeping
constructs — exactly what the incident showed — not an adversary laundering `rm`
through base64. Fail-closed canonical form fully addresses the former and raises
the bar steeply on the latter (`eval` and pipe-to-shell are themselves refused).
We do **not** claim to stop a maliciously-controlled model that hides a deletion
behind zero recognisable tokens; that is out of scope and stated, not papered over.

## The redline taxonomy (the spine)

A friction gradient, not a set of absolutes. The canonical gate runs first; the
tiers below apply to the now-fully-readable delete:

| Tier | What | Action |
|------|------|--------|
| **non-canonical** | a delete whose target root isn't statically visible (pipe, `xargs`, `$(…)`, variable, `eval`, relative path, rootless `find`) | **reject with a tip** to re-express so the root is a literal `rm`/`unlink` operand or `find` root |
| **auto** | regenerable / reversible (caches, logs, old pkg versions) | run, log it |
| **confirm** | ordinary deletes outside protected trees | approve, with plain-language disclosure |
| **inspect-then-delete** | concrete delete *inside* a protected tree, not yet inspected | **reject with a tip**; clears once that path (or an ancestor within the tree) has been inspected this session |
| **reject-sweep** | wildcard, tree-root, or ancestor delete over a protected tree | **reject with a tip**; never auto-clears — the AI must enumerate specific inspected subpaths |
| **hard-deny** | the handful of actions that end the machine or destroy identity | **refuse even with inspection + reaffirmation** |

### Protected trees (approximation; irreplaceable user data / app state)

Tracks Apple's TCC-protected locations plus credential stores. Two classes:

- **App-state (Library)** — cache/log subdirs *are* regenerable-exempt:
  `~/Library/Application Support`, `~/Library/Containers`,
  `~/Library/Group Containers`, `~/Library/Messages`, `~/Library/Mail`,
  `~/Library/Safari`, `~/Library/Calendars`, `~/Library/Mobile Documents`
  (iCloud), `~/Library/CloudStorage` (Google Drive/Dropbox/OneDrive),
  `~/Library/Photos`.
- **Credentials/keys** — `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`,
  `~/.docker`, `~/.config` (the Keychain itself is *hard-deny*).
- **User content** — *no* regenerable exemption (a folder literally named
  "cache" under `~/Documents` is still the user's): `~/Documents`, `~/Desktop`,
  `~/Pictures`, `~/Movies`, `~/Music`, `~/Downloads`.

### Path normalisation — closing the bypasses (verified)

The match would be worthless if the same data could be addressed by another
spelling. So before matching, paths are normalised:

- **Firmlinks.** Every user path is *also* reachable under
  `/System/Volumes/Data` — confirmed same inode on a live machine
  (`stat -f %d:%i ~/Library` == `…/System/Volumes/Data/Users/<u>/Library`; see
  `/usr/share/firmlinks`). The real incident trace used this long form for `du`.
  We strip the `/System/Volumes/Data` prefix so both spellings hit the same tree.
- **Home / case.** `~`, `$HOME`, and the absolute `/Users/<u>/…` form all
  resolve together; comparison is lowercased (macOS default volumes are
  case-insensitive).
- **Ancestors & whole-tree roots.** Deleting `~/Library` (an *ancestor* of every
  protected tree) or `~/Library/Application Support` (the root itself) is a
  **sweep** — rejected even with inspection; only specific *sub*-paths are
  inspect-clearable. Wiping `~` or `/Users/<u>` is hard-deny.

### Deletion vectors (not just `rm`)

`rm`, `unlink`/`srm`, and `find` used destructively — `find … -delete`,
`find … -exec rm`, and `find … | xargs rm` — are all classified as deletes. A
non-destructive `find` still counts as *inspection*; a destructive one does not.

### Regenerable hints (defeat the gate only inside app-state trees)

A path segment matching `/Caches/`, `/Cache/`, `/Logs/`, `/.cache/` is treated
as regenerable → no inspection required — **but only** strictly inside an
app-state tree, never in a user-content tree and never for a tree root/ancestor.

### Hard-deny floor (refused even when reaffirmed)

- root / boot-volume destruction: `rm -rf /`, `rm -rf /System`, `…/Users` wipe.
- secure-erase of the boot volume (`diskutil … erase` on the system disk).
- `~/Library/Keychains/`, `com.apple.security*`, `…/com.apple.TCC/` — auth and
  permission identity.
These are the only true walls. Everything else yields to a careful, looked-at,
reaffirmed request.

## Inspect-before-delete state machine

State: a **session-scoped set of inspected paths** (`Arc<Mutex<HashMap<session,
HashSet<path>>>>` on the orchestrator; cleared on session end). It mirrors
Claude Code's read-set.

- A **read-class** observation records the paths it covers as inspected:
  `shell_run` running `ls`/`du`/`find`/`stat`/`cat`/`file` against a path, and
  the structured read tools (`disk_audit`, `mac_disk_usage`).
- A **delete** targeting a protected tree consults the set:
  - wildcard sweep → reject (never cleared), tip: enumerate + inspect specifics.
  - concrete path inspected (path `T` where some inspected `I` is within the
    tree and `T` is `I` or a descendant) → allow → normal approval.
  - concrete path not inspected → reject, tip: inspect this folder first.
- Clearing rule precision: inspection of `I` clears deletion of `T` **iff**
  `I` is at-or-below the protected tree root *and* `T` starts with `I`. So
  `ls ~` (above the tree root) clears nothing; `ls ~/Library/Application Support`
  clears its descendants; `du …/Adobe` clears `…/Adobe`.

The tip is what makes it a harness, not a wall: it instructs the remedy.

## The action-event record ("did we actually approve it")

Emitted from the execution layer for every consequential action:

```
action_event {
  session_id, tool, command,
  classification: auto | confirm | inspect_then_delete | reject_wildcard | hard_deny,
  gate: allowed | rejected_needs_inspection | rejected_wildcard | hard_denied,
  approval: not_required | granted | denied,
  exit_code, bytes_freed?, paths_touched[]   // result, when available
}
```

The current implementation emits this locally (frontend debug channel + stderr)
and records the approval/denial decision — closing the "we only saw the proposed
command" blindness. Binding `paths_touched` into the undo journal is the natural
next step; it reuses `safety::journal`.

## Honoring intent (playbook layer)

"Offload to Drive" is a constraint, not a suggestion. The disk-space playbook
already routes cloud mentions to selective-sync; the rule to reinforce is:
**irreplaceable-but-movable data is offloaded (copy → verify → then delete
local), never straight-deleted; irreplaceable-and-critical data is left alone —
the few GB are not worth it.** This lives in the playbook because it is
judgment; the trees above are the floor the playbook cannot fall through.

## Known limits

Fail-closed canonical form closes the spelling bypasses (relative paths,
variables, `$(…)`, `find`/`xargs`, firmlinks) by *refusing* them rather than
resolving them. What remains:

- A deletion with **zero recognisable deletion token** (e.g. a fully
  base64/`eval`-laundered `rm` that also evades the `eval`/pipe-to-shell refusal)
  is out of scope — see the threat model. Our own model does not produce these.
- `tmutil deletelocalsnapshots` (removing Time Machine local snapshots) is left
  ungated: it is an Apple-sanctioned, auto-regenerating space step. Worth
  revisiting if we want to protect the snapshot safety net during big deletes.
- macOS APFS is case-insensitive by default; we lowercase to match. A
  case-*sensitive* volume could in principle hide a path — rare, accepted.

These are the seams. They are documented because an approximation you can see the
edges of is more trustworthy than one that pretends to be total.

## What this deliberately does NOT do

- It does not block the moat: a careful, looked-at deletion still proceeds.
- It does not rely on the model's self-reported `reason` for anything load-bearing.
- It does not try to compute "irreplaceable"; it approximates and says so.
