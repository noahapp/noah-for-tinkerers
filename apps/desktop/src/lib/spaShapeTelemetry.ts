import type { AssistantUiPayload } from "./tauri-commands";

/**
 * Lightweight in-memory counter for adoption of the structured SPA / Done
 * payload contract. Used to answer: of all assistant responses we render
 * via the structured-card path, what fraction populate `findings` /
 * `steps`? If it's high, the prompt + schema are doing their job. If
 * it's low, we have an adoption gap and need stronger nudges (or to
 * bring forward orchestrator-emitted findings — Move 3 in the handoff).
 *
 * Counters are session-local: they reset on page reload. The goal is
 * quick measurement during testing, not permanent telemetry.
 *
 * Inspect from DevTools:
 *   __noahSpaShape  → live counter object with all categories
 *   __noahSpaShape.summary()  → percentages
 *
 * Each call to recordAssistantUiShape() also emits a `console.info` line
 * with the classification, so you can grep your devtools console for
 * `[noah-spa-shape]` to see the timeline.
 */

type SpaShape =
  | "spa_bare" // no findings, no steps, no plan_md
  | "spa_legacy_plan_only" // legacy markdown plan, no structured slots
  | "spa_findings_only"
  | "spa_steps_only"
  | "spa_both";

type DoneShape = "done_bare" | "done_findings";

interface ShapeCounter {
  spa_bare: number;
  spa_legacy_plan_only: number;
  spa_findings_only: number;
  spa_steps_only: number;
  spa_both: number;
  done_bare: number;
  done_findings: number;
  /** All non-action ui_* (info, user_question) pass through here too. */
  other: number;
  /** Total assistant responses observed since page load. */
  total: number;
  summary: () => Record<string, string>;
  reset: () => void;
}

const counter: ShapeCounter = {
  spa_bare: 0,
  spa_legacy_plan_only: 0,
  spa_findings_only: 0,
  spa_steps_only: 0,
  spa_both: 0,
  done_bare: 0,
  done_findings: 0,
  other: 0,
  total: 0,
  summary(): Record<string, string> {
    if (this.total === 0) return { total: "0" };
    const spaTotal =
      this.spa_bare +
      this.spa_legacy_plan_only +
      this.spa_findings_only +
      this.spa_steps_only +
      this.spa_both;
    const doneTotal = this.done_bare + this.done_findings;
    const pct = (n: number, d: number) =>
      d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)}%`;
    return {
      total: String(this.total),
      spa_total: String(spaTotal),
      spa_with_findings: pct(this.spa_findings_only + this.spa_both, spaTotal),
      spa_with_steps: pct(this.spa_steps_only + this.spa_both, spaTotal),
      spa_with_both: pct(this.spa_both, spaTotal),
      spa_bare: pct(this.spa_bare, spaTotal),
      spa_legacy_plan_only: pct(this.spa_legacy_plan_only, spaTotal),
      done_total: String(doneTotal),
      done_with_findings: pct(this.done_findings, doneTotal),
    };
  },
  reset() {
    this.spa_bare = 0;
    this.spa_legacy_plan_only = 0;
    this.spa_findings_only = 0;
    this.spa_steps_only = 0;
    this.spa_both = 0;
    this.done_bare = 0;
    this.done_findings = 0;
    this.other = 0;
    this.total = 0;
  },
};

if (typeof window !== "undefined") {
  (window as unknown as { __noahSpaShape: ShapeCounter }).__noahSpaShape =
    counter;
}

function classifySpa(ui: Extract<AssistantUiPayload, { kind: "spa" }>): SpaShape {
  const hasFindings = !!ui.findings && ui.findings.length > 0;
  const hasSteps = !!ui.steps && ui.steps.length > 0;
  const hasPlan = !!ui.plan && ui.plan.trim().length > 0;
  if (hasFindings && hasSteps) return "spa_both";
  if (hasFindings) return "spa_findings_only";
  if (hasSteps) return "spa_steps_only";
  if (hasPlan) return "spa_legacy_plan_only";
  return "spa_bare";
}

function classifyDone(ui: Extract<AssistantUiPayload, { kind: "done" | "info" }>): DoneShape | null {
  if (ui.kind !== "done") return null;
  const hasFindings = !!ui.findings && ui.findings.length > 0;
  return hasFindings ? "done_findings" : "done_bare";
}

/**
 * Call once per assistant response that came back from the orchestrator.
 * Safe to call with an undefined payload (counts as `other`).
 */
export function recordAssistantUiShape(ui: AssistantUiPayload | undefined): void {
  counter.total += 1;
  if (!ui) {
    counter.other += 1;
    // eslint-disable-next-line no-console
    console.info("[noah-spa-shape] no_payload");
    return;
  }
  if (ui.kind === "spa") {
    const shape = classifySpa(ui);
    counter[shape] += 1;
    // eslint-disable-next-line no-console
    console.info(
      `[noah-spa-shape] ${shape} findings=${ui.findings?.length ?? 0} steps=${ui.steps?.length ?? 0}`,
    );
    return;
  }
  if (ui.kind === "done") {
    const shape = classifyDone(ui);
    if (shape) {
      counter[shape] += 1;
      // eslint-disable-next-line no-console
      console.info(
        `[noah-spa-shape] ${shape} findings=${ui.findings?.length ?? 0}`,
      );
    }
    return;
  }
  counter.other += 1;
  // eslint-disable-next-line no-console
  console.info(`[noah-spa-shape] other kind=${ui.kind}`);
}
