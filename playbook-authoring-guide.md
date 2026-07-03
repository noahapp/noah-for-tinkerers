# Noah Playbook Authoring Guide

A playbook is a markdown document that teaches Noah (an AI agent) how to guide
a user through a task. Noah reads the playbook and follows it as a protocol —
executing commands automatically where possible, and pausing for human action
where necessary.

This guide is the spec. Any AI that reads it can produce valid Noah playbooks
from human-written tutorials, documentation, or setup guides.

---

## Core Concept

A tutorial says: "Open Terminal and type `npm install -g openclaw`."

A playbook says:

```
## Step 2: Install OpenClaw

Run `shell_run` with `npm install -g openclaw@latest`.
Verify: `openclaw --version`.

If `openclaw` is not found, the npm global bin may not be in PATH.
Run `shell_run` with `npm prefix -g` and advise the user to add it.
```

The transformation:
1. **Commands** become tool invocations (Noah executes them)
2. **Browser/GUI actions** become WAIT_FOR_USER steps (user does them, confirms)
3. **Credentials** become `secure_input` (collected safely, never in LLM context)
4. **Choices** become `ui_user_question` with options
5. **Verification** becomes diagnostic commands after each step
6. **Context/explanation** stays as prose (Noah relays it to the user)

---

## File Format

### Frontmatter (required)

```yaml
---
name: my-playbook-name
description: One-line summary of what this playbook does
platform: all
last_reviewed: 2026-03-09
author: your-name
source: local
---
```

| Field | Values | Notes |
|---|---|---|
| `name` | hyphenated slug | Must match filename (without `.md`). For sub-modules: `folder/module-name` |
| `description` | < 120 chars | Shown in the knowledge TOC. Be specific. |
| `platform` | `all`, `macos`, `windows`, `linux` | Noah only loads playbooks matching the user's OS |
| `last_reviewed` | `YYYY-MM-DD` | When the playbook was last verified accurate |
| `author` | string | Credit |
| `source` | `bundled`, `local`, or `fleet` | `bundled` = ships with Noah (auto-updated). `local` = your own file (preserved across updates). `fleet` = pushed by an administrator. Use `local` for playbooks you write. The legacy `type:` field (`system`/`user`) is still accepted. |
| `emoji` | optional, a single emoji | Icon shown on the progress card |

### Body Structure

```markdown
# Title

Brief description of what this playbook accomplishes and when to use it.

## When to activate
User wants to [do X], mentions "[keyword]", or has [symptom].

## Step 1: [Label]
[Instructions for Noah]

## Step 2: [Label]
[Instructions for Noah]

...

## Step N: Done
Show a done card summarizing what was accomplished.

## Tools referenced
- `tool_name` — what it's used for here
```

---

## The Step DSL

Steps are declared with level-2 markdown headers:

```markdown
## Step 1: Check Environment
## Step 2: Install Dependencies
## Step 3: Configure
```

**Rules:**
- Use `## Step N: Label` format (N starts at 1)
- Noah's orchestrator parses these headers to track progress (Step 2 of 5, etc.)
- Each step maps to one or more interactive turns with the user
- Steps execute sequentially — no branching within a playbook

**Accepted formats** (all equivalent, but prefer `## Step N: Label`):
```
## Step 1: Check Environment
## Step 1 — Check Environment
## Step 1. Check Environment
```

---

## Instructing Noah: The Five Patterns

### Pattern 1: Automated Action (Noah runs a command)

```markdown
## Step 2: Install Package

Run `shell_run` with `npm install -g openclaw@latest`.
After install, verify: run `shell_run` with `openclaw --version`.

If `openclaw` command is not found, the npm global bin directory may not be
in PATH. Run `shell_run` with `npm prefix -g` and tell the user to add
`$(npm prefix -g)/bin` to their PATH.
```

**When to use:** The action is a CLI command or tool invocation that Noah can
execute without user intervention.

**Noah will:** Call the tool, check the result, report to user via `ui_spa`
with `action_type: "RUN_STEP"`.

### Pattern 2: Human-in-the-Loop (User does something outside Noah)

```markdown
## Step 1: Create App in Developer Console

Tell the user:

> 1. Go to https://open.feishu.cn/app and log in
> 2. Click "创建企业自建应用" (Create enterprise app)
> 3. Enter an app name and description
> 4. In **凭证与基础信息** (Credentials), copy the **App ID** and **App Secret**

Use WAIT_FOR_USER — the user does this in their browser.
```

