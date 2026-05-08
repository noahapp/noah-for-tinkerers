use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

use noah_tools::{SafetyTier, Tool, ToolResult};

fn action_type_valid(v: &str) -> bool {
    matches!(v, "RUN_STEP" | "WAIT_FOR_USER")
}

fn normalize_action_from_input(input: &Value) -> Result<(String, String)> {
    // Prefer flat fields (action_label, action_type) — more reliable with LLMs.
    // Fall back to nested action object for backwards compat.
    if let (Some(label), Some(action_type)) = (
        input.get("action_label").and_then(|v| v.as_str()),
        input.get("action_type").and_then(|v| v.as_str()),
    ) {
        return Ok((label.to_string(), action_type.to_string()));
    }
    // Also accept top-level "label" (models sometimes hoist it)
    if let Some(label) = input.get("label").and_then(|v| v.as_str()) {
        let action_type = input.get("action_type")
            .and_then(|v| v.as_str())
            .unwrap_or("RUN_STEP");
        return Ok((label.to_string(), action_type.to_string()));
    }
    // Legacy nested action object
    if let Some(action) = input.get("action").and_then(|v| v.as_object()) {
        let label = action.get("label").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing action.label"))?;
        let action_type = action.get("type").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing action.type"))?;
        return Ok((label.to_string(), action_type.to_string()));
    }
    Err(anyhow!("missing action_label/action_type"))
}

