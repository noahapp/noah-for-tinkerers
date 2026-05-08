import { describe, it, expect } from "vitest";
import { parseResponse } from "./parseResponse";

// ── Phase 1: structured SPA contract (findings + steps + sanitizer) ──
//
// These tests cover the new ui_spa shape plus the defensive sanitization
// that catches model drift back into prose-with-bullets. See sanitizeSpa.ts
// for the strict colon-extraction rules.

describe("parseResponse — structured SPA", () => {
  it("parses SPA with findings using new tone vocabulary", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "Disk is critically full.",
      findings: [
        { label: "Disk usage", value: "94%", tone: "bad" },
        { label: "Free space", value: "12 GB", tone: "warn" },
        { label: "Backups", value: "Time Machine", tone: "good" },
        { label: "Mount", value: "/dev/disk3s1", tone: "neutral" },
      ],
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    expect(result).toMatchObject({
      type: "action",
      findings: [
        { label: "Disk usage", value: "94%", tone: "bad" },
        { label: "Free space", value: "12 GB", tone: "warn" },
        { label: "Backups", value: "Time Machine", tone: "good" },
        { label: "Mount", value: "/dev/disk3s1", tone: "neutral" },
      ],
    });
  });

  it("parses finding `sub` field (renamed from hint)", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "Internet ping is healthy.",
      findings: [
        {
          label: "Internet ping",
          value: "23ms",
          sub: "avg, 3 packets",
          tone: "good",
        },
        {
          label: "Network",
          value: "192.168.1.42",
          sub: "DNS: 192.168.1.1",
        },
      ],
      action: { label: "Run more checks", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.findings?.[0].sub).toBe("avg, 3 packets");
    expect(result.findings?.[1].sub).toBe("DNS: 192.168.1.1");
    expect(result.findings?.[1].tone).toBeUndefined();
  });

  it("parses SPA with steps", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "Wi-Fi is down.",
      steps: [
        { label: "Power-cycle the router" },
        { label: "Re-test connectivity", status: "pending" },
      ],
      action: { label: "I've done this", type: "WAIT_FOR_USER" },
    });
    const result = parseResponse(raw);
    expect(result).toMatchObject({
      type: "action",
      steps: [
        { label: "Power-cycle the router" },
        { label: "Re-test connectivity", status: "pending" },
      ],
    });
  });

  it("parses ui_done with optional findings", () => {
    const raw = JSON.stringify({
      kind: "done",
      summary: "Cleared the DNS cache and restarted Wi-Fi.",
      findings: [
        { label: "DNS lookup", value: "OK", tone: "good" },
        { label: "Ping (avg)", value: "12ms", tone: "good" },
      ],
    });
    const result = parseResponse(raw);
    expect(result).toMatchObject({
      type: "done",
      summary: "Cleared the DNS cache and restarted Wi-Fi.",
      findings: [
        { label: "DNS lookup", value: "OK", tone: "good" },
        { label: "Ping (avg)", value: "12ms", tone: "good" },
      ],
    });
  });

  it("ignores non-array findings/steps from a malformed payload", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "Disk full.",
      findings: "not an array",
      steps: { label: "also wrong" },
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.findings).toBeUndefined();
    expect(result.steps).toBeUndefined();
  });
});

describe("parseResponse — sanitizer", () => {
  it("strips markdown headers from situation", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "## Findings\n\nYour disk is full.",
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.situation).toBe("Your disk is full.");
  });

  it("extracts strict colon-style bullets into findings when findings is empty", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "I found these issues:\n- **Disk usage**: 94%\n- **Memory**: 8 GB swap",
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.findings).toEqual([
      { label: "Disk usage", value: "94%" },
      { label: "Memory", value: "8 GB swap" },
    ]);
    expect(result.situation).not.toContain("- ");
  });

  it("does NOT extract bullets when any value exceeds 24 chars (avoid garbage findings)", () => {
    // Real production drift: "**Virtual Machine**: 2GB+ (com.apple.Virtual) - running a virtual machine"
    const raw = JSON.stringify({
      kind: "spa",
      situation:
        "Issues:\n- **Virtual Machine**: 2GB+ (com.apple.Virtual) - running a virtual machine\n- **Chrome processes**: 652MB, 471MB, multiple helper processes",
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.findings).toBeUndefined();
    // Situation kept as-is so the markdown fallback can render it.
    expect(result.situation).toContain("Virtual Machine");
  });

  it("does NOT overwrite real findings with bullet extraction", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "I found these:\n- **Disk**: 94%\n- **RAM**: 90%",
      findings: [{ label: "Real finding", value: "stays", tone: "bad" }],
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.findings).toEqual([
      { label: "Real finding", value: "stays", tone: "bad" },
    ]);
  });

  it("collapses multi-paragraph situation to first paragraph", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation:
        "Your network is down.\n\nThis is because the router is unreachable.",
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    if (result.type !== "action") throw new Error("expected action");
    expect(result.situation).toBe("Your network is down.");
  });

  it("legacy SPA without findings/steps still parses identically to before", () => {
    const raw = JSON.stringify({
      kind: "spa",
      situation: "Single sentence.",
      plan: "Some plan.",
      action: { label: "Fix it", type: "RUN_STEP" },
    });
    const result = parseResponse(raw);
    expect(result).toMatchObject({
      type: "action",
      situation: "Single sentence.",
      plan: "Some plan.",
      actionLabel: "Fix it",
      actionType: "RUN_STEP",
    });
  });
});

