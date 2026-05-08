/**
 * Dev-only fixtures for visually testing the structured SPA / Done card
 * renderers without round-tripping the LLM, AND for running real
 * end-to-end adoption scenarios through the live app.
 *
 * Gated on `import.meta.env.DEV` — does not ship in production builds.
 *
 * Visual fixtures (instant, no LLM):
 *   __noahDev.injectSpa()        // structured SPA: findings + steps
 *   __noahDev.injectSpaWaiting() // findings + WAIT_FOR_USER instructions
 *   __noahDev.injectDone()       // Done card with findings
 *   __noahDev.injectActiveSteps()// steps with active/done states
 *   __noahDev.clear()            // wipe the chat (current session only)
 *
 * End-to-end scenario runner (real LLM through real auth path):
 *   await __noahDev.runScenarios()
 *   await __noahDev.runScenarios({ only: "net-slow" })
 *
 * Drives the actual `send_message_v2` Tauri command, so it goes through
 * the real orchestrator → real ProxyAuth → real Anthropic / consumer
 * proxy. The only thing bypassed is React state rendering — adoption
 * shape comes straight from `assistant_ui` returned by the command.
 */
import { useChatStore } from "../stores/chatStore";
import * as commands from "./tauri-commands";
import type { AssistantUiPayload } from "./tauri-commands";
import { recordAssistantUiShape } from "./spaShapeTelemetry";

const SPA_INTERNET: AssistantUiPayload = {
  kind: "spa",
  situation:
    "Your Wi-Fi is fine — your ISP is giving you twitchy ping with high jitter.",
  findings: [
    { label: "Ping (avg)", value: "29.5ms", tone: "warn", sub: "spikes to 132ms" },
    { label: "Router ping", value: "3.9ms", tone: "good" },
    { label: "DNS reachable", value: "Yes", tone: "good" },
    { label: "Network", value: "192.168.1.42", sub: "DNS: 192.168.1.1" },
  ],
  steps: [
    {
      label: "Run a comprehensive speed test",
      detail: "Real throughput, not just ping",
    },
    {
      label: "Scan Wi-Fi environment",
      detail: "Channel congestion, interference",
    },
    {
      label: "List network-hogging processes",
      detail: "iCloud sync, downloads, etc.",
    },
  ],
  action: { label: "Run diagnostics", type: "RUN_STEP" },
};

const SPA_WAITING: AssistantUiPayload = {
  kind: "spa",
  situation:
    "Power-cycle your router: unplug it for 10 seconds, plug it back in, wait 60 seconds for it to come back online.",
  findings: [
    { label: "Ping to 8.8.8.8", value: "Failed", tone: "bad", sub: "timed out" },
    { label: "Ping to gateway", value: "Failed", tone: "bad" },
    { label: "Wi-Fi signal", value: "-72 dBm", tone: "warn", sub: "weak" },
  ],
  action: { label: "I've done this", type: "WAIT_FOR_USER" },
};

const SPA_ACTIVE_STEPS: AssistantUiPayload = {
  kind: "spa",
  situation: "Running comprehensive diagnostics to pinpoint the issue.",
  steps: [
    { label: "Check internet reachability", status: "done" },
    { label: "Measure throughput", status: "active" },
    { label: "Scan Wi-Fi environment", status: "pending" },
    { label: "List network-hogging processes", status: "pending" },
  ],
  action: { label: "Cancel", type: "WAIT_FOR_USER" },
};

const DONE_INTERNET: AssistantUiPayload = {
  kind: "done",
  summary:
    "Switched Wi-Fi to channel 11 — interference cleared. Latency dropped from 18ms to 4ms.",
  // Before/after pairs collapsed into single cells via `sub` so the row
  // stays tight, and the `good` tone is reserved for the headline win
  // only. The jitter improvement is real but secondary — neutral keeps
  // the green from going hollow.
  findings: [
    { label: "Ping", value: "4ms", sub: "from 18ms", tone: "good" },
    { label: "Jitter", value: "±1ms", sub: "from ±9ms" },
    { label: "Channel", value: "11", sub: "was 36" },
  ],
};

