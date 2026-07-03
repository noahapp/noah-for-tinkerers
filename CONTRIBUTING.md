# Contributing to Noah for Tinkerers

Noah for Tinkerers is the open-source, bring-your-own-key build of Noah, built in public.
Issues, ideas, and PRs are welcome.

## Development setup

**Prerequisites:** Node.js (v18+), pnpm, Rust ([rustup.rs](https://rustup.rs))

```bash
git clone https://github.com/noahapp/noah-for-tinkerers.git
cd noah
pnpm install
```

Run in development mode:
```bash
export ANTHROPIC_API_KEY="your-key"   # or paste it in the app's setup screen
pnpm --filter @noah/desktop tauri dev
```

Or on macOS: `./run_mac.sh`

### Build for production

```bash
pnpm release:build
```

This produces platform installers (`.dmg` on macOS, `.msi`/`.exe` on Windows, Linux bundles on Linux).

### Run tests

```bash
cargo test --workspace          # Rust tests
pnpm --filter @noah/desktop test   # Frontend tests
npx tsc --noEmit                # TypeScript type check
python3 scripts/lint_diagrams.py   # Docs: diagram alignment + mermaid checks
```

If you touch a diagram in any `.md` file, run the diagram linter before committing. It
verifies that box diagrams use only width-safe characters (ASCII + box-drawing, so
columns align in every renderer) and that vertical borders are structurally continuous.
Add `--mermaid` to also render mermaid blocks with mermaid-cli.

## Architecture

```
┌───────────────────────────────────────┐
│         React + TypeScript UI         │
│  (Chat, ActionCards, SessionHistory)  │
├───────────────────────────────────────┤
│                Tauri 2                │
├───────────────────────────────────────┤
│             Rust backend              │
│  ┌──────────────┐   ┌──────────────┐  │
│  │ Orchestrator │──>│ Tool Router  │  │
│  │ (agentic     │   │ (~40 tools,  │  │
│  │  loop)       │   │  by OS)      │  │
│  └──────┬───────┘   └──────┬───────┘  │
│         │                  │          │
│         v                  v          │
│  ┌──────────────┐   ┌──────────────┐  │
│  │  Claude API  │   │ Local system │  │
│  │  (thinking)  │   │ (executing)  │  │
│  └──────────────┘   └──────────────┘  │
├───────────────────────────────────────┤
│  SQLite (journal, sessions,           │
│          artifacts/knowledge)         │
└───────────────────────────────────────┘
```

**Key design decision:** The LLM thinks, the local machine acts. Claude decides what tools to call, but all execution happens locally via Rust. Your data never leaves your machine (except the conversation with Claude).

## Project structure

```
apps/desktop/
  src/                    # React frontend (Vite + Tailwind)
    components/           # ChatPanel, SessionBar, ActionApproval, etc.
    stores/               # Zustand stores (chat, session, debug)
    hooks/                # useSession, useAgent
    lib/                  # Tauri command wrappers, response parser
  src-tauri/
    src/
      agent/              # Orchestrator, LLM client, tool router, prompts
      artifacts.rs        # Knowledge persistence (save/query facts across sessions)
      platform/linux/     # Linux tool implementations
      platform/macos/     # macOS tool implementations
      platform/windows/   # Windows tool implementations
      safety/             # Journal (change logging + undo), safety tiers
      commands/           # Tauri command handlers
crates/
  noah-tools/             # Shared Tool trait, SafetyTier types
```

## Code style

- **Rust:** follow existing patterns. `#[cfg]`-gate platform code. Graceful fallback over panics.
- **TypeScript/React:** functional components, Zustand stores, Tailwind classes.
- **No over-engineering.** Minimum code for the current task.

## Commit conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`
- One logical change per commit
- Don't commit code that fails `cargo test --workspace` or `npx tsc --noEmit`

## Version and release

The app version lives in 3 files — keep them in sync:
- `apps/desktop/src-tauri/tauri.conf.json`
- `apps/desktop/package.json`
- `apps/desktop/src-tauri/Cargo.toml`

(`crates/noah-tools/Cargo.toml` is an internal crate with its own version — leave it alone.)

Tag format: `v{VERSION}`.

### Cutting a release

Releases are signed with the project's updater key and distributed through the **bring-your-own-key
update channel** (`onnoah.app/byok`). The release script publishes GitHub releases as
**prereleases** on purpose, so they stay off the repo's "Latest" pointer and never collide with
other Noah update channels.

1. **macOS (local):** `pnpm release:upload` — builds the universal `.dmg`, signs the updater
   artifact, creates/updates the GitHub prerelease, and mirrors the binaries to R2.
2. **Windows + Linux:** run the **Release** GitHub Action (`.github/workflows/release.yml`),
   which builds those platforms and merges them into the same release manifest.
3. **Publish the update feed:** `NOAH_UPDATE_CHANNEL=byok node scripts/r2-sync.mjs <tag>`
   (requires `wrangler` authenticated to the Cloudflare account that hosts the bucket). This
   pushes `onnoah.app/byok/latest.json` + the per-platform binaries so installed apps see the update.

Build locally without publishing: `pnpm release:build`.
