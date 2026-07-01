# Every Command Explains Itself

> **Status/scope:** Doc 4 of 7 — shipped. Applies to the `shell_run` tool in the BYOK desktop agent (`apps/desktop`). Covers the Rust tool schema, the orchestrator's approval path, and the frontend approval modal.

![Noah's approval prompt. The model must supply the plain-English reason shown here; the raw command is not displayed in the modal — it is recorded in the session journal.](images/hero-approval-modal.png)

Transparency is enforced at the schema level, not by convention. The model cannot emit a `shell_run` call without also supplying a plain-English explanation of what the command does and why. `reason` is a **required** field in the tool's `input_schema`, so a call that omits it is a malformed tool call. The user is shown that explanation — "Delete old log files to free up disk space" — as the primary content of the approval prompt, and it is what gets recorded in the chat journal on approve or deny.

The point is not that the model is asked nicely to explain itself. The point is that the explanation's **presence is guaranteed by the schema**, the same way `command` is. A raw command with no rationale is not a valid input the model can produce.

## Why a schema-level requirement

An instruction in a system prompt ("always explain your commands") is advisory: the model may comply, drift, or drop it under long-context pressure. A required JSON-Schema field is structural. The Messages API's tool-use contract treats `required` fields as part of the input shape, so the model must fill `reason` to produce a well-formed call, and downstream code can read `tool_input["reason"]` without a presence check on the happy path.

This inverts the usual failure mode. Instead of hoping the model volunteers context, the system makes the *absence* of context the anomaly. The explanation is authored by the model (it knows what its own command does); the schema only guarantees the slot is filled.

## How it flows

```
model emits tool_use
  { "command": "rm -rf ~/Library/Logs/old",
    "reason":  "Delete old log files to free up disk space" }
        │  (reason is a required field — call is malformed without it)
        ▼
orchestrator.execute_tool
  reason = tool_input["reason"]          // extracted, defaults to ""
        │
        ▼
request_approval → ApprovalRequest
  { approval_id, tool_name, description, parameters, reason }
        │  emit("approval-request")
        ▼
ActionApproval.tsx  (approval modal)
  reason rendered as the modal's main content
  [ Skip ]   [ Approve ]   [ Approve, don't ask again ]
        │
        ▼
chat journal (system message)
  approve → "Approved: <reason>"
  deny    → "Skipped: <reason>"
```

## In the code

**The required field.** `shell_run`'s input schema pairs the raw `command` with a mandatory `reason`, and marks both required — `apps/desktop/src-tauri/src/platform/macos/diagnostics.rs:456`:

```rust
fn input_schema(&self) -> Value {
    json!({
        "type": "object",
        "properties": {
            "command": { "type": "string",
                "description": "The shell command to execute" },
            "reason": { "type": "string",
                "description": "Plain-language explanation of what this command does and why, written for a non-technical user. Example: 'Delete old log files to free up disk space'" }
        },
        "required": ["command", "reason"]
    })
}
```

The same schema is duplicated per platform: `platform/windows/diagnostics.rs:485` (identical, example included) and `platform/linux/diagnostics.rs:389`. The Linux copy carries a shortened `reason` description without the worked example — a minor drift, harmless because `required: ["command","reason"]` is present in all three.

**The pairing structure.** The raw command and its explanation travel together as one struct — `apps/desktop/src-tauri/src/agent/orchestrator.rs:27`:

```rust
pub struct ApprovalRequest {
    pub approval_id: String,
    pub tool_name: String,
    pub description: String,
    pub parameters: Value,   // holds the raw command
    /// Plain-language reason from the LLM explaining why this action is needed.
    pub reason: String,
}
```

Its TypeScript mirror is `apps/desktop/src/lib/tauri-commands.ts:14` (same five fields). A round-trip test asserts the serialized JSON has exactly these keys so the Rust struct and TS interface cannot silently diverge — `orchestrator.rs:1391`.

**Where `reason` is extracted.** For any tool that needs approval, `execute_tool` pulls `reason` out of the model's input and hands it to `request_approval` — `orchestrator.rs:1005`:

```rust
let reason = tool_input
    .get("reason")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();

let approved = self
    .request_approval(app_handle, tool_name, tool.description(), tool_input, &reason)
    .await?;
```

`request_approval` (`orchestrator.rs:1087`) packs it into `ApprovalRequest` and emits `approval-request` to the frontend.

**Where it's surfaced.** In the approval modal, `reason` is the main body content, not a tooltip or a detail row — `apps/desktop/src/components/ActionApproval.tsx:110`:

```tsx
const reason = pendingApproval.reason || t("approval.defaultReason");
// ...
{/* Reason — the main content */}
<p className="text-sm text-text-primary leading-relaxed">{reason}</p>
```

On resolve, the reason is written into the chat journal as a system message — `ActionApproval.tsx:61` (approve) and `:81` (deny):

```tsx
content: `Approved: ${pendingApproval.reason || "Action approved"}`   // approve
content: `Skipped: ${pendingApproval.reason || "Action skipped"}`     // deny
```

So the explanation is what the user reads at decision time *and* what persists in the transcript afterward. The bare shell string is never the headline.

## Limitations

- **The modal shows only the reason — not the raw command.** The current `ActionApproval.tsx` renders `reason` and the three action buttons; it does not display the `command` string, even though it arrives in `parameters`. This is *stronger* than "reason as a headline over the command" (the framing in earlier drafts and the shared hero shot): as shipped, a user who wants to inspect the literal command has no in-modal affordance for it. That is a deliberate simplification for non-technical users, but it means the raw command is only visible via debug logging, not the approval UI.
- **`reason` quality is the model's responsibility.** The schema guarantees the field is *present*, not that it is *accurate*. A misleading or vague explanation ("clean things up") passes schema validation. There is no check that the explanation matches what the command actually does.
- **Extraction defaults to empty.** `execute_tool` uses `unwrap_or("")`, and the modal falls back to `t("approval.defaultReason")`. In the well-formed case the field is always populated (it's required), so this only guards against a malformed call — but it means a blank reason degrades quietly rather than failing loudly.
- **Enforcement is per-tool, not global.** `reason` is required on `shell_run` specifically. Other tools that reach the approval path rely on their own schemas; there is no framework-level invariant that every approvable tool declares a required `reason`.
