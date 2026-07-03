# Playbooks — Manual Testing Guide

Automated coverage for the playbook system lives in `apps/desktop/src-tauri/src/playbooks.rs` (`cargo test playbooks`). This guide covers the end-to-end behaviors that need a running app and a live model: activation, protocol-following, and the bootstrap rules.

## Prerequisites

1. Dev app builds and runs: `pnpm --filter @noah/desktop tauri dev`
2. An Anthropic API key is configured (Settings, or `ANTHROPIC_API_KEY` in the environment)

Playbooks are bootstrapped to the app's knowledge directory. On macOS:

```
~/Library/Application Support/app.onnoah.tinkerers/knowledge/playbooks/
```

The debug panel (Cmd+D / Ctrl+D) shows tool calls as they happen — most tests below watch it.

---

## Test 1: Bootstrap — playbooks directory created on first run

**Steps:**
1. Delete the playbooks directory if it exists:
   ```bash
   rm -rf ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/
   ```
2. Launch the dev app
3. Check the directory:
   ```bash
   ls ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/
   ```

**Expected:**
- The directory exists and contains the bundled playbooks whose `platform:` matches your OS (or `all`) — on macOS that includes `network-diagnostics.md`, `disk-space-recovery.md`, `performance-forensics.md`, `printer-repair.md`, `app-doctor.md`, and the `setup-openclaw/` folder, among others
- No wrong-platform playbooks (e.g. no `windows-printer-repair.md` on a Mac)
- Each file starts with YAML frontmatter containing `name:` and `description:`

**Pass criteria:** Platform-appropriate bundled set present, each file has valid frontmatter

---

## Test 2: Playbook activation — network diagnostics

**Steps:**
1. Open the app and the debug panel (Cmd+D)
2. Type: **"my Wi-Fi keeps dropping every few minutes"**
3. Watch the debug panel for tool calls

**Expected:**
- An `activate_playbook` tool call with input `{"name": "network-diagnostics"}`
- The tool result contains the full playbook protocol
- Noah follows it, starting with `mac_ping` to `8.8.8.8`, and subsequent tool calls follow the playbook's order

**Pass criteria:** `activate_playbook` called, full protocol returned, Noah follows it systematically

---

## Test 3: Playbook activation — performance

**Steps:**
1. Start a new session
2. Type: **"my Mac is really slow and the fans are going crazy"**

**Expected:**
- `activate_playbook` called with `{"name": "performance-forensics"}`
- Noah runs `mac_system_info` and `mac_process_list` as the protocol's first step dictates
- Noah classifies the situation (CPU-bound, memory pressure, etc.) based on results

**Pass criteria:** Correct playbook activated, diagnostic tools called in protocol order

---

## Test 4: Playbook activation — disk space

**Steps:**
1. Start a new session
2. Type: **"I keep getting 'disk full' warnings, I can't even install updates"**

**Expected:**
- `activate_playbook` called with `{"name": "disk-space-recovery"}`
- Noah runs `mac_disk_usage` and `disk_audit`
- Results show a categorized breakdown of space usage

**Pass criteria:** Correct playbook activated, `disk_audit` produces categorized output

---

## Test 5: Playbook activation — printer

**Steps:**
1. Start a new session
2. Type: **"my printer isn't working, print jobs are stuck"**

**Expected:**
- `activate_playbook` called with `{"name": "printer-repair"}`
- Noah runs `mac_print_queue` first

**Pass criteria:** Correct playbook activated, follows printer protocol

---

## Test 6: Playbook activation — app crashes

**Steps:**
1. Start a new session
2. Type: **"Safari keeps crashing every time I open it"**

**Expected:**
- `activate_playbook` called with `{"name": "app-doctor"}`
- Noah runs `mac_app_list` and/or `crash_log_reader` with `{"app_name": "Safari"}`

**Pass criteria:** Correct playbook activated, crash log reader attempted

---

## Test 7: No playbook for simple questions (negative test)

**Steps:**
1. Start a new session
2. Type: **"what's my IP address?"**

**Expected:**
- Noah calls `mac_network_info` directly — **no** `activate_playbook` call
- A simple question gets a direct answer

**Pass criteria:** No `activate_playbook` in the debug log

---

## Test 8: No playbook for greetings (negative test)

**Steps:**
1. Start a new session
2. Type: **"hi there!"**

**Expected:**
- Noah responds conversationally — no tool calls at all

**Pass criteria:** No playbook activation for casual conversation

---

## Test 9: Compound tool — wifi_scan

