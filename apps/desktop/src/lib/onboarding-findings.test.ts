import { describe, expect, it } from "vitest";
import type { CheckResult, HealthScore } from "./tauri-commands";
import { findingsFromHealthScore } from "./onboarding-findings";

function check(over: Partial<CheckResult>): CheckResult {
  return { id: "x", category: "general", label: "L", status: "pass", detail: "d", ...over };
}
function score(checks: CheckResult[]): HealthScore {
  return {
    overall_score: 70, overall_grade: "C",
    categories: [{ category: "mixed", score: 70, grade: "C", checks }],
    computed_at: "now", device_id: null,
  };
}

describe("findingsFromHealthScore", () => {
  it("returns [] for null / empty input", () => {
    expect(findingsFromHealthScore(null, "slow")).toEqual([]);
    expect(findingsFromHealthScore(score([]), "slow")).toEqual([]);
  });

  it("maps status → tone and carries label/detail", () => {
    const out = findingsFromHealthScore(score([
      check({ status: "fail", label: "Low memory", detail: "9 GB used", category: "memory" }),
    ]), "slow");
    expect(out[0]).toMatchObject({ tone: "bad", label: "Low memory", detail: "9 GB used" });
    expect(out[0]!.big).toBeUndefined(); // real checks lead with the label
  });

  it("leads with issues (fail before warn before pass)", () => {
    const out = findingsFromHealthScore(score([
      check({ status: "pass", label: "Firewall on" }),
      check({ status: "warn", label: "Startup heavy" }),
      check({ status: "fail", label: "Disk almost full" }),
    ]), "slow");
    expect(out.map((f) => f.label)).toEqual(["Disk almost full", "Startup heavy", "Firewall on"]);
  });

  it("within a tier, surfaces the user's problem area first", () => {
    const out = findingsFromHealthScore(score([
      check({ status: "warn", label: "Old backups", category: "backup" }),
      check({ status: "warn", label: "RAM pressure", category: "memory" }),
    ]), "slow");
    expect(out[0]!.label).toBe("RAM pressure"); // slow → memory is on-topic
  });

  it("matches the problem area by category OR label text", () => {
    const out = findingsFromHealthScore(score([
      check({ status: "warn", label: "Time Machine overdue", category: "general" }),
      check({ status: "warn", label: "Something", category: "other" }),
    ]), "backup");
    expect(out[0]!.label).toBe("Time Machine overdue"); // matched via label text
  });

  it("caps at max and includes a passing check as reassurance when room", () => {
    const out = findingsFromHealthScore(score([
      check({ status: "fail", label: "A" }),
      check({ status: "warn", label: "B" }),
      check({ status: "pass", label: "C-ok" }),
      check({ status: "pass", label: "D-ok" }),
      check({ status: "warn", label: "E" }),
    ]), "slow", 4);
    expect(out).toHaveLength(4);
    expect(out.filter((f) => f.tone !== "ok").length).toBeGreaterThanOrEqual(3); // issues lead
    expect(out.some((f) => f.tone === "ok")).toBe(true); // one reassurance card
  });
});