pub fn ui_payload_from_tool_call(name: &str, input: &Value) -> Result<String> {
    match name {
        "ui_spa" => {
            let situation = input
                .get("situation_md")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing situation_md"))?;
            let plan = input
                .get("plan_md")
                .and_then(|v| v.as_str());
            let (label, action_type) = normalize_action_from_input(input)?;
            if !action_type_valid(&action_type) {
                return Err(anyhow!("invalid action.type: must be RUN_STEP or WAIT_FOR_USER"));
            }
            let mut payload = json!({
                "kind": "spa",
                "situation": situation,
                "action": {
                    "label": label,
                    "type": action_type
                }
            });
            if let Some(plan_text) = plan {
                payload["plan"] = json!(plan_text);
            }
            // Structured diagnostic facts. Pass-through; client renders the grid.
            if let Some(findings) = input.get("findings") {
                if findings.is_array() {
                    payload["findings"] = findings.clone();
                }
            }
            // Structured ordered remediation plan. Wins over plan_md when present.
            if let Some(steps) = input.get("steps") {
                if steps.is_array() {
                    payload["steps"] = steps.clone();
                }
            }
            if let Some(qr) = input.get("qr_data").and_then(|v| v.as_str()) {
                payload["qr_data"] = json!(qr);
            }
            Ok(payload.to_string())
        }
        "ui_user_question" => {
            let questions = input
                .get("questions")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow!("missing questions"))?;
            let mut out = Vec::new();
            for q in questions {
                let question = q
                    .get("question_md")
                    .or_else(|| q.get("question"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("question missing question_md"))?;
                let header = q
                    .get("header")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow!("question missing header"))?;

                let has_options = q.get("options").and_then(|v| v.as_array()).is_some();
                let has_text_input = q.get("text_input").is_some();
                let has_secure_input = q.get("secure_input").is_some();

                // Must have exactly one input mode.
                let mode_count = [has_options, has_text_input, has_secure_input]
                    .iter()
                    .filter(|&&v| v)
                    .count();
                if mode_count == 0 {
                    return Err(anyhow!("question must have 'options', 'text_input', or 'secure_input'"));
                }
                if mode_count > 1 {
                    return Err(anyhow!("question must have only one of 'options', 'text_input', or 'secure_input'"));
                }

                if has_options {
                    let options = q.get("options").unwrap().as_array().unwrap();
                    let mut out_options = Vec::new();
                    for opt in options {
                        let label = opt
                            .get("label")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| anyhow!("option missing label"))?;
                        let description = opt
                            .get("description")
                            .and_then(|v| v.as_str())
                            .ok_or_else(|| anyhow!("option missing description"))?;
                        out_options.push(json!({ "label": label, "description": description }));
                    }
                    out.push(json!({
                        "question": question,
                        "header": header,
                        "multiSelect": q.get("multiSelect").and_then(|v| v.as_bool()).unwrap_or(false),
                        "options": out_options
                    }));
                } else if has_text_input {
                    let ti = q.get("text_input").unwrap();
                    let mut text_input = json!({});
                    if let Some(p) = ti.get("placeholder").and_then(|v| v.as_str()) {
                        text_input["placeholder"] = json!(p);
                    }
                    if let Some(d) = ti.get("default").and_then(|v| v.as_str()) {
                        text_input["default"] = json!(d);
                    }
                    out.push(json!({
                        "question": question,
                        "header": header,
                        "text_input": text_input
                    }));
                } else {
                    // secure_input
                    let si = q.get("secure_input").unwrap();
                    let secret_name = si
                        .get("secret_name")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow!("secure_input missing secret_name"))?;
                    let mut secure_input = json!({ "secret_name": secret_name });
                    if let Some(p) = si.get("placeholder").and_then(|v| v.as_str()) {
                        secure_input["placeholder"] = json!(p);
                    }
                    out.push(json!({
                        "question": question,
                        "header": header,
                        "secure_input": secure_input
                    }));
                }
            }
            Ok(json!({
                "kind": "user_question",
                "questions": out
            })
            .to_string())
        }
        "ui_info" => {
            let summary = input
                .get("summary_md")
                .or_else(|| input.get("summary"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing summary_md"))?;
            Ok(json!({ "kind": "info", "summary": summary }).to_string())
        }
        "ui_done" => {
            let summary = input
                .get("summary_md")
                .or_else(|| input.get("summary"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("missing summary_md"))?;
            let mut payload = json!({ "kind": "done", "summary": summary });
            // Optional structured findings — same shape as ui_spa.findings.
            // Lets the completion card show "what was checked" without
            // re-narrating measurements as prose markdown.
            if let Some(findings) = input.get("findings") {
                if findings.is_array() {
                    payload["findings"] = findings.clone();
                }
            }
            Ok(payload.to_string())
        }
        _ => Err(anyhow!("not a ui tool")),
    }
}

struct UiSpaTool;
struct UiUserQuestionTool;
struct UiInfoTool;
struct UiDoneTool;

#[async_trait]
impl Tool for UiSpaTool {
    fn name(&self) -> &str { "ui_spa" }
    fn description(&self) -> &str {
        "Emit a Situation/Plan/Action (SPA) panel for the UI. `situation_md` is ONE sentence; structured diagnostic facts go in `findings`; ordered remediation actions go in `steps`."
    }
    fn input_schema(&self) -> Value {
        json!({
          "type":"object",
          "properties":{
            "situation_md":{
              "type":"string",
              "maxLength": 280,
              "description":"ONE SENTENCE stating what's wrong (RUN_STEP) or the concrete instructions the user must follow (WAIT_FOR_USER). No markdown headers, no bullet lists, no sub-points. Inline **bold** is fine for a key term. If you have measurements, put them in `findings`. If you have steps, put them in `steps`."
            },
            "findings":{
              "type":"array",
              "description":"Optional structured diagnostic facts. Use this whenever you have measurements, check results, or system facts. Do NOT cram these into situation_md as bullets.",
              "items":{
                "type":"object",
                "properties":{
                  "label":{"type":"string","maxLength":24,"description":"Short label, e.g. 'Disk usage', 'Ping (avg)', 'Network'."},
                  "value":{"type":"string","maxLength":24,"description":"The headline value: a number, a yes/no, a name. e.g. '94%', '18ms', 'Failed', '192.168.1.42'."},
                  "tone":{"type":"string","enum":["good","warn","bad","neutral"],"description":"Color of the value. DEFAULT IS 'neutral'. Use 'good'/'warn'/'bad' ONLY when the value reflects a quality judgment (latency low/high, disk free/full, signal strong/weak). For non-evaluative facts (IPs, DNS servers, hostnames, configs, identifiers) use 'neutral' — do NOT mark them 'good'."},
                  "sub":{"type":"string","maxLength":80,"description":"Optional sub-line BELOW the value. Use for either: (a) qualifier of the value ('avg, 3 packets', 'usually <15ms'), or (b) a paired secondary value when combining related readings into one cell ('DNS: 192.168.1.1'). ≤10 words."}
                },
                "required":["label","value"]
              },
              "maxItems":6
            },
            "steps":{
              "type":"array",
              "description":"Optional ordered remediation plan. Prefer this over plan_md when the plan has discrete actions. Each label is a single action.",
              "items":{
                "type":"object",
                "properties":{
                  "label":{"type":"string","maxLength":80,"description":"Action description. ONE action per step — do not summarize multiple checks into one step."},
                  "status":{"type":"string","enum":["pending","active","done"],"description":"Execution state. Defaults to 'pending'."},
                  "detail":{"type":"string","maxLength":80,"description":"Optional sub-line: rationale or what the step measures."}
                },
                "required":["label"]
              },
              "maxItems":6
            },
            "plan_md":{"type":"string","description":"DEPRECATED — prefer `steps`. Free-form Markdown plan; only use when the plan is genuinely prose-shaped (rare). Omit for WAIT_FOR_USER."},
            "qr_data":{"type":"string","description":"Optional data string to render as a scannable QR code."},
            "action_label":{"type":"string","maxLength":24,"description":"Button label. RUN_STEP examples: 'Fix it', 'Install'. WAIT_FOR_USER examples: 'I've done this', 'Done'."},
            "action_type":{"type":"string","enum":["RUN_STEP","WAIT_FOR_USER"],"description":"RUN_STEP: Noah executes. WAIT_FOR_USER: user acts manually — situation_md must contain the exact instructions."}
          },
          "required":["situation_md","action_label","action_type"],
          "additionalProperties":true
        })
    }
    fn safety_tier(&self) -> SafetyTier { SafetyTier::ReadOnly }
    async fn execute(&self, input: &Value) -> Result<ToolResult> {
        let payload = ui_payload_from_tool_call(self.name(), input)?;
        Ok(ToolResult::read_only(payload.clone(), serde_json::from_str(&payload)?))
    }
}

#[async_trait]
impl Tool for UiUserQuestionTool {
    fn name(&self) -> &str { "ui_user_question" }
    fn description(&self) -> &str {
        "Ask the user a question with selectable options, a free-text input, or a secure input for credentials."
    }
    fn input_schema(&self) -> Value {
        json!({
          "type":"object",
          "properties":{
            "questions":{
              "type":"array",
              "minItems":1,
              "items":{
                "type":"object",
                "properties":{
                  "id":{"type":"string"},
                  "header":{"type":"string"},
                  "question_md":{"type":"string","description":"Question prompt in Markdown format."},
                  "multiSelect":{"type":"boolean"},
                  "options":{
                    "type":"array",
                    "minItems":2,
                    "items":{
                      "type":"object",
                      "properties":{
                        "label":{"type":"string"},
                        "description":{"type":"string"}
                      },
                      "required":["label","description"],
                      "additionalProperties":false
                    }
                  },
                  "text_input":{
                    "type":"object",
                    "description":"Free-text input field. Use instead of options when user needs to type a value.",
                    "properties":{
                      "placeholder":{"type":"string","description":"Placeholder text for the input field."},
                      "default":{"type":"string","description":"Pre-filled default value."}
                    },
                    "additionalProperties":false
                  },
                  "secure_input":{
                    "type":"object",
                    "description":"Masked input for credentials. Value is stored securely and never enters LLM context. Use write_secret tool to write it to a file.",
                    "properties":{
                      "placeholder":{"type":"string","description":"Placeholder text for the masked field."},
                      "secret_name":{"type":"string","description":"Reference name for this secret (e.g. 'api_key'). Used with write_secret tool."}
                    },
                    "required":["secret_name"],
                    "additionalProperties":false
                  }
                },
                "required":["header","question_md"],
                "additionalProperties":false
              }
            }
          },
          "required":["questions"],
          "additionalProperties":false
        })
    }
    fn safety_tier(&self) -> SafetyTier { SafetyTier::ReadOnly }
    async fn execute(&self, input: &Value) -> Result<ToolResult> {
        let payload = ui_payload_from_tool_call(self.name(), input)?;
        Ok(ToolResult::read_only(payload.clone(), serde_json::from_str(&payload)?))
    }
}

#[async_trait]
impl Tool for UiInfoTool {
    fn name(&self) -> &str { "ui_info" }
    fn description(&self) -> &str { "Emit an informational card in Markdown." }
    fn input_schema(&self) -> Value {
        json!({
          "type":"object",
          "properties":{"summary_md":{"type":"string","description":"Summary in Markdown format."}},
          "required":["summary_md"],
          "additionalProperties":false
        })
    }
    fn safety_tier(&self) -> SafetyTier { SafetyTier::ReadOnly }
    async fn execute(&self, input: &Value) -> Result<ToolResult> {
        let payload = ui_payload_from_tool_call(self.name(), input)?;
        Ok(ToolResult::read_only(payload.clone(), serde_json::from_str(&payload)?))
    }
}

#[async_trait]
impl Tool for UiDoneTool {
    fn name(&self) -> &str { "ui_done" }
    fn description(&self) -> &str { "Emit a completion card. `summary_md` is one short paragraph; structured facts (what was measured / what changed) go in `findings`." }
    fn input_schema(&self) -> Value {
        json!({
          "type":"object",
          "properties":{
            "summary_md":{
              "type":"string",
              "description":"Short completion summary (1–3 sentences). No nested headers, no bulleted measurements — use `findings` for those."
            },
            "findings":{
              "type":"array",
              "description":"Optional structured facts about what was checked or what changed. Same shape as ui_spa.findings.",
              "items":{
                "type":"object",
                "properties":{
                  "label":{"type":"string","maxLength":24},
                  "value":{"type":"string","maxLength":24},
                  "tone":{"type":"string","enum":["good","warn","bad","neutral"]},
                  "sub":{"type":"string","maxLength":80}
                },
                "required":["label","value"]
              },
              "maxItems":6
            }
          },
          "required":["summary_md"],
          "additionalProperties":true
        })
    }
    fn safety_tier(&self) -> SafetyTier { SafetyTier::ReadOnly }
    async fn execute(&self, input: &Value) -> Result<ToolResult> {
        let payload = ui_payload_from_tool_call(self.name(), input)?;
        Ok(ToolResult::read_only(payload.clone(), serde_json::from_str(&payload)?))
    }
}

// ── Write Secret Tool ─────────────────────────────────────────────────

struct WriteSecretTool;

#[async_trait]
impl Tool for WriteSecretTool {
    fn name(&self) -> &str { "write_secret" }
    fn description(&self) -> &str {
        "Write a previously collected secure_input value to a file. The secret value is substituted by the runtime — you never see it."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "secret_name": {
                    "type": "string",
                    "description": "The secret_name from the secure_input that collected this value."
                },
                "file_path": {
                    "type": "string",
                    "description": "Path to the file to write to (e.g. '.env', 'config.json')."
                },
                "format": {
                    "type": "string",
                    "description": "Line to write, with {{value}} as placeholder for the secret. E.g. 'API_KEY={{value}}'"
                }
            },
            "required": ["secret_name", "file_path", "format"],
            "additionalProperties": false
        })
    }
    fn safety_tier(&self) -> SafetyTier { SafetyTier::SafeAction }
    async fn execute(&self, input: &Value) -> Result<ToolResult> {
        // The orchestrator substitutes __secret_value__ before calling execute.
        // If it's still the placeholder, the secret wasn't found.
        let secret_value = input
            .get("__secret_value__")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("Secret not found. Was it collected via secure_input?"))?;
        let file_path = input
            .get("file_path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing file_path"))?;
        let format = input
            .get("format")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing format"))?;

        let line = format.replace("{{value}}", secret_value);

        // Append to file (create if needed).
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path)
            .map_err(|e| anyhow!("Failed to open {}: {}", file_path, e))?;
        writeln!(file, "{}", line)
            .map_err(|e| anyhow!("Failed to write to {}: {}", file_path, e))?;

        Ok(ToolResult::read_only(
            format!("Secret written to {} (value redacted)", file_path),
            serde_json::json!({"written_to": file_path}),
        ))
    }
}

