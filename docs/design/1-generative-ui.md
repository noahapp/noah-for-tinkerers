# Generative UI Without Letting the Model Draw

The LLM never emits HTML or JSX. It calls one of a small fixed set of UI tools whose inputs are constrained by strict JSON schemas — hard length caps, item caps, and closed enums. The model fills **slots**; it does not draw components. The Rust runtime validates and normalizes the tool input into a typed payload, and React renders that payload deterministically through a `switch` on a `kind` discriminant. The result is generative flexibility (the model decides *what* to say and *which* card type fits) with zero arbitrary-DOM/XSS surface, a fixed and consistent visual vocabulary, and an unbroken type chain from Rust structs to TypeScript interfaces.

## Why not free-form UI

The obvious alternative — let the model emit HTML/Markdown/JSX and render it — trades away four things the app depends on:

- **Safety.** Rendering model-authored markup means the model's output is a DOM-injection vector. Constraining the model to a fixed tool surface means the only bytes that reach the renderer are values inside known slots. There is no path from model output to arbitrary elements, scripts, or styles.
- **Consistency.** A findings tile looks the same in every session because there is exactly one `FindingsGrid` component and the model can only supply `{label, value, tone?, sub?}`. The model cannot invent a new card layout, a new color, or a seven-column grid. Visual decisions live in code, not in the token stream.
- **Accessibility.** Semantics, focus order, contrast, and the aurora identity cues (see `docs/DESIGN_PRINCIPLES.md`) are authored once in React. Free-form model markup would re-derive all of this per response, inconsistently.
- **Type-safety and prompt-compliance.** The schema is simultaneously the prompt contract and the validation boundary. Caps like `situation_md ≤ 280` and `findings maxItems 6` are stated to the model *and* enforced downstream, so a well-behaved model and a misbehaving one both produce a payload the renderer can handle.

## The four UI tools

Every assistant turn must be exactly one UI tool call (`apps/desktop/src-tauri/src/agent/prompts.rs`: "Every response MUST be exactly one of these tool calls"). The tools are registered in `register_ui_tools` (`apps/desktop/src-tauri/src/ui_tools.rs`):