**When to use:** The action requires a browser, a phone, a GUI app, or
physical interaction that Noah cannot perform.

**Noah will:** Show the instructions via `ui_spa` with
`action_type: "WAIT_FOR_USER"` and `action_label: "I've done this"`.

**Critical rule:** The `situation_md` MUST contain the exact instructions
(URLs, button names, what to click). Never just say "I'll guide you through
this" — the instructions must be self-contained in the card.

### Pattern 3: Collect User Input

**For choices (predefined options):**
```markdown
## Step 5: Choose Access Policy

Ask the user which access policy they want:

- **Pairing** (recommended): new users get a pairing code, admin approves
- **Open**: anyone in the organization can message the bot
- **Allowlist**: only specific user IDs can message

Use `ui_user_question` with options.
```

**For free-text input:**
```markdown
## Step 3: Enter Bot Name

Ask the user what they want to name their bot.
Use `ui_user_question` with `text_input` (placeholder: "e.g. My AI Assistant").
```

**For credentials:**
```markdown
## Step 4: Enter Credentials

Collect the App ID via `text_input` (it's not secret — format: `cli_xxx`).
Collect the App Secret via `secure_input` (secret_name: "feishu_app_secret").
```

**Important:** `secure_input` values are stored in an ephemeral store and
never enter the LLM's context window. Use `write_secret` to write them to
config files with `{{value}}` substitution.

### Pattern 4: Conditional Sub-Module Activation

```markdown
## Step 3: Set Up Messaging Channel

Ask which platform the user wants to connect:
- **Feishu (飞书)** — most common for Chinese teams
- **Telegram** — popular internationally
- **WhatsApp** — consumer messaging

Based on the user's choice:
- Feishu: activate `setup-openclaw/add-feishu`
- Telegram: activate `setup-openclaw/add-telegram`
- WhatsApp: activate `setup-openclaw/add-whatsapp`
```

**When to use:** The tutorial has branches or optional sections that are
substantial enough to warrant their own playbook file.

### Pattern 5: Verification

```markdown
## Step 6: Verify

Run `shell_run` with `openclaw channels status --probe`.
Expected: channel shows "connected" or "ready".

If not connected, run `shell_run` with `openclaw logs --follow` and
look for error messages. Common issues:
- "permission denied" → permissions not granted or app not published
- "connection refused" → gateway not running
```

**Every playbook should end with a verification step.** Don't just assume
success — run a check and handle common failure modes.

---

## Credential Handling

Noah has a secure credential pipeline:

1. **Collect** — `ui_user_question` with `secure_input` (masked input field)
2. **Store** — Orchestrator keeps value in ephemeral HashMap (never in LLM context)
3. **Write** — `write_secret` tool substitutes `{{value}}` into a file

```markdown
Collect the API key via `secure_input` (secret_name: "api_key").

Then write it to the config:
Use `write_secret` with secret_name "api_key",
file_path "~/.config/app/config.env",
format "API_KEY={{value}}".
```

**When to use `secure_input`:**
- API keys, tokens, secrets
- Passwords

**When to use `text_input` instead:**
- Usernames, email addresses, URLs
- App IDs that aren't secret (e.g., `cli_xxx`)
- File paths, domain names

---

## Folder Playbooks (Multi-File)

For complex setups with optional branches, use a folder structure:

```
playbooks/
  setup-myapp/
    playbook.md          ← main entry point (REQUIRED, name must be "playbook.md")
    install-deps.md      ← sub-module
    configure.md         ← sub-module
    add-slack.md         ← optional module
    add-discord.md       ← optional module
    troubleshooting.md   ← diagnostic sub-module
    config-reference.md  ← reference sub-module
```

**The main `playbook.md`:**
- Contains the primary step sequence
- References sub-modules via `activate` instructions
- Lists all available modules at the end

**Sub-modules:**
- Same format as any playbook (frontmatter + steps)
- `name` field uses path format: `setup-myapp/add-slack`
- Can be activated from the main playbook or independently

**The main playbook should end with an "Available Modules" section:**
```markdown
## Available Modules

- **setup-myapp/configure** — Edit configuration (models, channels, etc.)
- **setup-myapp/add-slack** — Add Slack integration
- **setup-myapp/add-discord** — Add Discord integration
- **setup-myapp/troubleshooting** — Diagnostic commands and common fixes
```

---

## Converting a Tutorial: Step-by-Step