function inject(ui: AssistantUiPayload) {
  useChatStore.getState().addMessage({
    role: "assistant",
    content: JSON.stringify(ui),
    assistantUi: ui,
  });
}

/**
 * The 5 adoption scenarios. Each prompt is what a real user would type;
 * we measure how the production model populates findings/steps after
 * running its diagnostic tools.
 */
const SCENARIOS: ReadonlyArray<{ id: string; prompt: string }> = [
  { id: "net-slow", prompt: "My internet is slow" },
  { id: "mac-slow", prompt: "My Mac feels really sluggish" },
  { id: "disk-full", prompt: "I keep getting 'disk full' warnings" },
  { id: "wifi-drops", prompt: "My Wi-Fi keeps disconnecting every few minutes" },
  { id: "homebrew-setup", prompt: "How do I set up Homebrew?" },
];

interface ScenarioResult {
  id: string;
  prompt: string;
  ok: boolean;
  shape: string;
  findingsCount: number;
  stepsCount: number;
  hasPlanMd: boolean;
  situationChars: number;
  situation: string;
  rawTextPreview: string;
  durationMs: number;
  error?: string;
}

function classifyShape(ui: AssistantUiPayload | undefined): {
  shape: string;
  findingsCount: number;
  stepsCount: number;
  hasPlanMd: boolean;
  situation: string;
} {
  if (!ui) {
    return {
      shape: "no_assistant_ui",
      findingsCount: 0,
      stepsCount: 0,
      hasPlanMd: false,
      situation: "",
    };
  }
  if (ui.kind === "spa") {
    const findings = ui.findings ?? [];
    const steps = ui.steps ?? [];
    const hasPlan = !!ui.plan && ui.plan.trim().length > 0;
    let shape: string;
    if (findings.length > 0 && steps.length > 0) shape = "spa_both";
    else if (findings.length > 0) shape = "spa_findings_only";
    else if (steps.length > 0) shape = "spa_steps_only";
    else if (hasPlan) shape = "spa_legacy_plan_only";
    else shape = "spa_bare";
    return {
      shape,
      findingsCount: findings.length,
      stepsCount: steps.length,
      hasPlanMd: hasPlan,
      situation: ui.situation,
    };
  }
  if (ui.kind === "done") {
    return {
      shape: ui.findings && ui.findings.length > 0 ? "done_findings" : "done_bare",
      findingsCount: ui.findings?.length ?? 0,
      stepsCount: 0,
      hasPlanMd: false,
      situation: ui.summary,
    };
  }
  return {
    shape: ui.kind,
    findingsCount: 0,
    stepsCount: 0,
    hasPlanMd: false,
    situation: ui.kind === "info" ? ui.summary : "",
  };
}

