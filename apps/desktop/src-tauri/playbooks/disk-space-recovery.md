---
name: disk-space-recovery
description: Reclaim disk space on macOS — measure, audit, clean cache-class data, report freed bytes
platform: macos
last_reviewed: 2026-06-05
author: noah-team
source: bundled
emoji: 💾
---

# Disk Space Recovery

## When to activate
Explicit: "clean up my storage", "free disk space", "find space hogs", "check storage", "storage almost full", "low storage", "can't install update". Symptom-driven: Mac feels slow AND free space is below the healthy target.

## Scope
**In**: cache-class data — package managers, Xcode/simulators/DerivedData, app caches (Slack, Discord, Code, Cursor), Trash, old logs, stale incomplete downloads, old macOS installers.
**Out (redirect)**: moving files to cloud (use the provider's selective-sync); uninstalling apps (Applications folder for now); Photos/Mail/Messages bodies (TCC — System Settings → Storage).

## Heuristics
- ≥20% free → healthy, don't push cleanup.
- 10–20% → tight, cleanup recommended.
- <10% → critical; APFS performance degrades.
- macOS major updates need 15–30 GB free regardless of percent.
- One batch confirmation per session; accept any affirmative reply.
- ~0 bytes freed → run the holder diagnostic, surface the process, ask user to quit. Don't auto-quit. Don't loop.

## Pipeline
1. **Measure**: `mac_disk_usage` + `disk_audit`. If healthier than target AND the prompt was symptom-driven (not explicit), say so and stop.
2. **Propose** in SPA findings: group as auto-safe, ask-once (Simulator full reset, Docker prune, old installers), won't-touch (held by a running app, or on Critical exclusions). One batch confirm.
3. **Execute**: `mac_clear_caches` for `~/Library/Caches/`; recipes below via `shell_run` for the rest. Noah's shell policy gates destructive `rm`/`sudo`.
4. **Verify**: re-run `mac_disk_usage`; compute delta vs step 1.
5. **Report** via SPA findings: starting free, ending free, per-category freed, items skipped with reason. If target not met, ONE concrete next move — not a list.

## Recipes

**Cache workhorses** (skip a line if the tool/bundle isn't present):
```bash
command -v npm && npm cache clean --force && rm -rf ~/.npm/_cacache ~/.npm/_npx ~/.npm/_logs
command -v pnpm && pnpm store prune
command -v yarn && yarn cache clean && rm -rf ~/Library/Caches/Yarn
command -v uv && uv cache prune || (command -v pip3 && pip3 cache purge)
command -v cargo && rm -rf ~/.cargo/registry/cache ~/.cargo/registry/src ~/.cargo/git/checkouts
command -v go && go clean -modcache && go clean -cache
command -v brew && brew cleanup --prune=30 && brew autoremove
rm -rf ~/Library/Application\ Support/Slack/{Cache,Code\ Cache,GPUCache}/*
rm -rf ~/Library/Application\ Support/discord/{Cache,Code\ Cache,GPUCache}/*
rm -rf ~/Library/Application\ Support/Microsoft/Teams/{Cache,Code\ Cache,GPUCache,tmp}/*
rm -rf ~/Library/Application\ Support/{Code,Cursor,Zed}/{Cache,CachedData,CachedExtensions,Code\ Cache,GPUCache,logs}/*
rm -rf ~/Library/Caches/com.spotify.client/*   # never ~/Library/Application Support/Spotify (offline music)
find ~/.Trash -mindepth 1 -maxdepth 1 -exec rm -rf {} +
find ~/Library/Logs -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} +
pgrep -x Mail || find ~/Library/Containers/com.apple.mail/Data/Library/Mail\ Downloads -type f -mtime +30 -delete
pgrep -x Xcode || rm -rf ~/Library/Developer/Xcode/DerivedData/* ~/Library/Developer/Xcode/{iOS,watchOS,tvOS}\ DeviceSupport/* ~/Library/Caches/com.apple.dt.Xcode/*
find /Applications -maxdepth 1 -name 'Install macOS*.app' -mtime +14 -not -name "*$(sw_vers -productVersion | cut -d. -f1)*" -exec rm -rf {} +
```

**iOS Simulator full reset** (lock-prone; do in order, do not loop):
```bash
pgrep -fl 'Simulator|CoreSimulator|com.apple.iphonesimulator' || echo clear
xcrun simctl delete unavailable
xcrun simctl shutdown all 2>/dev/null; xcrun simctl delete all
rm -rf ~/Library/Developer/CoreSimulator/Caches/*
```
On `currently in use` / `Failed to eject`: run the holder diagnostic, surface the process name, STOP. Don't `launchctl bootout`, don't `killall`.

**Holder diagnostic** (use when a row returns ~0 freed):
```bash
lsof +D '<path>' 2>/dev/null | awk 'NR>1 {print $1}' | sort -u | head
```

**Internal vs DMG/external** (run before any cleanup):
```bash
diskutil info -plist / | plutil -p - | grep -E 'Ejectable|RemovableMedia|VolumeName'
```
Refuse to clean ejectable/external volumes unless the user named them.

**Cloud provider detection** (when user mentions cloud):
```bash
ls -la ~/Library/CloudStorage/ ~/Library/Mobile\ Documents/ 2>/dev/null
```
Folder hints: `GoogleDrive-*`, `Dropbox`, `OneDrive*`, `com~apple~CloudDocs` (iCloud).

## Critical exclusions
Refuse even with user blessing:
- `~/.claude/`, `~/.local/share/claude/`, `~/Library/Application Support/Codex/`, `~/Library/Logs/com.openai.codex/` — AI assistant state and history (Claude Code, Codex Desktop).
- `~/Library/Application Support/{Code,Cursor,Zed}/User/` — editor settings (Cache* subdirs are fine).
- `~/Library/Application Support/{1Password,Bitwarden,Dashlane}/` — credential vaults.
- `~/Library/Application Support/Spotify/` (incl. `PersistentCache/`) — offline music.
- `~/Library/Application Support/Final Cut Pro/`, `*.fcpbundle/Original\ Media/`, `*.flexolibrary` — irreplaceable media.
- `~/Library/Keychains/`, `~/Library/Application Support/com.apple.TCC/`, `com.apple.security*` — auth and permission state.
- `~/Library/Mobile Documents/`, `~/Library/Photos/Libraries/`, `~/Pictures/Photos\ Library.photoslibrary/` — iCloud / user media.
- `~/Library/Application Support/MobileSync/Backup/` — iOS device backups.
- `~/Documents/`, `~/Desktop/`, `~/Movies/`, `~/Music/`.
- Any `<App>.app/Contents/Frameworks/*/Versions/Current` symlink target or newest version.
- `~/.docker/Desktop/{vms,data}/` — use `docker system prune` instead.
- `.DocumentRevisions-V100` (anywhere) — macOS document versioning DB.
- `/Volumes/*/.Trashes/` — external-drive trash.

## Caveats
- **Purgeable space** is freed automatically (real available = free + purgeable). **System Data** in About This Mac is mostly auto-managed.
- A background scanner feeds `disk_audit` when idle; trigger a fresh scan from Diagnostics if results look stale.

## Key signals
- "Can't install macOS update" → needs 15–30 GB free; run pipeline, retry update.
- "Disk was fine yesterday" → runaway log or crash loop. Audit `~/Library/Logs` and `~/Library/Logs/DiagnosticReports`.
- "Already emptied Trash" → big consumers are dev artifacts (Xcode, simulators, Docker) and iOS backups.
- ~85% of low-disk cases resolve via the standard pipeline; the remaining ones are user media (Photos, iOS backups) or genuinely-needed working files.

## Tools referenced
- `mac_disk_usage` — top-line stats.
- `disk_audit` — categorized breakdown.
- `mac_clear_caches` — clears `~/Library/Caches/`.
- `shell_run` — runs the recipes; policy gates destructive `rm`/`sudo`.

## Escalation
If the pipeline doesn't free enough:
- iCloud / Optimize Mac Storage for Documents, Desktop, Photos.
- For developers, Xcode + simulators + Docker can legitimately use 100+ GB — don't push to delete working files.
- External or larger internal drive is the real answer if still stuck.
