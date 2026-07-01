# One thread for text, UI, and tools

> **Status/scope:** Doc 2 of 7 — describes shipping behavior in `apps/desktop` as of this reading. Scope: the single message stream that carries plain text, model-emitted interactive cards, user clicks, and tool results. File:line citations are current at time of writing; verify against `git blame` if the code has since moved.

The chat thread and the interactive UI — action cards, approve buttons, question forms — are the **same message stream**. A UI card the model emits, a user clicking "Fix it," and a tool result are not three subsystems; they are three turns in one `Session.messages: Vec<Message>`. The interface *is* the conversation. The model reasons over its own past UI and the user's clicks as first-class context, because they sit in the same vector that gets sent back to the API on the next turn.

---

## The problem (why one stream)

An agent that fixes a Mac has to do four things that most chat UIs keep in separate lanes:

1. **Talk** — plain assistant text.
2. **Render UI** — a card with a situation summary, a plan, and a button; or a question with options.
3. **Act** — run shell commands and system tools.
4. **React to the user touching that UI** — "Fix it," "Skip," an answer to a question.

If these live in separate data structures, the model loses the plot. It emits a card, the user clicks a button, and the click arrives as some out-of-band event the model never sees in its own history — so on the next turn it has no memory that it *asked*, no memory of *what card it drew*, and no way to treat the click as an answer to its own question.