async function runOneScenario(scenario: {
  id: string;
  prompt: string;
}): Promise<ScenarioResult> {
  const t0 = performance.now();
  try {
    // Fresh session per scenario so each test starts from a clean slate
    // and doesn't carry over conversation history that would skew the
    // model's behavior. Uses the same Tauri command the app uses.
    const session = await commands.createSession();
    const result = await commands.sendMessageV2(session.id, scenario.prompt);
    recordAssistantUiShape(result.assistant_ui);
    const cls = classifyShape(result.assistant_ui);
    return {
      id: scenario.id,
      prompt: scenario.prompt,
      ok: true,
      shape: cls.shape,
      findingsCount: cls.findingsCount,
      stepsCount: cls.stepsCount,
      hasPlanMd: cls.hasPlanMd,
      situationChars: cls.situation.length,
      situation: cls.situation,
      rawTextPreview: result.text.slice(0, 240),
      durationMs: Math.round(performance.now() - t0),
    };
  } catch (err) {
    return {
      id: scenario.id,
      prompt: scenario.prompt,
      ok: false,
      shape: "error",
      findingsCount: 0,
      stepsCount: 0,
      hasPlanMd: false,
      situationChars: 0,
      situation: "",
      rawTextPreview: "",
      durationMs: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface RunOptions {
  only?: string;
  /** Verbose per-scenario console output (default true). */
  verbose?: boolean;
}

async function runScenarios(opts: RunOptions = {}): Promise<{
  results: ScenarioResult[];
  summary: Record<string, string>;
}> {
  const verbose = opts.verbose !== false;
  const list = opts.only
    ? SCENARIOS.filter((s) => s.id === opts.only)
    : SCENARIOS;
  if (list.length === 0) {
    // eslint-disable-next-line no-console
    console.warn(`[noah-dev] no scenarios match: ${opts.only}`);
    return { results: [], summary: {} };
  }

  if (verbose) {
    // eslint-disable-next-line no-console
    console.info(
      `[noah-dev] running ${list.length} scenario(s) through send_message_v2 — uses live auth + orchestrator + LLM`,
    );
  }

  const results: ScenarioResult[] = [];
  for (const s of list) {
    if (verbose) {
      // eslint-disable-next-line no-console
      console.info(`[noah-dev]   → ${s.id}: ${s.prompt}`);
    }
    const r = await runOneScenario(s);
    if (verbose) {
      if (r.ok) {
        // eslint-disable-next-line no-console
        console.info(
          `[noah-dev]   ← ${r.shape} findings=${r.findingsCount} steps=${r.stepsCount} sit=${r.situationChars}c (${r.durationMs}ms)`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.error(`[noah-dev]   ← ERROR ${r.error}`);
      }
    }
    results.push(r);
  }

  // Aggregate
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.shape] = (counts[r.shape] ?? 0) + 1;
  const spaKeys = [
    "spa_bare",
    "spa_legacy_plan_only",
    "spa_findings_only",
    "spa_steps_only",
    "spa_both",
  ];
  const spaTotal = spaKeys.reduce((acc, k) => acc + (counts[k] ?? 0), 0);
  const pct = (n: number, d: number): string =>
    d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`;
  const summary: Record<string, string> = {
    scenarios: String(results.length),
    spa_total: String(spaTotal),
    spa_with_findings: pct(
      (counts.spa_findings_only ?? 0) + (counts.spa_both ?? 0),
      spaTotal,
    ),
    spa_with_steps: pct(
      (counts.spa_steps_only ?? 0) + (counts.spa_both ?? 0),
      spaTotal,
    ),
    spa_with_both: pct(counts.spa_both ?? 0, spaTotal),
    spa_bare: pct(counts.spa_bare ?? 0, spaTotal),
    spa_legacy_plan_only: pct(counts.spa_legacy_plan_only ?? 0, spaTotal),
    other: String(
      results.length -
        spaTotal -
        (counts.done_bare ?? 0) -
        (counts.done_findings ?? 0),
    ),
  };

  if (verbose) {
    // eslint-disable-next-line no-console
    console.info("[noah-dev] === per-scenario ===");
    // eslint-disable-next-line no-console
    console.table(
      results.map((r) => ({
        id: r.id,
        shape: r.shape,
        findings: r.findingsCount,
        steps: r.stepsCount,
        sit_c: r.situationChars,
        ms: r.durationMs,
      })),
    );
    // eslint-disable-next-line no-console
    console.info("[noah-dev] === summary ===");
    // eslint-disable-next-line no-console
    console.table(summary);
  }

  return { results, summary };
}

export function exposeDevFixtures() {
  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined") return;

  const api = {
    injectSpa: () => inject(SPA_INTERNET),
    injectSpaWaiting: () => inject(SPA_WAITING),
    injectActiveSteps: () => inject(SPA_ACTIVE_STEPS),
    injectDone: () => inject(DONE_INTERNET),
    clear: () => useChatStore.getState().clearMessages(),
    runScenarios,
    listScenarios: () => SCENARIOS.map((s) => `${s.id}: ${s.prompt}`),
    chatStore: useChatStore,
  };

  (window as unknown as { __noahDev: typeof api }).__noahDev = api;
  // eslint-disable-next-line no-console
  console.info(
    "[noah-dev] __noahDev ready —\n" +
      "  visual fixtures: injectSpa() / injectDone() / injectActiveSteps() / injectSpaWaiting() / clear()\n" +
      "  E2E adoption test: await __noahDev.runScenarios()  (or { only: 'net-slow' })",
  );
}
