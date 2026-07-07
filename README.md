<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/key-bring%20your%20own-5b8def.svg" alt="Bring your own key">
</p>

# Noah for Tinkerers

**Let an AI fix your computer — without letting it run wild.** Noah for Tinkerers is the
open-source, bring-your-own-key build of Noah: a desktop app that diagnoses and resolves
computer problems in plain English, with a safety harness around every action.

You bring an Anthropic API key; Noah talks to Claude directly from your machine. No
subscription and no account — just the app, your key, and your computer.

> **Why not just point Claude or Codex at your machine?** Raw models have no guardrails —
> they'll happily `rm -rf` the wrong thing — and sandboxed tools can't touch the real system
> you're trying to fix. Noah is the middle path: a real desktop agent that runs read-only
> diagnostics first, shows you the plan, and gates destructive actions behind explicit
> approval.

<p align="center">
  <img src="docs/images/noah-hero.gif" width="800" alt="Noah diagnosing a slow Mac, finding the cause, and fixing it in one click" />
</p>
<p align="center"><i>An afternoon of frustration, or a few minutes with Noah.</i></p>

## How it works

1. **Describe the problem** — in your own words, no jargon needed
2. **Noah investigates** — runs read-only diagnostics in the background
3. **Noah shows you the plan** — what it found and what it wants to do
4. **You approve** — Noah handles the rest and confirms the fix

A real example, the one in the screenshot above: you say *"my Mac is slow."* Noah checks
running processes, finds `backupd` pinned near 300% CPU, explains that a stuck backup daemon
is eating your CPU, and proposes quitting it — one click to approve.

Every action is logged in a journal you can review. Risky operations require your explicit
approval.

## Beyond chat: Playbooks and local Knowledge

Noah isn't just a chatbot — it carries reusable repair procedures and a memory of your machine.

- **Playbooks** — 26 bundled Markdown remediation procedures (disk recovery, network
  diagnostics, printer repair, VPN, backups, browser security, performance forensics, and
  more), plus folder-based playbooks for multi-step setups. Each is a plain `.md` file the
  model reads and follows as a guided, agent-run fix you approve step by step. Drop your own
  into the playbooks directory and Noah runs it too — no rebuild, no plugin API.
- **Knowledge** — a local store where Noah remembers your system, past fixes, and
  preferences, so it doesn't re-diagnose the same thing twice. It lives on your device, is
  written as plain files you can read, and is never synced anywhere.

## What Noah can do

Noah's capabilities are grouped by domain. Coverage varies by OS — macOS is the most
complete, Linux is a deliberately narrower set (see the note under the table).

| Category | macOS | Windows | Linux |
|---|---|---|---|
| **Network** — DNS, connectivity, flush cache, reach hosts | Yes | Yes | Yes |
| **Performance** — CPU/memory/disk, stop runaway processes | Yes | Yes | Yes |
| **System** — diagnostics, read logs & files, run shell commands | Yes | Yes | Yes |
| **Apps** — logs, clear caches, troubleshoot crashes | Yes | Yes | — |
| **Printers** — queue, cancel jobs, restart print service | Yes | Yes | — |
| **Updates** — detect stale OS, troubleshoot stuck updates | Yes | Yes | partial |
| **Security** — firewall, encryption, endpoint checks | Yes | Yes | partial |
| **Backups** — Time Machine status, backup verification | Yes | — | — |
| **Knowledge** — remembers your system, past fixes, preferences | Yes | Yes | Yes |
| **Playbooks** — 26 bundled, guided agent-run fixes you approve | Yes | Yes | Yes |

macOS also ships deeper tools — Wi-Fi scanning, a storage/disk-usage audit, and crash-log
reading; Windows adds service and startup-item management. Linux currently ships the core
network, performance, and system-diagnostic tools plus `shell_run` — enough to investigate
and repair, but without the dedicated app, printer, and backup tooling the other platforms
have. Anything without a dedicated tool is still reachable through `shell_run` and playbooks,
under the same approval gates.

## Get started

### Download

Grab the BYOK build from the [Releases page](https://github.com/noahapp/noah-for-tinkerers/releases):
- **macOS** — `.dmg` (universal, Apple Silicon + Intel)
- **Windows** — `.msi` / `.exe` (x64)
- **Linux** — `.AppImage`

Noah keeps itself up to date after install.

Don't trust a binary? You don't have to. This is the whole app — read every line, or build
it yourself in a couple of minutes; see [CONTRIBUTING.md](CONTRIBUTING.md).

### Bring your own Anthropic key

Open **Settings** and paste an Anthropic key (it starts with `sk-ant-`) — or set
`ANTHROPIC_API_KEY` before launching. Your key is stored locally on your device and used
only to authenticate your own calls to Anthropic. The app has no accounts and no paywall;
the only other network calls are an update check and an anonymous, opt-out usage ping
(toggle it off in Settings).

## Safety

- **Looks before it leaps** — always runs read-only diagnostics first
- **Shows you the plan** — you see exactly what Noah will do before it does it
- **Flags risky actions** — `rm`, `sudo`, disk formatting, and similar commands require explicit approval with a plain-language explanation
- **Logs everything** — every action is recorded in a session journal you can review
- **Hard limits** — the catastrophic operations (wiping your home folder or keychains, erasing a disk) are blocked outright and can't be approved away; everything else risky is gated behind your explicit approval
- **Your key stays yours** — stored locally and used only to authenticate your own calls to Anthropic; it's never sent to a Noah server

## Design notes

How Noah is built, in depth — engineering design docs, each verified against the code:

- [Architecture](docs/design/0-architecture.md) — the LLM thinks, the local machine acts
- [Generative UI](docs/design/1-generative-ui.md) — the model fills UI slots instead of drawing components
- [One thread](docs/design/2-one-thread.md) — text, UI, and tool calls share one conversation stream
- [The safety harness](docs/design/3-safety-harness.md) — running real commands without running wild
- [Every command explains itself](docs/design/4-command-explanations.md) — plain-English reasons, enforced by schema
- [Playbooks](docs/design/5-playbooks.md) — Markdown as remediation programs
- [Bring your own key](docs/design/6-bring-your-own-key.md) — an agent with no backend

## Open source & contributing

Noah for Tinkerers is built in public. Issues, ideas, and pull requests are welcome — see
[CONTRIBUTING.md](CONTRIBUTING.md) to get a dev build running in a couple of minutes.

## Get Noah

**[⬇ Download Noah for Tinkerers](https://github.com/noahapp/noah-for-tinkerers/releases)** — the open, bring-your-own-key build. Read the source, hack on it, run it on your own key.

> **Prefer it fully managed?** [onnoah.app](https://onnoah.app) is the same idea with nothing
> to set up — no API key, no configuration. Two parallel tracks to the same place: pick the
> one that fits how you like to work.

## License

AGPL-3.0 — see [LICENSE](LICENSE).

---

*For development setup, architecture, and contributing guidelines, see [CONTRIBUTING.md](CONTRIBUTING.md).*