| Tool | Purpose | Rendered as |
|---|---|---|
| `ui_spa` | Situation + optional findings/steps + one action button | `ActionCard` |
| `ui_user_question` | Ask the user: options, free-text, or masked secret | `UserQuestionCard` |
| `ui_info` | Informational card (can't-fix, refusal, answer) | `InfoCard` |
| `ui_done` | Completion card, optionally with findings | `DoneCard` |

(A fifth registered tool, `write_secret`, is not a UI card — it writes a previously-collected `secure_input` value to a file with the value substituted by the runtime so the model never sees it.)

The central tool is `ui_spa`. Its schema (`UiSpaTool::input_schema` in `ui_tools.rs`) is where the "slots not drawing" discipline is most visible:

```jsonc
"situation_md": { "type":"string", "maxLength": 280,
  "description":"ONE SENTENCE ... No markdown headers, no bullet lists ...
                 If you have measurements, put them in `findings`.
                 If you have steps, put them in `steps`." },
"findings": { "type":"array", "maxItems": 6,
  "items": { "properties": {
    "label": { "type":"string", "maxLength":24 },
    "value": { "type":"string", "maxLength":24 },
    "tone":  { "type":"string", "enum":["good","warn","bad","neutral"] },
    "sub":   { "type":"string", "maxLength":80 } },
    "required":["label","value"] } },
"steps": { "type":"array", "maxItems": 6,
  "items": { "properties": {
    "label":  { "type":"string", "maxLength":80 },
    "status": { "type":"string", "enum":["pending","active","done"] },
    "detail": { "type":"string", "maxLength":80 } },
    "required":["label"] } },
"action_label": { "type":"string", "maxLength":24 },
"action_type":  { "type":"string", "enum":["RUN_STEP","WAIT_FOR_USER"] }
```

The three closed enums (`tone`, `status`, `action_type`) and the hard caps (situation 280 chars, findings/steps 6 items, label/value 24 chars, sub/detail 80 chars, action label 24 chars) are the whole trick: the model chooses among a fixed alphabet and fills bounded text, and the render layer already knows how to draw every combination.

`ui_user_question` additionally enforces a *runtime* invariant the JSON schema alone can't: each question must have exactly one input mode — `options`, `text_input`, or `secure_input`. `ui_payload_from_tool_call` counts the modes and rejects zero or more-than-one. `ui_info` and `ui_done` are minimal: a `summary_md` string, plus (for `ui_done`) the same optional `findings` shape as `ui_spa`.

One caveat on the schema: `ui_spa` and `ui_done` set `additionalProperties: true` at the object root, while `ui_user_question` and `ui_info` set it `false`. So the enums and nested shapes are closed, but the two card tools tolerate extra top-level keys (they are ignored downstream rather than rejected).

## The TS payload types

`apps/desktop/src/lib/tauri-commands.ts` mirrors the Rust structs one-to-one so the boundary is typed on both sides. The discriminated union:

```ts
export interface AssistantFinding { label: string; value: string;
  tone?: AssistantTone; sub?: string; }              // tone = good|warn|bad|neutral
export interface AssistantStep { label: string;
  status?: "pending" | "active" | "done"; detail?: string; }
export interface AssistantCardAction { label: string; type: AssistantActionType; }
                                                     // AssistantActionType = RUN_STEP|WAIT_FOR_USER

export interface AssistantUiSpa {
  kind: "spa"; situation: string;
  findings?: AssistantFinding[]; steps?: AssistantStep[];
  plan?: string; action: AssistantCardAction;
  progress?: PlaybookProgress; qr_data?: string; }
export interface AssistantUiUserQuestion { kind: "user_question"; questions: AssistantQuestion[]; ... }
export interface AssistantUiInfo { kind: "done" | "info"; summary: string; findings?: AssistantFinding[]; ... }

export type AssistantUiPayload =
  | AssistantUiSpa | AssistantUiUserQuestion | AssistantUiInfo;

export interface SendMessageV2Result { text: string; assistant_ui?: AssistantUiPayload; }
```

## How a payload becomes a card

![A rendered SPA card: one-line situation, a tone-colored findings grid, an ordered step list, and the primary action button.](images/hero-spa-card.png)

```
                        model turn
                            │
                            v
          tool call: ui_spa { situation_md, findings[],
                              steps[], action_label, action_type }
                            │
                            v
   ┌───────────────────────────────────────────────────────────┐
   │  ui_tools.rs :: ui_payload_from_tool_call()               │
   │  - validate action_type in {RUN_STEP, WAIT_FOR_USER}      │
   │  - one-input-mode check (user_question)                   │
   │  - normalize flat/nested/legacy field shapes              │
   │  - emit canonical JSON string  { "kind": "spa", ... }     │
   └─────────────────────────────┬─────────────────────────────┘
                                 │  (JSON string)
                                 v
   ┌───────────────────────────────────────────────────────────┐
   │  commands/agent.rs :: parse_assistant_ui() ->             │
   │                       parse_assistant_ui_json()           │
   │  - match on v["kind"] -> typed struct                     │
   │  - #[serde(untagged)] AssistantUiPayload                  │
   │  - SendMessageV2Result { text, assistant_ui }             │
   └─────────────────────────────┬─────────────────────────────┘
                                 │  (Tauri IPC, serde -> JSON -> TS)
                                 v
   ┌───────────────────────────────────────────────────────────┐
   │  ChatPanel.tsx :: renderFromUiPayload()                   │
   │  switch (ui.kind) {                                       │
   │    "spa"           -> <ActionCard>   (+FindingsGrid,      │
   │                                        +StepsList)        │
   │    "user_question" -> <UserQuestionCard>                  │
   │    "done"          -> <DoneCard>     (+FindingsGrid)      │
   │    "info"          -> <InfoCard>                          │
   │  }                                                        │
   └─────────────────────────────┬─────────────────────────────┘
                                 │
                                 v
                    deterministic rendered card
```

Note there are two Rust stages, not one. `ui_payload_from_tool_call` (in `ui_tools.rs`) is the **validate-and-normalize** stage: it runs at tool-execution time, rejects bad enums/modes, tolerates the several field shapes models emit in the wild (flat `action_label`/`action_type`, hoisted `label`, or a legacy nested `action` object), and produces one canonical JSON string. `parse_assistant_ui` (in `commands/agent.rs`) is the **parse-into-typed-struct** stage that reads that string back into `AssistantUiPayload`. It also carries a legacy text-marker fallback (`[SITUATION]…[PLAN]…[ACTION:…]`, `[DONE]`, `[INFO]`) for responses that arrive as plain text rather than a tool call.

## In the code

- **Schemas + runtime validation:** `apps/desktop/src-tauri/src/ui_tools.rs`
  - `ui_payload_from_tool_call` — the dispatcher; builds the canonical payload per tool name.
  - `action_type_valid` rejects anything but `RUN_STEP`/`WAIT_FOR_USER`; the one-input-mode check for `ui_user_question` lives in the dispatcher.
  - `UiSpaTool::input_schema` — the quoted schema above; `UiDoneTool` reuses the `findings` shape.
  - Registration in `register_ui_tools`; a test suite in the same file pins the enum/mode invariants.
- **Rust payload types + parse:** `apps/desktop/src-tauri/src/commands/agent.rs`
  - `AssistantSpaUi`, the `#[serde(untagged)]` `AssistantUiPayload` enum, and `SendMessageV2Result { text, assistant_ui }`.
  - `parse_assistant_ui_json` matches on `kind` and constructs the typed variant; `AssistantSpaUi.findings` carries a comment flagging that dropping findings here is a bug.
- **TS mirror types:** `apps/desktop/src/lib/tauri-commands.ts` — the `AssistantUiPayload` union and its members.
- **Deterministic render:** `apps/desktop/src/components/ChatPanel.tsx`
  - `renderFromUiPayload` — `switch (ui.kind)` → `ActionCard` / `UserQuestionCard` / `DoneCard` / `InfoCard`; `default` falls back to a plain `MessageBubble`.
  - `apps/desktop/src/components/FindingsGrid.tsx` — the `toneColor` map turns the closed `tone` enum into a CSS color, and the grid hard-caps to 6 tiles defensively even though the schema already enforces `maxItems: 6`.
  - `apps/desktop/src/components/StepsList.tsx` — renders the ordered `steps[]` with `status`-driven bullets.
- **The prompt that steers the model to think in slots:** `apps/desktop/src-tauri/src/agent/prompts.rs`, the "UI Tool Calls" section. It repeats the slot discipline verbatim and includes an explicit anti-pattern:

  > BAD `ui_spa` (do NOT do this — findings crammed into situation_md as bullets):
  > `situation_md: "I checked your network:\n- Ping to 8.8.8.8 failed\n- Wi-Fi signal -72 dBm\n\nLikely a router issue."`

  and closes with: *"`situation_md` is ONE SENTENCE. Findings go in `findings[]`. Steps go in `steps[]`. Re-read your draft and move structured content out of situation_md before emitting."* The prompt teaches the model to route content into the right slot; the schema and the two Rust stages enforce it if the model slips.

## Limitations

- **Markdown fields are still rendered as Markdown.** `situation_md`, `summary_md`, and `question_md` pass through a Markdown renderer, so the XSS surface is not literally zero — it is the (bounded, audited) Markdown renderer rather than arbitrary HTML/JSX. The guarantee is "no arbitrary DOM from the model," not "no rendering of model text at all."
- **The two card tools aren't fully closed.** `ui_spa`/`ui_done` use `additionalProperties: true`; extra top-level keys are ignored downstream rather than rejected. Only `ui_user_question`/`ui_info` are strictly closed objects.
- **Caps are advisory to the model, enforced unevenly downstream.** `findings` is defensively sliced to 6 in `FindingsGrid`, but string caps (e.g. `situation_md ≤ 280`) are not re-truncated at render time — an over-long string would render long. The schema is the model's contract; the renderer only hard-enforces the item cap.
- **Two parse paths.** Beyond the schema-validated tool path there is a legacy text-marker fallback (`[SITUATION]`/`[DONE]`/`[INFO]`) that bypasses the JSON schema entirely. It exists for robustness against non-tool-call responses and is the one place a payload reaches the union without having gone through `ui_payload_from_tool_call`.
- **A new card type is a code change, by design.** The flexibility is in *filling* the four cards, not in adding a fifth. Anything the four tools can't express requires new Rust schema + Rust struct + TS type + React component — the cost the design deliberately pays for the safety/consistency guarantees above.
