# Architecture

Noah is an agent that fixes computers. The organizing principle is a split of responsibility: **the LLM thinks, the local machine acts.** Claude decides *what* to do — which diagnostic to run, which fix to apply, what to ask the user — but it never touches the machine. Every action is a named tool call that Claude emits and the Rust backend executes locally. The only thing that ever leaves the device is the conversation with Claude: the message history, the tool definitions, and the tool results. There is no Noah server in the loop. The user brings their own Anthropic API key, and the app talks to the Anthropic API directly.

This split is what makes the safety model tractable. Because thinking and acting are physically separate — one in the model, one in a Rust process the user controls — the acting side can enforce its own rules regardless of what the model asks for. The model proposes; the harness disposes. Everything below is a consequence of that one decision.

This page is the overview; each layer is covered in depth by the companion docs linked under [Read next](#read-next).

## Layers

The app is four layers deep. Reading top to bottom is reading a single user request as it travels from a keystroke to a system change and back:

```
┌──────────────────────────────────────────────────────────────────┐
│  React + TypeScript UI              apps/desktop/src/            │
│  Composer, chat cards, action approval, session sidebar          │
│  Renders generative-UI payloads (ui_spa / question / info)       │
└──────────────────────────────┬───────────────────────────────────┘
                               │ Tauri commands (invoke)
                               │ events back up (emit)
                               v
┌──────────────────────────────────────────────────────────────────┐
│  Tauri 2 bridge            apps/desktop/src-tauri/src/commands/  │
│  Typed command handlers <-> Rust, approval + debug events        │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               v
┌──────────────────────────────────────────────────────────────────┐
│  Rust backend              apps/desktop/src-tauri/src/agent/     │
│                                                                  │
│   ┌─────────────────────────┐        ┌─────────────────────────┐ │
│   │  Orchestrator           │  ───>  │  Tool Router            │ │
│   │  agentic loop           │        │  name -> &dyn Tool      │ │
│   │  send_message()         │  <───  │  tool_definitions()     │ │
│   │  approval + safety gate │        │  (about 40 tools by OS) │ │
│   └────────────┬────────────┘        └────────────┬────────────┘ │
│                │                                  │              │
│      ──────────┼────────  THINK / ACT  ───────────┼────────      │
│                │                                  │              │
│                v                                  v              │
│   ┌─────────────────────────┐        ┌─────────────────────────┐ │
│   │  Claude API    (THINK)  │        │  Local system   (ACT)   │ │
│   │  decides tool calls     │        │  shell, network, disk,  │ │
│   │  BYOK, leaves device    │        │  apps, printers, files  │ │
│   └─────────────────────────┘        └────────────┬────────────┘ │
│                                                   │              │
└───────────────────────────────────────────────────┼──────────────┘
                                                    │
                                                    v
┌──────────────────────────────────────────────────────────────────┐
│  SQLite                    apps/desktop/src-tauri/src/safety/    │
│  sessions, messages, journal (changes + undo), llm_traces        │
│  Local file. Never synced.                                       │
└──────────────────────────────────────────────────────────────────┘
```

The THINK / ACT divider marks the split of responsibility. Left of it, a request becomes intent; right of it, intent becomes a system change. The two halves never merge — the Claude API cannot reach the disk, and the local tools cannot reason. They meet only in the orchestrator, which shuttles one to the other.

## The Tool trait

Every capability Noah has — every ping, cache-clear, log-read, shell command — is a type that implements one trait. It lives in the shared `noah-tools` crate (`crates/noah-tools/src/tool.rs`) so tools can be defined outside the desktop app and shared across platforms:

```rust
#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;          // JSON Schema, shown to Claude
    fn safety_tier(&self) -> SafetyTier;
    fn safety_tier_for_input(&self, _input: &Value) -> SafetyTier { self.safety_tier() }
    async fn execute(&self, input: &Value) -> Result<ToolResult>;
}
```

`name`, `description`, and `input_schema` are the tool's face to the model — they become an entry in the tool list sent to Claude, so the description and schema *are* the prompt engineering for that capability. `execute` is its face to the machine. The two never mix: Claude sees the schema and picks the arguments; the Rust side receives those arguments and runs the real operation.

`safety_tier_for_input` is the hinge that makes a single tool safe for many jobs. Its default just returns the tool's static tier, but a tool can override it to grade *this specific call*. `shell_run` uses this: a read-only `ls` and an `rm -rf` are the same tool, but the tier is computed from the command, so one runs freely and the other stops for approval.

## Safety tiers

`SafetyTier` (`crates/noah-tools/src/types.rs`) has exactly three levels, in ascending order of consequence:

- **`ReadOnly`** — observes, changes nothing. Diagnostics, log reads, `ping`. Runs without friction.
- **`SafeAction`** — a reversible or low-consequence change. Flushing DNS, clearing a cache. Runs without a prompt.
- **`NeedsApproval`** — a consequential change. Killing a process, deleting a file, an untrusted shell command. The orchestrator halts and asks the user before `execute` is ever called.

A tool call also carries its receipt. `execute` returns a `ToolResult { output, data, changes }`, where `changes` is a `Vec<ChangeRecord>` and each record names *how to undo itself* (`description`, `undo_tool`, `undo_input`). The orchestrator writes these to the SQLite journal, which is what makes a change reviewable — and, where a tool provides the inverse, reversible — after the fact.

Tiering is advice from the tool; enforcement is separate and lives in the harness. The orchestrator layers two more gates on top of the tier before any `NeedsApproval` call runs: a **fleet policy** override (an administrator can force-approve, force-prompt, or hard-block a tool by name), and an **inspect-before-delete redline** for `shell_run` — a deletion inside a protected tree is held back until Noah has actually looked at the target this session, mirroring a read-before-write discipline. Both live in `execute_tool` in `orchestrator.rs`; the redline rationale is in [the safety policy](../../apps/desktop/src-tauri/docs/safety-policy.md). The point is structural: safety does not depend on the model choosing to behave, because the model is not the thing running the command.

## Registering tools and exposing them to Claude

Tools are collected into a `ToolRouter` (`apps/desktop/src-tauri/src/agent/tool_router.rs`) at startup. The router is a flat registry: `register(tool)` pushes a boxed `dyn Tool`, `find_tool(name)` resolves a call back to its implementation, and `tool_definitions()` projects every registered tool into the `{name, description, input_schema}` shape the Anthropic API expects. That projection is the *entire* interface Claude has to the machine — Claude knows a tool exists if and only if it appears here.

Registration happens in two bands. Platform tools are wired per-OS behind `#[cfg]` gates via `platform::register_platform_tools`, which dispatches to `register_tools` in `platform/macos/mod.rs`, `platform/windows/mod.rs`, or `platform/linux/mod.rs`. On macOS that is network, printer, performance, app, and diagnostic tools plus `shell_run` (~27 registrations); Windows is comparable (~26); Linux is a smaller set (~13). On top of that, `lib.rs` registers a cross-platform band the same way: knowledge read/search/write, the four generative-UI tools plus `write_secret`, `web_fetch`, and `activate_playbook`. The total the model sees is therefore platform-dependent — roughly three to four dozen tools, most on macOS, fewer on Linux.

Not every registered tool ends in a system call. The `ui_*` tools return a UI payload the frontend renders, and the orchestrator intercepts them as a terminal step (see below). They are Tools because that is the only channel the model has: to draw a card, Claude "calls a tool," and the harness turns that call into rendered UI instead of a shell command.

## The agentic loop

`Orchestrator::send_message` (`apps/desktop/src-tauri/src/agent/orchestrator.rs`) is the engine. One user message drives a loop that runs until the model stops asking for tools:

1. **Assemble context.** `messages_for_llm` builds the request: any compressed summary of older turns first, then the verbatim recent history. The system prompt (OS context, the knowledge table-of-contents, locale, mode) and the full tool-definition list are attached. If the running estimate of context size crosses a threshold, older turns are summarized and dropped before the call — the loop self-manages its window.
2. **Ask Claude.** Send to the Anthropic API. The response is a list of blocks: text, tool-use, or both. This is the only network egress in the loop, and it is the *think* step. Every request/response is written to the `llm_traces` table for debugging.
3. **Branch on the response.**
   - **A single `ui_*` call** ends the turn: its payload is validated and returned to the frontend as the visible answer. The orchestrator enforces that generative-UI calls are exactly one and never mixed with other tools in the same turn — a policy guard feeds a correction back to the model if it violates this.
   - **Text with no tool calls** ends the turn: the accumulated text is the answer.
   - **Other tool calls** are executed. Each goes through `execute_tool` — tier check, fleet-policy override, redline gate, approval prompt if needed, then `execute`. Results (and any errors) are appended to the history as tool-result blocks, and the loop returns to step 1.
4. **Guard against spinning.** If the same set of tool calls repeats three turns running, the loop breaks and tells the user it was stuck, rather than looping forever on the user's API bill.

In effect, the loop is a conversation the machine has with itself on the user's behalf. Claude proposes an action, Rust performs it and reports back, Claude reads the result and proposes the next — turn after turn — until the problem is diagnosed or fixed and Claude renders a final card. The user sees the endpoints (their request, the actions they approve, the result); the intermediate turns are the agent working.

## Read next

Each deep-dive doc takes one slice of the system down to the code and carries its own **Limitations** section spelling out what that slice does not cover.

1. [Generative UI](./1-generative-ui.md) — how `ui_spa` / `ui_user_question` / `ui_info` / `ui_done` turn a tool call into a rendered card, and why the model draws the interface.
2. [One thread](./2-one-thread.md) — the single-conversation session model: history, compression, restore, and why there is one continuous thread.
3. [The safety harness](./3-safety-harness.md) — safety tiers, the approval flow, fleet policy, the inspect-before-delete redline, and the change journal in full.
4. [Command explanations](./4-command-explanations.md) — how proposed actions are explained to the user before they approve them.
5. [Playbooks](./5-playbooks.md) — `activate_playbook`, the knowledge/playbooks store, step tracking, and run observability.
6. [Bring your own key](./6-bring-your-own-key.md) — the BYOK auth model, what leaves the device, and what never does.