describe("parseResponse", () => {
  // ── Action cards ──

  it("parses a full action response", () => {
    const raw = `[SITUATION]
Your iPhone "Alex's iPhone" is available as a Wi-Fi hotspot nearby.
[PLAN]
Connect this Mac to your iPhone's hotspot via Wi-Fi.
[ACTION:Connect]`;

    const result = parseResponse(raw);
    expect(result).toEqual({
      type: "action",
      situation: `Your iPhone "Alex's iPhone" is available as a Wi-Fi hotspot nearby.`,
      plan: "Connect this Mac to your iPhone's hotspot via Wi-Fi.",
      actionLabel: "Connect",
    });
  });

  it("parses action with multi-word button label", () => {
    const raw = `[SITUATION]
DNS cache is stale.
[PLAN]
Flush the DNS cache to resolve the lookup failures.
[ACTION:Fix it]`;

    const result = parseResponse(raw);
    expect(result.type).toBe("action");
    if (result.type === "action") {
      expect(result.actionLabel).toBe("Fix it");
    }
  });

  it("handles extra whitespace around sections", () => {
    const raw = `
  [SITUATION]

  Your printer queue is stuck with 3 jobs.

  [PLAN]

  Cancel all pending print jobs and restart the print service.

  [ACTION:Fix it]
  `;

    const result = parseResponse(raw);
    expect(result.type).toBe("action");
    if (result.type === "action") {
      expect(result.situation).toBe(
        "Your printer queue is stuck with 3 jobs.",
      );
      expect(result.plan).toBe(
        "Cancel all pending print jobs and restart the print service.",
      );
    }
  });

  // ── Done cards ──

  it("parses a done response", () => {
    const raw = `[DONE]
Connected to "Alex's iPhone" hotspot. Verified — internet is working.`;

    const result = parseResponse(raw);
    expect(result).toEqual({
      type: "done",
      summary: `Connected to "Alex's iPhone" hotspot. Verified — internet is working.`,
    });
  });

  it("parses multi-line done response", () => {
    const raw = `[DONE]
Flushed DNS cache successfully.
Verified: google.com now resolves to 142.250.80.46.`;

    const result = parseResponse(raw);
    expect(result.type).toBe("done");
    if (result.type === "done") {
      expect(result.summary).toContain("Flushed DNS cache");
      expect(result.summary).toContain("142.250.80.46");
    }
  });

  // ── Info cards ──

  it("parses an info response", () => {
    const raw = `[INFO]
Your Wi-Fi is connected to "HomeNetwork" at 45 Mbps. Everything looks normal.`;

    const result = parseResponse(raw);
    expect(result).toEqual({
      type: "info",
      summary: `Your Wi-Fi is connected to "HomeNetwork" at 45 Mbps. Everything looks normal.`,
    });
  });

  // ── Fallback to plain text ──

  it("falls back to text for unstructured responses", () => {
    const raw = "I checked your system and everything looks fine.";

    const result = parseResponse(raw);
    expect(result).toEqual({
      type: "text",
      content: "I checked your system and everything looks fine.",
    });
  });

  it("falls back to text for empty string", () => {
    const result = parseResponse("");
    expect(result).toEqual({ type: "text", content: "" });
  });

  it("falls back to text when markers are incomplete", () => {
    const raw = `[SITUATION]
Something is wrong but no plan follows.`;

    const result = parseResponse(raw);
    // No [PLAN] or [ACTION], so doesn't match action pattern.
    // Also not [DONE] or [INFO], so falls back to text.
    expect(result.type).toBe("text");
  });

  // ── Edge cases ──

  it("handles markers with no content gracefully", () => {
    const raw = `[INFO]
`;
    // The regex requires [\s\S]+ (one or more chars), so empty content won't match
    const result = parseResponse(raw);
    expect(result.type).toBe("text");
  });

  it("only matches first occurrence of action pattern", () => {
    const raw = `[SITUATION]
First problem.
[PLAN]
First fix.
[ACTION:Fix]

Some extra text after.`;

    const result = parseResponse(raw);
    expect(result.type).toBe("action");
    if (result.type === "action") {
      expect(result.situation).toBe("First problem.");
      expect(result.plan).toBe("First fix.");
      expect(result.actionLabel).toBe("Fix");
    }
  });
});