The design collapses all four into one append-only vector of `Message`. Every artifact the model produces (text, a `ui_*` tool call, a `shell_run` tool call) and every artifact that comes back (a tool result, the echoed UI payload, a user's typed reply or button press) is appended to the same `Vec<Message>`. On the next iteration the whole vector is replayed to the model. Nothing is out of band. The model's own drawn card and the user's click on it are just earlier turns it can read.

---

## The message model

The canonical stream is the backend in-memory vector. Two other representations mirror it (journal rows for persistence; a frontend store for rendering) — described later — but the vector fed to the LLM is the source of truth.

**Backend (`apps/desktop/src-tauri/src/agent/`).** A session owns one vector:

```rust
// orchestrator.rs:64
pub struct Session {
    pub id: String,
    pub messages: Vec<Message>,
    pub compressed_summary: Option<String>,
    // ...
}
```

A `Message` is a role plus content, where content is either a flat string or a list of typed blocks:

```rust
// llm_client.rs:72
pub struct Message {
    pub role: String,
    pub content: MessageContent,
}

// llm_client.rs:78
#[serde(untagged)]
pub enum MessageContent {
    Text(String),
    Blocks(Vec<ContentBlock>),
}

// llm_client.rs:85
#[serde(tag = "type")]
pub enum ContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String, is_error: Option<bool> },
}
```

That is the entire vocabulary. Plain assistant prose is `Text`. A UI card the model draws is a `ToolUse` block whose `name` is one of `ui_spa` / `ui_user_question` / `ui_info` / `ui_done`. A tool run is a `ToolUse` block for `shell_run`, `activate_playbook`, etc. Every result — a command's stdout, the echoed UI payload, an error — is a `ToolResult` block. There is no separate "card" type and no separate "event" type at the wire level: the API sees a normal Anthropic tool-use conversation, and the interactive UI is just tool calls whose "execution" is *rendering something the user can touch*.

`messages_for_llm` is what actually gets sent. It optionally prepends a compressed-history summary as a synthetic assistant turn, then hands over the raw vector unchanged:

```rust
// orchestrator.rs:811
fn messages_for_llm(&self, session_id: &str) -> Vec<Message> {
    let session = &self.sessions[session_id];
    let mut messages = Vec::with_capacity(session.messages.len() + 1);
    if let Some(summary) = session.compressed_summary.as_ref().filter(|s| !s.trim().is_empty()) {
        messages.push(Message { role: "assistant".to_string(),
            content: MessageContent::Text(format!("[Compressed session context]\n{}\n\n...", summary)) });
    }
    messages.extend(session.messages.iter().cloned());
    messages
}
```

**Frontend mirror (`apps/desktop/src/stores/chatStore.ts`).** The renderer keeps its own display list. Its `Message` carries the parsed card and the tool calls alongside the text:

```ts
// chatStore.ts:12
export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  actionTaken?: boolean;
  actionConfirmation?: boolean;
  assistantUi?: AssistantUiPayload;
}
```

`assistantUi` is the structured card (situation / plan / action button, or question + options) parsed out of the assistant's returned payload; `toolCalls` is the display record of tool runs. This store is a *view*, not the context — the model never reads it. It exists so React can draw the same turns the model already reasoned over.

---

## The round-trip: a click becomes a turn

The central claim is that a UI action re-enters the stream as an ordinary user turn. Three entry points in `apps/desktop/src/hooks/useAgent.ts` do this, and all three funnel to the same backend turn handler.

**1. Free text.** `sendMessage` appends a `user` message to the store, then calls the backend:

```ts
// useAgent.ts:92
addMessage({ role: "user", content: trimmed });
setProcessingSession(originSessionId);
const result = await commands.sendMessageV2(originSessionId, trimmed);
```

**2. A button press.** `sendConfirmation` fabricates a user turn from the button label (defaulting to "Go ahead"), shows it in the thread, then sends it with `isConfirmation = true`:

```ts
// useAgent.ts:143
const confirmText = actionLabel || "Go ahead";
markActionTaken(messageId);
addMessage({ role: "user", content: confirmText });
// ...
const result = await commands.sendMessageV2(originSessionId, confirmText, true);
```

Clicking "Fix it" is, from the model's perspective, indistinguishable from the user *typing* "Fix it." That is the point: the click is lowered to text and appended as a user turn.

**3. An answer to a question card.** `sendEvent` handles `USER_ANSWER_QUESTION` by pulling the chosen answer out of the payload and appending it as a user message before dispatching — the comment in the code states the intent plainly: "what user said = what LLM sees":

```ts
// useAgent.ts:193
if (eventType === "USER_ANSWER_QUESTION" && payload) {
  const parsed = JSON.parse(payload);
  const answer = parsed.answer || parsed.answers?.toString() || "";
  if (answer) addMessage({ role: "user", content: answer });
}
```

On the backend, `send_user_event` maps each event kind to a plain user message string (`UserConfirm` → "Go ahead", `UserSkipOptional` → "Skip this optional step and continue.", `UserAnswerQuestion` → the answer text) and routes it through the *same* `run_agent_turn` used for typed messages (`commands/agent.rs:480`, `:507`). There is no separate event pipeline into the model — events are decoded to user text at the edge and join the one stream.

### The model sees its own UI and its own tool results

Inside `Orchestrator::send_message`, the agentic loop appends each artifact to `session.messages` as it happens.

The user turn goes in first:

```rust
// orchestrator.rs:337
session.messages.push(Message {
    role: "user".to_string(),
    content: MessageContent::Text(user_message.to_string()),
});
```

The model's response — text and/or tool-use blocks, including any `ui_*` card — is appended as an assistant `Blocks` message:

```rust
// orchestrator.rs:521
session.messages.push(Message {
    role: "assistant".to_string(),
    content: MessageContent::Blocks(assistant_blocks),
});
```

When exactly one `ui_*` tool call is present, its rendered payload is pushed back into the stream as a `ToolResult` (role `user`) **and then returned to the frontend to be drawn**:

```rust
// orchestrator.rs:602
let session = self.sessions.get_mut(session_id).unwrap();
session.messages.push(Message {
    role: "user".to_string(),
    content: MessageContent::Blocks(vec![ContentBlock::ToolResult {
        tool_use_id: tool_use_id.clone(),
        content: payload.clone(),
        is_error: None,
    }]),
});
return Ok(payload);
```

This is the mechanism that makes the card first-class context. The `ui_spa` call the model made is now in history as an assistant `ToolUse`, and the card's own JSON is in history as the matching `ToolResult`. On the *next* turn — after the user clicks "Fix it" and that click arrives as a user text turn — the model replays a thread in which it can see the exact card it drew and the exact button the user pressed on it.

Real (non-UI) tool calls close the same loop. Each executed tool's output becomes a `ToolResult` block, and the whole batch is appended as one user message so the loop continues:

```rust
// orchestrator.rs:775
tool_result_blocks.push(ContentBlock::ToolResult {
    tool_use_id,
    content: output.clone(),
    is_error: None,
});
// ...
// orchestrator.rs:800
session.messages.push(Message {
    role: "user".to_string(),
    content: MessageContent::Blocks(tool_result_blocks),
});
```

(Errors, denials, and cancellations take the same shape with `is_error: Some(true)` — `orchestrator.rs:791`, `:686`. Policy violations, e.g. mixing a `ui_*` call with other tools, are also fed back as an error `ToolResult` so the model can self-correct rather than dead-end — `orchestrator.rs:544`, `:614`.)

### Thread anatomy

One user problem ("my wifi keeps dropping"), one card, one click, one fix, one done-card. Roles and block types are as they sit in `session.messages`:

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ role: user        MessageContent::Text                                │
 │   "my wifi keeps dropping"                                            │  ← typed message
 ├─────────────────────────────────────────────────────────────────────┤
 │ role: assistant   MessageContent::Blocks                              │
 │   [ ToolUse  name="ui_spa"  input={situation, plan, action:"Fix it"} ]│  ← model draws the card
 ├─────────────────────────────────────────────────────────────────────┤
 │ role: user        MessageContent::Blocks                              │
 │   [ ToolResult  tool_use_id=…  content=<ui_spa payload JSON> ]        │  ← card echoed back
 │                                       ↑ orchestrator.rs:602           │    (also returned to
 │                                                                       │     frontend, rendered)
 ╞═════════════════ user clicks the "Fix it" button ═════════════════════╡
 │ role: user        MessageContent::Text                                │
 │   "Fix it"                                                            │  ← click, lowered to text
 │                                       ↑ useAgent.ts:143 → :337        │    (sendConfirmation)
 ├─────────────────────────────────────────────────────────────────────┤
 │ role: assistant   MessageContent::Blocks                              │
 │   [ ToolUse  name="shell_run"  input={command:"…"} ]                  │  ← model acts
 ├─────────────────────────────────────────────────────────────────────┤
 │ role: user        MessageContent::Blocks                              │
 │   [ ToolResult  tool_use_id=…  content=<command output> ]            │  ← tool result
 │                                       ↑ orchestrator.rs:775           │
 ├─────────────────────────────────────────────────────────────────────┤
 │ role: assistant   MessageContent::Blocks                              │
 │   [ ToolUse  name="ui_done"  input={summary:"Reset the DNS cache"} ]  │  ← model draws done-card
 ├─────────────────────────────────────────────────────────────────────┤
 │ role: user        MessageContent::Blocks                              │
 │   [ ToolResult  tool_use_id=…  content=<ui_done payload JSON> ]       │  ← done-card echoed back
 └─────────────────────────────────────────────────────────────────────┘
```

Every downward step is one `push` onto `session.messages`. `role:user` turns are the three flavors of "the world talking to the model": the human's typed text, the human's click (lowered to text), and tool/UI results (blocks). `role:assistant` turns are always the model's own output blocks. The card the model drew at the top is still sitting in the vector when it chooses `shell_run` and again when it draws `ui_done` — it is reasoning against its own UI the whole way down.

---

## In the code (file:line)

- **The vector** — `orchestrator.rs:64` (`Session`), `:66` (`messages: Vec<Message>`), `:811` (`messages_for_llm`).
- **The block vocabulary** — `llm_client.rs:72` (`Message`), `:78` (`MessageContent::Text | Blocks`), `:85` (`ContentBlock::Text | ToolUse | ToolResult`).
- **Frontend mirror** — `chatStore.ts:12` (`Message` with `assistantUi`, `toolCalls`, `actionTaken`, `actionConfirmation`).
- **Click → turn** — `useAgent.ts:81` (`sendMessage`), `:131` (`sendConfirmation`, label → user turn → `sendMessageV2(…, true)`), `:186` (`sendEvent`, `USER_ANSWER_QUESTION` → answer appended as user turn). Backend decode: `commands/agent.rs:480` (`send_user_event` maps each event to plain user text), `:376`/`:427` (`run_agent_turn` → `Orchestrator::send_message`, one path for typed and event-derived turns).
- **Model sees its own UI** — `orchestrator.rs:337` (user turn pushed), `:521` (assistant blocks incl. `ui_*` ToolUse pushed), `:602` (UI payload pushed back as `ToolResult`, then returned), `:775`/`:800` (tool results pushed as a user blocks message).
- **UI-payload parsing for the renderer** — `commands/agent.rs:328` (`parse_assistant_ui`), `:467` (`send_message_v2` returns `{ text, assistant_ui }`).

### Persistence

The in-memory vector is durable across restarts through a flat SQLite mirror (`apps/desktop/src-tauri/src/safety/journal.rs`).

- **Schema.** The `messages` table stores one row per turn as `role` + `content` text (`journal.rs:110`). The `action_taken` and `action_confirmation` flags are **not** in the base `CREATE TABLE` — they are added by Migration 5 as `ALTER TABLE … ADD COLUMN` (`journal.rs:275`). `action_confirmation = 1` marks a user turn that came from a button/confirmation rather than free text.
- **Writes.** `save_message` (`journal.rs:671`) records a plain turn; `save_message_with_flags` (`journal.rs:676`) records the flags. `run_agent_turn` persists the user turn before the loop — with the confirmation flag set and `mark_last_action_taken` called when the turn is a button press (`commands/agent.rs:389`, `:393`) — and persists the assistant result after (`commands/agent.rs:434`).
- **Restore.** `restore_session_if_needed` (`orchestrator.rs:266`) rehydrates a cold session from the journal via `get_messages` / `get_recent_messages` (`journal.rs:710`, `:740`).
- **Compression.** Long sessions are compacted: `compress_session_context_if_needed` (`orchestrator.rs:833`) summarizes older turns into `Session.compressed_summary` (persisted by `update_session_compressed_summary`, `journal.rs:591`) and drops the verbatim tail it summarized. `messages_for_llm` (`:811`) re-injects that summary as a leading assistant turn, and on restore a session with a non-empty summary loads only its recent tail (`orchestrator.rs:279`).

---

## Limitations

- **Persistence is lossy relative to the live vector.** The journal stores each turn as a single `role`/`content` string (`journal.rs:110`), and `restore_session_if_needed` rebuilds every restored turn as `MessageContent::Text` (`orchestrator.rs:292`). The block structure — which `ToolUse` produced which `ToolResult`, the paired `tool_use_id`s — is flattened on persistence and *not* reconstructed on restore. A session resumed from disk carries the semantic content as prose but loses the typed tool-call/result pairing that a live, never-evicted session holds. The claim "one stream" is exact in memory; on cold restore it degrades to a flattened transcript. Tool-use block persistence is not implemented.
- **Three representations, kept in sync by convention.** The backend vector, the journal rows, and the frontend `chatStore` are separate structures. Only the backend vector is the model's context; the store is a view and the journal is a flattened archive. Nothing enforces that the store's rendered turns match the vector — `useAgent`'s `stillViewing` guards exist precisely because an in-flight reply can target a thread the user has navigated away from (`useAgent.ts:77`), and drift is possible if those guards are wrong.
- **Compression is estimate-driven and irreversible.** Token counts are approximated by character count (`estimate_tokens`, `orchestrator.rs:1197`), and compaction discards the verbatim older turns after summarizing (`orchestrator.rs:892`). Once compressed, the exact earlier UI cards and tool outputs are gone from context; only the summary and the recent tail remain.
- **The UI protocol is enforced by retry, not by types.** Exactly one `ui_*` call per turn is a runtime policy, not a compile-time guarantee; violations are caught mid-loop and fed back as error `ToolResult`s with a bounded retry budget (`orchestrator.rs:366`, `:541`). A model that never conforms is given a canned fallback rather than a rendered card.
- **Secrets are deliberately outside the stream.** `secure_input` values live in `Session.secrets` and never enter `messages` (`orchestrator.rs:73`, `:170`). The "everything is a turn" model has one intentional exception: secret material is injected only at tool-execution time (`orchestrator.rs:920`) and is never replayed to the API.