**Steps:**
1. Start a new session
2. Type: **"scan my Wi-Fi environment and check for interference"**

**Expected:**
- `wifi_scan` called (directly or via a playbook)
- Output includes: SSID, signal (RSSI) in dBm, noise, channel, signal quality assessment, nearby networks

**Pass criteria:** `wifi_scan` returns structured Wi-Fi data

---

## Test 10: Compound tool — disk_audit

**Steps:**
1. Start a new session
2. Type: **"what's eating up my disk space?"**

**Expected:**
- `disk_audit` called (likely via the disk-space-recovery playbook)
- Output lists directories sorted by size with human-readable sizes
- Time Machine snapshot count shown if any exist

**Pass criteria:** Categorized space breakdown returned

---

## Test 11: Compound tool — crash_log_reader

**Steps:**
1. Start a new session
2. Type: **"check if there are any crash reports for Safari"**

**Expected:**
- `crash_log_reader` called with `{"app_name": "Safari"}`
- If crash reports exist: a summary with exception type, crashed thread, top stack frames
- If none: a clear "no crash reports found" message

**Pass criteria:** Tool runs without error, returns an appropriate result

---

## Test 12: crash_log_reader with log_path

**Steps:**
1. Start a new session
2. Type: **"show me the recent CUPS error log"**

**Expected:**
- `crash_log_reader` called with `{"log_path": "/var/log/cups/error_log"}`
- Returns the tail of the CUPS log (or a clean error if the file doesn't exist)

**Pass criteria:** Tool reads the specified log file

---

## Test 13: Custom playbook — pluggability

**Steps:**
1. Create a custom playbook (note `source: local` — it marks the file as yours, so app updates never overwrite it):
   ```bash
   cat > ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/test-custom.md << 'PLAYBOOK'
   ---
   name: test-custom
   description: A test playbook to verify custom playbook loading
   platform: all
   source: local
   ---

   # Test Custom Playbook

   ## When to activate
   User says "run the test playbook" or "test custom playbook".

   ## Protocol

   ### Step 1: Say hello
   Respond with: "Custom playbook loaded successfully!"

   ### Step 2: Check system
   Run `mac_system_info` to get basic system details.
   PLAYBOOK
   ```
2. **Restart the app** (playbooks are scanned on startup)
3. Type: **"run the test playbook"**

**Expected:**
- `activate_playbook` called with `{"name": "test-custom"}`
- Full custom playbook content returned, and Noah follows it

**Pass criteria:** Custom playbook detected, activatable, and followed

---

## Test 14: Custom playbook appears in context

**Steps:**
1. With the custom playbook from Test 13 in place, restart the app
2. In the debug panel, inspect the system prompt (first `llm_request` event), or type: **"what playbooks do you have available?"**

**Expected:**
- The system prompt's playbooks section lists the bundled set **plus** `test-custom` with its description

**Pass criteria:** Custom playbook visible in the available-playbooks list

---

## Test 15: Ownership rules on restart

Bundled playbooks are refreshed on every launch; files marked `source: local` (or `source: fleet`) are never overwritten.

**Steps:**
1. Edit a **bundled** playbook:
   ```bash
   echo "CUSTOM EDIT" >> ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/network-diagnostics.md
   ```
2. Restart the app and check the file:
   ```bash
   tail -1 ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/network-diagnostics.md
   ```
3. Confirm the custom playbook from Test 13 is untouched:
   ```bash
   head -6 ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/test-custom.md
   ```

**Expected:**
- The bundled file is restored to its shipped content (the "CUSTOM EDIT" line is gone) — bundled files are not the place for local changes
- The `source: local` file survives exactly as written

**Pass criteria:** Bundled refreshed, local preserved. To customize a bundled playbook, copy it to a new name with `source: local`.

---

## Test 16: activate_playbook error handling

**Unit test:**
```bash
cd apps/desktop/src-tauri && cargo test playbooks -- --nocapture
```

**Expected:**
- `test_read_playbook_not_found` passes: activating a nonexistent name returns an error that includes "not found" and points to `list_knowledge` (category `playbooks`) to discover what's available

**Pass criteria:** Graceful error that tells the model how to recover

---

## Cleanup

```bash
rm ~/Library/Application\ Support/app.onnoah.tinkerers/knowledge/playbooks/test-custom.md
```

---

## Quick smoke test (if short on time)

1. **Test 1** (bootstrap) — infrastructure works
2. **Test 2** (network diagnostics) — end-to-end playbook activation
3. **Test 7** (simple question) — no regression for non-playbook queries
