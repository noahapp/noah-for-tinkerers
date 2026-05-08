import type { Finding, ParsedResponse } from "./parseResponse";

/** Max chars for a "one sentence" situation per the prompt rule. */
const SITUATION_MAX_CHARS = 280;

/** Max chars allowed in an extracted Finding value. Per schema. */
const FINDING_VALUE_MAX = 24;

/** Max chars allowed in an extracted Finding label. Per schema. */
const FINDING_LABEL_MAX = 24;

/**
 * Counter of model-drift events surfaced this session. Bumped whenever
 * sanitizeSpa observes a payload that violated the prompt rules. Read by
 * dev tooling; not surfaced to end users. Reset on page reload.
 *
 * Use it to grep llm_traces for the rate of drift over time — a rising
 * count is a signal that the prompt needs tightening or the schema
 * needs further constraints.
 */
const drift = {
  multiParagraphSituation: 0,
  bulletsInSituation: 0,
  headersInSituation: 0,
  situationOverLimit: 0,
};

/** Inspect from devtools: `window.__noahSpaDrift` */
if (typeof window !== "undefined") {
  (window as unknown as { __noahSpaDrift: typeof drift }).__noahSpaDrift = drift;
}

/**
 * Defensive normalization for action-type SPA payloads.
 *
 * The prompt asks the model to keep structured content out of `situation_md`
 * and to populate `findings`/`steps` instead. Models drift. This function
 * catches the common drift patterns and either fixes them in place
 * (stripping markdown headers, collapsing multi-paragraph situations) or
 * extracts them into structured slots (lossy bullet→finding migration).
 *
 * Design constraints:
 * - **Strict colon pattern only** for finding extraction. The handoff
 *   warned that a permissive regex on real production text creates
 *   garbage findings. We require `**Label**: short value` where the
 *   value is ≤24 chars after trim (matches the schema). Anything else
 *   is left in `situation` for the markdown fallback to render.
 * - Only migrates when `findings` is empty, never overwrites real data.
 * - Never truncates `situation` — long situations are warned about, not
 *   chopped. Better to ship long than to lop off a meaningful clause.
 */
export function sanitizeSpa(parsed: ParsedResponse): ParsedResponse {
  if (parsed.type !== "action") return parsed;

  let situation = parsed.situation.trim();
  let findings = parsed.findings;

  // 1. Strip markdown header LINES entirely (whole line, including the
  //    text). A header line is meta — it's the model trying to label a
  //    section and we don't want either the label or the marker. The
  //    body of the situation lives in the paragraph(s) that follow.
  if (/^#{1,6}\s+/m.test(situation)) {
    drift.headersInSituation += 1;
    situation = situation.replace(/^#{1,6}\s+.*$/gm, "").trim();
  }

  // 2. Strict bullet→finding migration. Only attempts when findings is
  //    empty AND every bullet matches the colon pattern AND every
  //    extracted value fits in 24 chars. If any bullet fails the check,
  //    we leave situation untouched and let the markdown fallback render.
  const bulletRegex = /^[\s]*[-*+]\s+(.+)$/gm;
  const bulletMatches = [...situation.matchAll(bulletRegex)];
  if (bulletMatches.length >= 2) {
    drift.bulletsInSituation += 1;
    if (!findings || findings.length === 0) {
      const extracted = extractFindingsFromBullets(
        bulletMatches.map((m) => m[1].trim()),
      );
      if (extracted) {
        findings = extracted;
        situation = situation.replace(bulletRegex, "").trim();
      }
    }
  }

  // 3. Collapse multi-paragraph situation to first paragraph. A multi-
  //    paragraph situation is always wrong post-sanitization.
  const paragraphs = situation.split(/\n{2,}/).filter((p) => p.trim());
  if (paragraphs.length > 1) {
    drift.multiParagraphSituation += 1;
    situation = paragraphs[0].trim();
  }

  // 4. Soft length warning — schema enforces 280 server-side, but
  //    legacy persisted messages may exceed it. Log but don't truncate.
  if (situation.length > SITUATION_MAX_CHARS) {
    drift.situationOverLimit += 1;
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        `[noah] situation exceeds ${SITUATION_MAX_CHARS} chars (${situation.length}) — model drifted into prose mode`,
        situation,
      );
    }
  }

  // Collapse runs of newlines left behind after stripping bullets/headers.
  situation = situation.replace(/\n{3,}/g, "\n\n").trim();

  return { ...parsed, situation, findings };
}

/**
 * Try to extract Findings from a list of bullet strings. Returns null if
 * any bullet fails the strict colon pattern OR any extracted value would
 * exceed the schema's 24-char cap. All-or-nothing — partial extraction
 * produces inconsistent UI.
 */
function extractFindingsFromBullets(bullets: string[]): Finding[] | null {
  const out: Finding[] = [];
  for (const bullet of bullets) {
    // Match: optional **bold** label, colon, value. Value cannot contain
    // any further colon (rules out "URL: https://…" style runs that
    // would over-extract).
    const m = bullet.match(/^\*?\*?(.+?)\*?\*?:\s*([^:]+?)\s*$/);
    if (!m) return null;
    const label = m[1].trim().replace(/^\*+|\*+$/g, "").trim();
    const value = m[2].trim().replace(/^\*+|\*+$/g, "").trim();
    if (!label || !value) return null;
    if (label.length > FINDING_LABEL_MAX) return null;
    if (value.length > FINDING_VALUE_MAX) return null;
    out.push({ label, value });
  }
  return out.length > 0 ? out : null;
}