pub fn register_ui_tools(router: &mut crate::agent::tool_router::ToolRouter) {
    router.register(Box::new(UiSpaTool));
    router.register(Box::new(UiUserQuestionTool));
    router.register(Box::new(UiInfoTool));
    router.register(Box::new(UiDoneTool));
    router.register(Box::new(WriteSecretTool));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_spa_run_step() {
        let input = json!({
            "situation_md": "CPU is high",
            "plan_md": "Kill heavy process",
            "action": {"label": "Fix it", "type": "RUN_STEP"}
        });
        let result = ui_payload_from_tool_call("ui_spa", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "spa");
        assert_eq!(v["action"]["type"], "RUN_STEP");
        assert_eq!(v["plan"], "Kill heavy process");
    }

    #[test]
    fn valid_spa_wait_for_user() {
        let input = json!({
            "situation_md": "## Create a Bot\n\n1. Open Telegram\n2. Search @BotFather",
            "action": {"label": "I've done this", "type": "WAIT_FOR_USER"}
        });
        let result = ui_payload_from_tool_call("ui_spa", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "spa");
        assert_eq!(v["action"]["type"], "WAIT_FOR_USER");
        assert!(v.get("plan").is_none(), "plan should be absent when plan_md omitted");
    }

    #[test]
    fn spa_optional_plan_md() {
        // With plan_md
        let with_plan = json!({
            "situation_md": "Issue found",
            "plan_md": "Here's the fix",
            "action": {"label": "Fix", "type": "RUN_STEP"}
        });
        let v: Value = serde_json::from_str(
            &ui_payload_from_tool_call("ui_spa", &with_plan).unwrap(),
        ).unwrap();
        assert_eq!(v["plan"], "Here's the fix");

        // Without plan_md
        let without_plan = json!({
            "situation_md": "Do this task",
            "action": {"label": "Done", "type": "WAIT_FOR_USER"}
        });
        let v: Value = serde_json::from_str(
            &ui_payload_from_tool_call("ui_spa", &without_plan).unwrap(),
        ).unwrap();
        assert!(v.get("plan").is_none());
    }

    #[test]
    fn invalid_action_type() {
        let input = json!({
            "situation_md": "X",
            "plan_md": "Y",
            "action": {"label": "Go", "type": "INVALID"}
        });
        assert!(ui_payload_from_tool_call("ui_spa", &input).is_err());
    }

    #[test]
    fn valid_user_question_options() {
        let input = json!({
            "questions": [{
                "header": "Choose",
                "question_md": "Which one?",
                "options": [
                    {"label": "A", "description": "Option A"},
                    {"label": "B", "description": "Option B"}
                ]
            }]
        });
        let result = ui_payload_from_tool_call("ui_user_question", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "user_question");
        assert!(v["questions"][0].get("options").is_some());
    }

    #[test]
    fn valid_user_question_text_input() {
        let input = json!({
            "questions": [{
                "header": "Trigger Word",
                "question_md": "What trigger word?",
                "text_input": {
                    "placeholder": "e.g., Andy",
                    "default": "Andy"
                }
            }]
        });
        let result = ui_payload_from_tool_call("ui_user_question", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "user_question");
        assert_eq!(v["questions"][0]["text_input"]["default"], "Andy");
        assert!(v["questions"][0].get("options").is_none());
    }

    #[test]
    fn valid_user_question_secure_input() {
        let input = json!({
            "questions": [{
                "header": "API Key",
                "question_md": "Paste your key",
                "secure_input": {
                    "placeholder": "sk-...",
                    "secret_name": "api_key"
                }
            }]
        });
        let result = ui_payload_from_tool_call("ui_user_question", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "user_question");
        assert_eq!(v["questions"][0]["secure_input"]["secret_name"], "api_key");
    }

    #[test]
    fn user_question_rejects_mixed_input_modes() {
        let input = json!({
            "questions": [{
                "header": "Bad",
                "question_md": "Both options and text_input",
                "options": [{"label": "A", "description": "A"}],
                "text_input": {"placeholder": "x"}
            }]
        });
        assert!(ui_payload_from_tool_call("ui_user_question", &input).is_err());
    }

    #[test]
    fn user_question_rejects_no_input_mode() {
        let input = json!({
            "questions": [{
                "header": "Bad",
                "question_md": "No input mode"
            }]
        });
        assert!(ui_payload_from_tool_call("ui_user_question", &input).is_err());
    }

    #[test]
    fn valid_info() {
        let input = json!({"summary_md": "All good"});
        let result = ui_payload_from_tool_call("ui_info", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "info");
    }

    #[test]
    fn valid_done() {
        let input = json!({"summary_md": "Fixed it"});
        let result = ui_payload_from_tool_call("ui_done", &input).unwrap();
        let v: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["kind"], "done");
    }

    #[test]
    fn missing_fields() {
        assert!(ui_payload_from_tool_call("ui_spa", &json!({})).is_err());
        assert!(ui_payload_from_tool_call("ui_done", &json!({})).is_err());
        assert!(ui_payload_from_tool_call("ui_user_question", &json!({})).is_err());
    }
}
