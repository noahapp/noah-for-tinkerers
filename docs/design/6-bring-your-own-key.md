# Bring Your Own Key — An Agent With No Backend

The open build authenticates to Anthropic from the user's own machine with the user's own Anthropic API key. There is no Noah account, no login, no entitlement server, and no request proxy in the path between the app and Claude. The conversation with Claude is the one payload that leaves the machine as a matter of course. Diagnostics, the session journal, knowledge, and the key itself stay local.

Two qualifications up front:

1. The key is stored as a **plaintext file** in the app's data directory, not in the OS keychain. See [Where your key lives](#where-your-key-lives).
2. Alongside the conversation, the build makes a small number of calls to Noah-operated infrastructure at `onnoah.app/byok`: a **signed update check** (always on) and an **anonymous, opt-out usage beacon** (default on, no identifiers). Neither carries the key or the conversation. See [What leaves the machine](#what-leaves-the-machine-and-what-doesnt).

This document describes the open build only. The managed service at onnoah.app is a parallel track with its own architecture — it has a backend; this build does not.

---

## No backend, by design

The BYOK build has no server of its own that it depends on to function. The agent loop runs entirely inside the Tauri process on the user's machine:

- **The model thinks; the local machine acts.** Claude decides which tools to call; every tool executes locally in Rust (`agent/orchestrator.rs`, `agent/tool_router.rs`). The only thing sent to Anthropic is the message/tool-call transcript.
- **Auth is a single mode.** `agent/llm_client.rs` defines exactly one auth variant:

  ```rust
  // agent/llm_client.rs
  /// Pure BYOK: requests always go directly to Anthropic with the user's
  /// own API key.
  pub enum AuthMode {
      ApiKey(String),
  }
  ```

  There is no proxy mode, no session-token mode, no entitlement check. The loader (`lib.rs::load_auth`) actively deletes any legacy hosted-auth files it finds (`proxy.json`, `session.txt`, `entitlement_cache.json`) so old installs don't carry a stale hosted path.
- **No account, no paywall.** There is no sign-up, no license validation, and no gate between launch and use beyond having a key present.

What the build *does* reach out to Noah infrastructure for is the update feed and an optional anonymous beacon — covered below. Neither is required for the agent to run; pointed at no network at all except `api.anthropic.com`, the app still diagnoses and fixes.

---

## Where your key lives

The key is read from one of two sources, in order (`lib.rs::load_auth`):

1. **`api_key.txt`** in the Tauri app data directory (`identifier = app.onnoah.tinkerers`, so e.g. `~/Library/Application Support/app.onnoah.tinkerers/api_key.txt` on macOS). Written by `save_api_key` / the `set_api_key` Tauri command when the user pastes a key in Settings.
2. **`ANTHROPIC_API_KEY`** environment variable — a development / power-user fallback used when no file is present.

```rust
// lib.rs
fn load_auth(app_dir: &std::path::Path) -> AuthMode {
    let key_path = app_dir.join("api_key.txt");
    if let Ok(contents) = std::fs::read_to_string(&key_path) {
        let key = contents.trim().to_string();
        if !key.is_empty() {
            return AuthMode::ApiKey(key);
        }
    }
    AuthMode::ApiKey(std::env::var("ANTHROPIC_API_KEY").unwrap_or_default())
}
```

The key is stored as a plaintext file protected by normal filesystem permissions, **not** in the macOS Keychain / Windows Credential Manager / Linux Secret Service. What the README says holds: the key "is stored locally on your device and used only to authenticate your own calls to Anthropic; it's never sent to a Noah server." The code bears that out: the key is attached only as the `x-api-key` header on requests to Anthropic (`llm_client.rs::apply_auth`), and to no other destination. Moving the key into the OS secret store would be a strict improvement and is the natural next step.

---

## What leaves the machine (and what doesn't)

A complete inventory of where data goes.

**Stays local (never transmitted):**

| Data | Where it lives |
|---|---|
| Anthropic API key | `api_key.txt` in the app data dir (or `ANTHROPIC_API_KEY` env) |
| Session journal, sessions, change log | local SQLite (`journal.db`, `safety/journal.rs`) |
| Knowledge / remembered facts | plain files in the app's knowledge directory (`knowledge.rs`) |
| Diagnostic tool output | processed in-process; persisted only to the local journal |
| Local telemetry events | `telemetry_events` table in local SQLite, gated by `telemetry_consent`; `record_telemetry_event` only does an `INSERT` — it is **not** uploaded anywhere |

**Goes to Anthropic, and only Anthropic:**

- **The conversation.** `llm_client.rs` posts to a single hardcoded endpoint:

  ```rust
  const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
  const MODEL: &str        = "claude-sonnet-4-20250514";  // main loop
  const TITLE_MODEL: &str  = "claude-haiku-4-5-20251001"; // titles, summaries, triage
  const API_VERSION: &str  = "2023-06-01";
  ```

  The request body (`ApiRequest`) carries `model`, `max_tokens`, the `system` blocks, the `messages` transcript, and the `tools` definitions. Auth is the user's key in the `x-api-key` header. A `NOAH_API_URL` env var can redirect this to a local Anthropic-compatible server for development, but the production default is Anthropic direct — there is no interposed Noah proxy.

**Goes to Noah infrastructure (`onnoah.app/byok`), carrying no key and no conversation:**

- **Signed update check** — always on (see next section).
- **Anonymous usage beacon** — a single fire-and-forget `issue_fixed` event (`commands/settings.rs::notify_issue_fixed`):

  ```rust
  // opt-out, default ON; skipped entirely if byok_telemetry_enabled == "false"
  let _ = reqwest::Client::new()
      .post("https://onnoah.app/byok/event")
      .json(&serde_json::json!({ "type": "issue_fixed" }))
      .send().await;
  ```

  The body is literally `{"type":"issue_fixed"}` — no device id, no account, no PII, no payload from the session. It is gated behind the `byok_telemetry_enabled` setting, which the user can turn off in Settings (default on). This matches the README's "anonymous, opt-out usage ping."

**On-demand or opt-in (only when the user or agent invokes them):**

- **Web fetch tool** (`web_fetch.rs`) — the agent can fetch a URL during a session when a task calls for it (e.g. reading a vendor support page). User/agent-initiated, not background.
- **Connectivity diagnostics** — network playbooks may probe a host to test reachability (`platform/*/network.rs`). Diagnostic, on-demand.
- **Fleet dashboard link** (`dashboard_link.rs`) — an *optional, opt-in* feature: the user pastes a 6-character enrollment code / URL to link the device to a web dashboard, after which status posts to that user-supplied dashboard URL. Off unless the user explicitly enrolls.

In sum: **by default and at rest, the only continuous outbound traffic is the conversation to Anthropic and the two `onnoah.app/byok` calls (update check + anonymous beacon).** Everything else is either local-only or happens only when explicitly invoked.

---

## Updates without a server account

The app updates itself through Tauri v2's signed updater, pointed at a BYOK-specific feed. No account or login is involved — the trust anchor is a signature, not an identity.

- **Endpoint and key** (`apps/desktop/src-tauri/tauri.conf.json`):
  - `updater.endpoints`: `https://onnoah.app/byok/latest.json`
  - `updater.pubkey`: the minisign public key for BYOK signing (`CE75B852`)
  - `createUpdaterArtifacts: true`
- **Signing** (`scripts/release.mjs`): artifacts are signed with the **BYOK-only** updater key (`CE75B852`), which is deliberately **separate** from the managed app's legacy signing key. The client verifies the downloaded artifact against the embedded `pubkey` before applying it; an artifact signed with any other key is rejected.
- **Distribution** (`CONTRIBUTING.md`, `scripts/r2-sync.mjs`): the update feed and binaries are published to a Cloudflare R2 bucket fronted by `onnoah.app/byok`. `NOAH_UPDATE_CHANNEL=byok node scripts/r2-sync.mjs <tag>` pushes `onnoah.app/byok/latest.json` plus per-platform binaries; installed apps poll `latest.json` and update themselves.
- **Channel isolation:** BYOK GitHub releases are published as **prereleases** on purpose, so they never become the repo's "Latest" pointer and never collide with the managed channel's update feed.

So the update path requires no Noah account and reveals no identity: the client asks a static JSON file "is there a newer version?", downloads a binary, and installs it only if the signature matches the key baked into the app.

### Data-flow diagram

```
                            YOUR MACHINE
  ┌───────────────────────────────────────────────────────────┐
  │                                                           │
  │   React UI ── Tauri ── Rust agent loop                    │
  │                            │                              │
  │        ┌───────────────────┼──────────────────┐           │
  │        │                   │                  │           │
  │        v                   v                  v           │
  │   local SQLite        api_key.txt        tool router      │
  │   (journal,           (or ANTHROPIC_     runs commands    │
  │    knowledge,          API_KEY env)      on THIS machine  │
  │    local telemetry)   stays on disk                       │
  │                                                           │
  └───────────┬─────────────────────────────────┬─────────────┘
              │                                 │
              │  your key (x-api-key)           │  "is there an update?"
              │  + the conversation             │  (signed check, no key,
              v                                 v   no identity)
  ┌─────────────────────┐        ┌───────────────────────────────┐
  │  api.anthropic.com  │        │  onnoah.app/byok              │
  │  /v1/messages       │        │  - latest.json (update feed)  │
  └─────────────────────┘        │  - /event (anonymous,         │
                                 │    opt-out beacon:            │
                                 │    {"type":"issue_fixed"})    │
                                 └───────────────────────────────┘

  Nothing else leaves at rest. No key, no journal, no diagnostics,
  no account - the beacon body carries no identifiers, and the
  update check carries no identity. On-demand only: the web-fetch
  tool, connectivity probes, and (opt-in) fleet-dashboard linking.
```

The visual point: two arrows leave the machine as a matter of course — the conversation to Anthropic (carrying the key), and the update/beacon calls to `onnoah.app/byok` (carrying neither the key nor the conversation nor any identifier). The local box keeps the key, the journal, the knowledge, and all diagnostic output.

---

## Limitations

- **The key is a plaintext file, not keychain-backed.** It is protected by filesystem permissions in the app data dir, nothing stronger. Anything with read access to that directory can read the key. Keychain / Credential Manager / Secret Service storage is the intended improvement and is not yet built.
- **"No telemetry server" is not literally true.** The build sends an anonymous, opt-out, no-PII `issue_fixed` beacon to `onnoah.app/byok/event` by default. It carries no identifier and nothing from the session, and it can be turned off in Settings — but it is a network call to Noah infrastructure, and this document names it rather than eliding it.
- **The update feed is a Noah-operated dependency.** The app has no backend it needs to *run*, but it does depend on `onnoah.app/byok` to *update*. If that host is unreachable, the app keeps working; it simply won't discover new versions. Trust in updates rests on the minisign signature (`CE75B852`), so a compromised feed still cannot ship an unsigned or wrong-key binary.
- **The conversation is real data leaving the machine.** "Your data never leaves your machine except the conversation with Claude" is accurate, but that exception is substantial: prompts, tool inputs, and tool outputs that the agent chooses to send to Claude go to Anthropic under Anthropic's terms. BYOK removes Noah from that path; it does not make the conversation local.
- **Opt-in fleet linking sends status off-device.** If a user enrolls in a web dashboard (`dashboard_link.rs`), device status posts to that dashboard URL. This is off by default and requires an explicit enrollment code.
- **Model IDs are pinned in source.** `claude-sonnet-4-20250514` (main) and `claude-haiku-4-5-20251001` (titles/summaries/triage) are constants in `llm_client.rs`; overriding the model at runtime requires the `NOAH_MODEL` env var. There is no in-app model picker.
