# Playbooks — Markdown as Remediation Programs

Noah's remediation knowledge is not compiled into the binary as Rust. It is authored
as plain Markdown files — "playbooks" — each with a YAML frontmatter header and a
lightweight step DSL expressed entirely in Markdown headers. A playbook is a protocol
the model reads and follows: it runs the automatable commands itself, pauses for the
things only a human can do, and drives a visible progress stepper as it goes.

The design goal is that the knowledge is legible to the people who own it. A
network engineer who wants to change how Noah triages DNS failures edits a `.md`
file. There is no schema compiler, no plugin API, no rebuild. Drop a valid file in
the playbooks directory and it is live. And because the authoring guide is itself a
Markdown document that gets embedded into the model's prompt in knowledge-creation
mode, the same agent that *follows* playbooks can *write* them.

![A playbook driving the card's progress stepper — step 3 of 5 of a storage-cleanup playbook.](images/hero-progress-stepper.png)

---

## What a playbook is

A playbook is a single `.md` file (or a folder of them). The bundled set lives at
`apps/desktop/src-tauri/playbooks/`: **26 flat bundled playbooks** plus one
folder-based playbook (`setup-openclaw/`, with a `playbook.md` entry point and 10
sub-modules), alongside a `TEMPLATE.md` stub that the scanner deliberately skips.

A representative sample of the flat set:

| Playbook | Platform | Shape |
|---|---|---|
| `network-diagnostics.md` | macos | diagnostic |
| `disk-space-recovery.md` | macos | diagnostic |
| `performance-forensics.md` | macos | diagnostic |
| `printer-repair.md` / `windows-printer-repair.md` | macos / windows | diagnostic |
| `vpn-troubleshooting.md` | macos | diagnostic |
| `outlook-troubleshooting.md` | all | diagnostic |
| `mac-tune-up.md`, `app-doctor.md`, `credential-cleanup.md` | macos | diagnostic |
| `setup-homebrew.md` | macos | procedural |
| `setup-ssh-key.md`, `setup-wifi-profile.md`, `setup-cuda.md` | macos / linux | procedural |
| `setup-openclaw/` (folder) | all | procedural + sub-modules |

Playbooks are ordinary files on disk, **not** `include_str!`'d into the binary. They
ship as Tauri bundled resources and are copied into the app's knowledge directory at
startup (`PlaybookRegistry::init` in `playbooks.rs`). This is what makes them
contributable: the loader treats the bundled set and a user's own files identically.

### Frontmatter

Every playbook opens with a YAML frontmatter block, parsed by `parse_frontmatter`
in `apps/desktop/src-tauri/src/playbooks.rs` into a `PlaybookMeta`:

```rust
pub struct PlaybookMeta {
    pub name: String,           // slug, must match filename
    pub description: String,    // shown in the knowledge TOC
    pub platform: String,       // "macos" | "windows" | "linux" | "all"
    pub source: PlaybookSource, // Local | Bundled | Fleet (precedence)
    pub content_hash: String,   // first 12 hex chars of SHA-256
    pub last_reviewed: Option<String>, // YYYY-MM-DD, flags staleness
    pub author: Option<String>,
    pub emoji: Option<String>,  // UI icon for the progress card
}
```

A real block, from `network-diagnostics.md`:

```yaml
---
name: network-diagnostics
description: Systematic connectivity troubleshooting for Wi-Fi, DNS, and internet issues
platform: macos
last_reviewed: 2026-03-04
author: noah-team
source: bundled
emoji: 🌐
---
```

The parser is hand-rolled and forgiving (line-prefix matching, not a full YAML
engine). `name` and `description` are the only required fields — a file missing
either is ignored. `platform` defaults to `all`, and the registry only loads
playbooks whose platform matches the running OS (or `all`), so a Windows-only
playbook never clutters a Mac's TOC or confuses the model.

`source` is a precedence taxonomy: **Fleet > Bundled > Local**. When two files
declare the same `name`, the highest-precedence source wins and the others are
shadowed (a fleet-pushed override beats the shipped default beats a user's local
copy). The registry also refuses to overwrite `local`- or `fleet`-owned files when
it re-bootstraps the bundled set, so user edits and admin pushes survive app
updates. `content_hash` (12 hex chars of SHA-256) versions each file for fleet
run-reporting.

The parser accepts both the legacy `type:` field and `source:`, with `source:`
taking precedence when both are present (`type: system` → Bundled, `type: user` →
Local), so older playbooks keep working. New playbooks should use `source:` and may
set `emoji:`.

---

## The two shapes

The DSL is deliberately thin. `parse_steps` in `playbooks.rs` scans for level-2
Markdown headers of the form `## Step N: Label` (also accepting `## N. Label`,
`## Step N — Label`, etc.). Whether a playbook has such headers is the entire
distinction between the two shapes — there is no `kind:` field. `is_procedural()`
is literally "does `parse_steps` return anything."

### Diagnostic (prose sections)

A diagnostic playbook is a decision tree in prose. It has **no** `## Step N:`
headers — its `## ` and `### ` headers are section and branch labels, not steps —
so it drives no progress stepper. The model reads it as triage guidance and picks
its own path. The bundled diagnostics follow a fixed section skeleton, enforced by
tests in `playbooks.rs` (`## Escalation`, `## Caveats`, `## Key signals`, and a
stated success rate are all required; the file must be under 120 lines so it stays
cheap to load into context).

Real example — `network-diagnostics.md`:

```markdown
## When to activate
User reports: can't connect, Wi-Fi dropping, slow internet, DNS errors, ...

## Quick check
Run `mac_ping` to `8.8.8.8` with count 3.
- If ping succeeds → internet works. Problem is DNS or application-level. Jump to step 3.
- If ping fails → no internet connectivity. Start at step 1.

## Standard fix path (try in order)

### 1. Check Wi-Fi association
Run `mac_network_info` to check interfaces and IP address.
- **Self-assigned IP (169.254.x.x)** → DHCP failed. Turn Wi-Fi off and back on. ...

### 3. Check DNS
Run `mac_dns_check` for `google.com`.
- **DNS fails** → flush DNS cache with `mac_flush_dns`. Re-test.

> Steps 1-4 resolve ~85% of connectivity issues. Most common fix: power-cycling the router.

## Caveats
- If a **VPN is active**, DNS often breaks ... activate the `vpn-troubleshooting` playbook instead.

## Key signals
- **"It was working 5 minutes ago"** → most likely a router hiccup. Power-cycle first.
```

Note that the branch numbering here (`### 1.`, `### 3.`) is `###`, not `##`, so
`parse_steps` correctly returns zero steps — this is a diagnostic, and its
`progress_json()` is `None`.

### Procedural (step DSL)

A procedural playbook is an ordered install/setup wizard. Each `## Step N: Label`
is a checkpoint the orchestrator counts. Real example — `setup-homebrew.md`:

```markdown
## Step 1: Check if Homebrew is already installed
Run `mac_run_command` with `which brew` or `brew --version` to see if it exists.
- If Homebrew is already installed, skip to Step 4 (install packages).

## Step 2: Install Homebrew
Tell the user to open Terminal and paste the official install command:
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
Use WAIT_FOR_USER — the user needs to run this in Terminal themselves ...

## Step 3: Add Homebrew to PATH
...
## Step 4: Install requested packages
...

## Tools referenced
- `mac_run_command` — run shell commands to check/install
- `ui_spa` with WAIT_FOR_USER — for Terminal steps the user must do themselves
```

`PlaybookState::from_content` parses those four headers into a `steps` vector with
`total_steps = 4`. As the model completes each interactive turn, the orchestrator
calls `advance()` and injects the current position into the outgoing card.

### The progress stepper

For a procedural playbook, `PlaybookState::progress_json()` produces a payload the
orchestrator splices into every `ui_*` card under a `progress` key:

```json
{ "step": 2, "total": 4, "label": "Install Homebrew",
  "all_steps": [ {"number":1,"label":"..."}, ... ],
  "playbook_name": "setup-homebrew", "emoji": "🍺", "description": "..." }
```

The desktop side consumes this as `PlaybookProgress` (`lib/tauri-commands.ts`),
whose `all_steps[]` drives the visual wizard — the numbered stepper rendered in the
SPA card (see [Generative UI](./1-generative-ui.md) for the card contract). Diagnostic playbooks return `None` from
`progress_json()`, so they show no stepper — correct, because they have no linear
step sequence to visualize. Progress is tracked deterministically by the
orchestrator, **not** by the model asserting "I'm on step 3."

---

## The authoring guide lives in the prompt

The authoring spec is a single Markdown file at the repo root:
`playbook-authoring-guide.md`. It is embedded into the binary at compile time —
`apps/desktop/src-tauri/src/agent/prompts.rs`:

```rust
/// Full playbook authoring guide, embedded at compile time.
const PLAYBOOK_AUTHORING_GUIDE: &str =
    include_str!("../../../../../playbook-authoring-guide.md");
```

**Precise behavior (a correction to the loose "always in the prompt" framing):**
the guide is compiled in, but it is only *injected* into the model's system prompt
in **learn mode** — the knowledge-creation session where a user hands Noah a URL or
a tutorial to convert. `system_prompt_blocks(...)` appends `LEARN_MODE_PREAMBLE`
followed by `PLAYBOOK_AUTHORING_GUIDE` to the dynamic (uncached) block only when
`mode == "learn"`. In normal operation the model follows playbooks via the
`activate_playbook` tool without carrying the full authoring spec; it picks up the
whole spec only when it is being asked to *write* one. The single source file is
therefore both the human contributor's reference and the model's in-context spec —
they can never drift apart.

The guide teaches five patterns for translating a human tutorial into playbook
steps:

1. **Automated action** — the step is a CLI command Noah can run itself. Model
   calls `shell_run` (or a platform tool), checks the result, reports via a
   `RUN_STEP` card. *"Run `shell_run` with `npm install -g openclaw@latest`. Verify:
   `openclaw --version`."*
2. **Human-in-the-loop** — the step needs a browser, a phone, or a GUI Noah can't
   drive. Model emits a `WAIT_FOR_USER` card. Hard rule: the card must contain the
   *exact* self-contained instructions (URLs, button names), never "I'll guide you."
3. **Collect user input** — ask via `ui_user_question` in one of three modes:
   `options` (predefined choices), `text_input` (free text, e.g. a project name),
   or `secure_input` (masked credentials). Secrets collected via `secure_input`
   land in an ephemeral store and **never enter the model's context window**;
   `write_secret` substitutes `{{value}}` into a config file.
4. **Conditional sub-module activation** — when a tutorial branches, split the
   branch into its own file and `activate_playbook` it by path
   (`setup-openclaw/add-telegram`). This is how folder playbooks compose.
5. **Verification** — every playbook ends with a real check, not an assumption:
   run a probe, state the expected output, and handle the common failure modes
   inline.

The guide also carries a quality checklist, a full worked tutorial-to-playbook
conversion, and a folder-playbook layout spec — everything a contributor (human or
model) needs in one place.

---

## Write your own

The extension path is deliberately boring, which is the point:

1. Copy `apps/desktop/src-tauri/playbooks/TEMPLATE.md`, or start from the minimal
   example at the end of `playbook-authoring-guide.md`.
2. Write valid frontmatter — at minimum `name` (matching the filename slug) and
   `description`. Set `platform` to your OS (or `all`), and `source: local` so app
   updates never overwrite your file.
3. Pick a shape. For a decision tree, write prose sections. For a wizard, write
   `## Step N: Label` headers and you get the progress stepper for free.
4. Reference only tools that exist (`shell_run` is the safe universal fallback);
   end with a verification step.
5. Drop the `.md` into the playbooks directory. The registry re-scans on init
   (and `reload()` after fleet checkins) and the playbook is immediately
   activatable by name.

The reference for all of it is `playbook-authoring-guide.md` — read it once and you
can write a playbook the model will follow precisely.

---

## Limitations

- **No branching within a single playbook.** Steps execute sequentially; the
  `total_steps` count is fixed at parse time. Real branches must be factored into
  sub-modules (Pattern 4). A "skip to Step 4" instruction is prose the model
  interprets — the stepper still counts linearly.
- **The frontmatter parser is line-based, not a real YAML engine.** Multi-line
  values, nested keys, and quoting nuances aren't supported; keep every field on
  one line.
- **Progress is turns-based, not tool-based.** `advance()` fires per interactive
  turn, so a step that takes several model turns can lag the visual stepper, and a
  step the model collapses can jump it. It is a fidelity aid, not a guarantee.
- **Diagnostic playbooks are unverifiable by the stepper.** They render no
  progress and rely on the model following the prose faithfully; the only
  enforcement is the authoring-time section/length/success-rate tests in
  `playbooks.rs`, not anything at runtime.
- **Bundled playbooks are load-bearing on `last_reviewed`.** A test fails builds
  if any bundled playbook goes 183 days without a review-date bump, which keeps the
  shipped set fresh but means a stale date is a hard CI failure, not a warning.
