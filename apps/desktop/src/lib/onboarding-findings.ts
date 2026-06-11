import type { CheckResult, HealthScore } from "./tauri-commands";
import type { Finding } from "../components/OnboardingFlow";

/**
 * Turn a real `HealthScore` (the same diagnostics behind the Mac Health
 * dashboard) into the onboarding **diagnosis** cards — leading with the issues
 * relevant to the problem the user picked, so the reveal answers *their*
 * question ("why is it slow?"), not a generic report.
 *
 * Pure + testable. The onboarding scan step calls `getHealthScore()` and passes
 * the result through this; until that wiring lands, OnboardingFlow's built-in
 * defaults stand in.
 */

// Which health categories speak to each problem. Matched case-insensitively as
// substrings so we're robust to "Performance"/"perf"/"memory" naming.
const PROBLEM_CATEGORIES: Record<string, string[]> = {
  slow: ["performance", "memory", "cpu", "startup", "process"],
  storage: ["storage", "disk", "space"],
  wifi: ["network", "wifi", "wi-fi", "dns"],
  security: ["security", "firewall", "privacy", "malware"],
  backup: ["backup", "time machine", "snapshot"],
};

const STATUS_TONE: Record<CheckResult["status"], Finding["tone"]> = {
  fail: "bad",
  warn: "warn",
  pass: "ok",
};

function onTopic(check: CheckResult, problem: string): boolean {
  const cats = PROBLEM_CATEGORIES[problem] ?? [];
  const hay = `${check.category} ${check.label}`.toLowerCase();
  return cats.some((c) => hay.includes(c));
}

/**
 * @param max  cap the cards (the grid shows ~4 cleanly).
 * @returns issues first (fail before warn), the user's problem area first
 *   within each tier; a passing on-topic check is included last as reassurance
 *   ("you're fine here") so the reveal isn't all doom.
 */
export function findingsFromHealthScore(
  score: HealthScore | null | undefined,
  problem: string,
  max = 4,
): Finding[] {
  if (!score || !Array.isArray(score.categories)) return [];
  const checks = score.categories.flatMap((c) => c.checks ?? []);

  const sevRank = (s: CheckResult["status"]): number =>
    s === "fail" ? 0 : s === "warn" ? 1 : 2;

  const ranked = [...checks].sort((a, b) => {
    const sa = sevRank(a.status);
    const sb = sevRank(b.status);
    if (sa !== sb) return sa - sb; // issues before passes
    const ta = onTopic(a, problem) ? 0 : 1;
    const tb = onTopic(b, problem) ? 0 : 1;
    return ta - tb; // problem area first within a severity tier
  });

  // Lead with real issues; only pad with passing (reassurance) checks if we
  // have room and there's at least one issue worth showing.
  const issues = ranked.filter((c) => c.status !== "pass");
  const passes = ranked.filter((c) => c.status === "pass");
  const chosen = issues.length
    ? [...issues, ...passes].slice(0, max)
    : ranked.slice(0, max);

  return chosen.map((c) => ({
    tone: STATUS_TONE[c.status],
    label: c.label,
    detail: c.detail,
    // real checks rarely carry a clean headline number → label-led card
  }));
}