Given a human-written tutorial, follow this process:

### 1. Identify the Audience

- Is this for all platforms or OS-specific? → sets `platform`
- Does it assume prerequisites? → add a prerequisite check step

### 2. Classify Each Section

Read each section of the tutorial and classify it:

| Tutorial Content | Playbook Pattern |
|---|---|
| "Run this command in terminal" | **Automated** — `shell_run` |
| "Open this URL and click..." | **WAIT_FOR_USER** — user does it in browser |
| "Enter your API key" | **secure_input** — credential collection |
| "Choose option A or B" | **ui_user_question** with options |
| "Type your project name" | **text_input** — free-form input |
| "If you want feature X..." | **Conditional** — sub-module or option |
| "Expected output: ..." | **Verification** — check after action |
| "Troubleshooting: ..." | **Separate sub-module** or inline guidance |
| Explanation/context | **Prose** — kept as-is for Noah to relay |

### 3. Handle Ordering Dependencies

Tutorials sometimes have order-dependent steps that aren't obvious:

```markdown
> ⚠️ Event subscription must be configured AFTER the gateway starts,
> otherwise validation will fail.

## Step 4: Configure Event Subscription

**Prerequisite:** Gateway must be running (Step 6 starts it).
If doing steps in order, tell the user to skip this and come back after Step 6.
Alternatively, do Steps 5-6 first, then return here.
```

In playbooks, enforce ordering explicitly. If a tutorial says "you can do
this step later," restructure the steps so they execute in the right order.

### 4. Preserve Critical Details

Tutorials contain details that look minor but are critical:

- **Exact JSON payloads** (permission lists, config snippets) — include verbatim
- **URL differences by region** (e.g., `open.feishu.cn` vs `open.larksuite.com`)
- **Format hints** (e.g., "App ID looks like `cli_xxx`") — helps user verify
- **Timing notes** ("wait a few minutes for approval") — becomes WAIT_FOR_USER
- **Common mistakes** ("don't choose Webhook, choose long connection") — inline warnings

### 5. Add What Tutorials Often Miss

- **Verification after each major step** — tutorials assume success
- **Rollback/cleanup on failure** — what to undo if a step fails
- **Platform-specific variants** — tutorials often assume one OS
- **Bilingual labels** — for international products, include both languages:
  `**权限管理** (Permissions)` so both Chinese and English users can find it

### 6. Write the "Tools Referenced" Section

List every Noah tool the playbook uses. This serves as documentation and
helps verify the playbook doesn't reference nonexistent tools.

```markdown
## Tools referenced
- `shell_run` — CLI commands (install, configure, verify)
- `ui_user_question` with `secure_input` — API key collection
- `ui_user_question` with options — access policy choice
- `ui_spa` with WAIT_FOR_USER — browser-based setup steps
- `write_secret` — write credentials to config files
```

---

## Noah's Available Tools

When writing playbooks, you can reference these tools:

### UI Tools (how Noah communicates with the user)
| Tool | Purpose |
|---|---|
| `ui_spa` | Show situation + plan + action button. Two modes: `RUN_STEP` (Noah executes) or `WAIT_FOR_USER` (user acts) |
| `ui_user_question` | Ask user a question. Modes: `options` (predefined choices), `text_input` (free text), `secure_input` (masked credentials) |
| `ui_done` | Show completion summary. Only after verification succeeds. |
| `ui_info` | Informational message (can't fix, safety refusal, general info) |

### Action Tools
| Tool | Purpose |
|---|---|
| `shell_run` | Execute a shell command. Use for any CLI operation. |
| `write_secret` | Write a `secure_input` value to a file with `{{value}}` substitution |

### Knowledge Tools
| Tool | Purpose |
|---|---|
| `activate_playbook` | Load a playbook or sub-module by name |
| `knowledge_search` | Search knowledge base for files and content |
| `knowledge_read` | Read a knowledge file by path |

### Platform-Specific Tools (examples — availability varies by OS)
| Tool | Platform | Purpose |
|---|---|---|
| `mac_network_info` | macOS | Network interface details |
| `mac_ping` | macOS | Connectivity test |
| `mac_dns_check` | macOS | DNS resolution test |
| `mac_disk_usage` | macOS | Disk space overview |
| `disk_audit` | macOS | Find large files/folders |
| `win_network_info` | Windows | Network interface details |
| `win_ping` | Windows | Connectivity test |

**Rule:** Only reference tools that exist. When in doubt, use `shell_run` —
it can execute any command. Platform-specific tools are faster and safer but
not always available. Playbooks with `platform: all` should stick to
`shell_run` and UI tools.

---

## Language & Tone in Playbooks

Playbooks are instructions for an AI agent, not documentation for humans.

**Do:**
- Write imperatively: "Run X", "Tell the user Y", "Verify Z"
- Be specific: "Run `shell_run` with `node --version`"
- Include failure handling: "If X fails, try Y"
- Include the exact text/URLs the user needs to see

**Don't:**
- Write conversationally: ~~"Now we'll install the package"~~
- Be vague: ~~"Check if it's working"~~ → "Run `openclaw --version`, expect version ≥ 2026.2"
- Assume success: always include what to check and what failure looks like
- Include emoji or decorative formatting (Noah formats its own UI)

---

## Quality Checklist

Before submitting a playbook:

- [ ] Frontmatter has all required fields (`name`, `description`, `platform`, `source`)
- [ ] Every step has a `## Step N: Label` header
- [ ] Steps are in executable order (no forward dependencies)
- [ ] Every WAIT_FOR_USER step has concrete instructions (not "I'll guide you")
- [ ] Credentials use `secure_input`, not `text_input`
- [ ] There's a verification step near the end
- [ ] Common failure modes are handled inline
- [ ] The "Tools referenced" section lists all tools used
- [ ] For folder playbooks: `playbook.md` exists as the entry point
- [ ] For folder playbooks: "Available Modules" section lists all sub-modules
- [ ] No references to nonexistent tools
- [ ] `platform` field matches the tools referenced (don't use `mac_*` in a `platform: all` playbook)

---

## Example: Converting a Tutorial Section

### Original Tutorial (human-written)

> **配置权限**
>
> 1. 左侧菜单进入 **权限管理**
> 2. 点击 **批量导入**
> 3. 粘贴以下 JSON：
> ```json
> { "scopes": { "tenant": ["im:message", "im:message:send_as_bot", ...] } }
> ```

### Converted Playbook Step

```markdown
## Step 3: Configure Permissions

Tell the user to configure permissions in the Feishu developer console:

> 1. In your app settings, go to **权限管理** (Permissions)
> 2. Click **批量导入** (Batch import)
> 3. Paste the following JSON to import all required permissions:
>
> ```json
> {
>   "scopes": {
>     "tenant": [
>       "im:message",
>       "im:message:send_as_bot",
>       ...full list here...
>     ]
>   }
> }
> ```

Use WAIT_FOR_USER — the user does this in the Feishu developer console.
```

### Why this conversion works:
- The action (pasting JSON in a web console) can't be automated → WAIT_FOR_USER
- The instructions are self-contained (user doesn't need the original tutorial)
- Bilingual labels help both Chinese and English users find the right UI element
- The full JSON is preserved (not summarized)

---

## Example: Full Minimal Playbook

```markdown
---
name: setup-example-app
description: Install and configure Example App with API access
platform: all
last_reviewed: 2026-03-09
author: your-name
source: local
---

# Set Up Example App

Install Example App and connect it to an API provider.

## When to activate
User wants to install Example App, set up API access, or mentions "example app".

## Step 1: Check Prerequisites

Run `shell_run` with `node --version`.
Need Node.js 18+. If missing or old, tell the user to install Node.js first.

Run `shell_run` with `which example-app` to check if already installed.
If already installed, skip to Step 3.

## Step 2: Install

Run `shell_run` with `npm install -g example-app@latest`.
Verify: run `shell_run` with `example-app --version`.

## Step 3: Configure API Key

Collect the API key via `secure_input` (secret_name: "example_api_key").

Write it to config:
Use `write_secret` with secret_name "example_api_key",
file_path "~/.example-app/config.env",
format "API_KEY={{value}}".

## Step 4: Start Service

Run `shell_run` with `example-app start`.
Verify: run `shell_run` with `example-app status`.
Expected: "running" and "healthy".

## Step 5: Done

Show a done card summarizing:
- Example App version
- Service status
- Config file location: `~/.example-app/config.env`
- How to check status: `example-app status`
- How to view logs: `example-app logs`

## Tools referenced
- `shell_run` — install, configure, verify
- `ui_user_question` with `secure_input` — API key collection
- `write_secret` — write API key to config
- `ui_spa` with RUN_STEP — automated steps
- `ui_done` — completion summary
```
