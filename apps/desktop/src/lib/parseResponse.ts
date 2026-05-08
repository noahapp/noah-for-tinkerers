import { sanitizeSpa } from "./sanitizeSpa";

/** Color of a Finding's value. Default is `neutral`. `good`/`warn`/`bad`
 *  are reserved for values that reflect a quality judgment — never for
 *  non-evaluative facts like IPs, DNS servers, or identifiers. */
export type Tone = "good" | "warn" | "bad" | "neutral";

/** A single diagnostic fact rendered as a label/value tile. */
export interface Finding {
  /** Short label, ≤24 chars. e.g. "Disk usage", "Ping (avg)". */
  label: string;
  /** Headline value, ≤24 chars. e.g. "94%", "18ms", "Failed", "192.168.1.42". */
  value: string;
  /** Defaults to "neutral". */
  tone?: Tone;
  /** Optional sub-line below the value, ≤80 chars. Used for either a
   *  qualifier of the value ("avg, 3 packets") or a paired secondary
   *  value when combining related readings into one cell ("DNS: 192.168.1.1"). */
  sub?: string;
}

/** A single step in an ordered remediation plan. */
export interface Step {
  /** Action description, ≤80 chars. e.g. "Quit Chrome (4.2 GB)". */
  label: string;
  /** Execution state. Defaults to "pending". */
  status?: "pending" | "active" | "done";
  /** Optional sub-line, ≤80 chars. */
  detail?: string;
}

export type ParsedResponse =
  | {
      type: "action";
      /** ALWAYS present. One sentence — the diagnosis headline. */
      situation: string;
      /** Optional structured diagnostic facts. */
      findings?: Finding[];
      /** Optional ordered remediation plan (preferred over `plan`). */
      steps?: Step[];
      /** Legacy free-form markdown plan; fallback when `steps` absent. */
      plan?: string;
      actionLabel: string;
      actionType?: string;
    }
  | {
      type: "user_question";
      questions: Array<{
        question: string;
        header: string;
        options?: Array<{ label: string; description: string }>;
        text_input?: { placeholder?: string; default?: string };
        secure_input?: { placeholder?: string; secret_name: string };
        multiSelect?: boolean;
      }>;
    }
  | { type: "done"; summary: string; findings?: Finding[] }
  | { type: "info"; summary: string }
  | { type: "text"; content: string };

/**
 * Parse a structured LLM response into a typed object.
 *
 * Tries JSON first (ui_* tool call payloads), then falls back to
 * legacy bracket markers: [SITUATION], [PLAN], [ACTION:Label], [DONE], [INFO].
 */
export function parseResponse(raw: string): ParsedResponse {
  // Strip any <think>...</think> blocks (some models emit reasoning tags).
  const trimmed = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();

  // JSON SPA / user_question payloads (optionally with prefixed prose)
  {
    const candidate = (() => {
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return null;
      return trimmed.slice(start, end + 1);
    })();

    if (candidate) {
      try {
        const obj = JSON.parse(candidate) as {
          kind?: string;
          summary?: string;
          situation?: string;
          plan?: string;
          findings?: Finding[];
          steps?: Step[];
          action?: {
            label?: string;
            type?: string;
          };
          questions?: Array<{
            question: string;
            header: string;
            options: Array<{ label: string; description: string }>;
            multiSelect?: boolean;
          }>;
        };

        const kind = (obj.kind || "").toLowerCase();
        if (
          kind === "spa" &&
          obj.situation &&
          obj.action?.label
        ) {
          return sanitizeSpa({
            type: "action",
            situation: obj.situation,
            findings: Array.isArray(obj.findings) ? obj.findings : undefined,
            steps: Array.isArray(obj.steps) ? obj.steps : undefined,
            plan: obj.plan,
            actionLabel: obj.action.label,
            actionType: obj.action.type,
          });
        }
        if (kind === "user_question" && Array.isArray(obj.questions)) {
          return {
            type: "user_question",
            questions: obj.questions.map((q) => ({
              question: q.question,
              header: q.header,
              options: q.options,
              multiSelect: Boolean(q.multiSelect),
            })),
          };
        }
        if (kind === "done" && obj.summary) {
          return {
            type: "done",
            summary: obj.summary,
            findings: Array.isArray(obj.findings) ? obj.findings : undefined,
          };
        }
        if (kind === "info" && obj.summary) {
          return { type: "info", summary: obj.summary };
        }
      } catch {
        // ignore and continue with legacy marker parsing
      }
    }
  }

  // Action card: [SITUATION]...[PLAN]...[ACTION:Label]
  const actionMatch = trimmed.match(
    /\[SITUATION\]\s*([\s\S]*?)\s*\[PLAN\]\s*([\s\S]*?)\s*\[ACTION:([^\]]+)\]/,
  );
  if (actionMatch) {
    return {
      type: "action",
      situation: actionMatch[1].trim(),
      plan: actionMatch[2].trim(),
      actionLabel: actionMatch[3].trim(),
    };
  }

  // Done card: [DONE]...
  const doneMatch = trimmed.match(/\[DONE\]\s*([\s\S]+)/);
  if (doneMatch) {
    return {
      type: "done",
      summary: doneMatch[1].trim(),
    };
  }

  // Info card: [INFO]...
  const infoMatch = trimmed.match(/\[INFO\]\s*([\s\S]+)/);
  if (infoMatch) {
    return {
      type: "info",
      summary: infoMatch[1].trim(),
    };
  }

  // Fallback: plain text
  return { type: "text", content: trimmed };
}
