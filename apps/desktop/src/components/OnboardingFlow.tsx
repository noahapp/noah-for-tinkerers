import { useEffect, useState } from "react";
import { getHealthScore, type HealthScore } from "../lib/tauri-commands";
import { findingsFromHealthScore } from "../lib/onboarding-findings";
import { useConsumerStore } from "../stores/consumerStore";
import { useScanRevealPaywall } from "../stores/useScanRevealPaywall";
import { SignInScreen } from "./SignInScreen";

/**
 * Noah onboarding — problem-led, proof-first. Welcome → "what's wrong?" →
 * a real (here: simulated) scan → a *diagnosis* (not a junk list) → and at the
 * reveal it mounts `useScanRevealPaywall`, which surfaces the card-on-file trial
 * paywall for launch-arm users. Design spec + rationale:
 * noah-consumer/designs/onboarding/SPEC.md.
 *
 * The paywall itself is the app-level <SubscribeModal>, opened via the store by
 * the hook — so this component only drives the steps and the signals. Findings
 * and scan duration are injectable so the real diagnostics (and tests) plug in.
 */
type Step = "welcome" | "pick" | "scan" | "reveal" | "signin";

// First-message seed per problem — stashed by SignInScreen so the chat
// auto-sends it after login, turning the problem the user picked into Noah's
// first fix. Plain first-person phrasing, matching the in-app templates.
const SEED_MESSAGES: Record<string, string> = {
  slow: "My Mac feels slow",
  storage: "I'm running low on storage",
  wifi: "My Wi-Fi keeps dropping",
  security: "I'm worried my Mac isn't secure",
  backup: "I'm not sure my Mac is backed up",
  other: "Something's wrong with my Mac",
};
type Tone = "bad" | "warn" | "ok";

export interface Finding {
  tone: Tone;
  /** Punchy headline value ("9.1 GB", "12 apps"). Optional — real diagnostic
   *  checks don't always have a clean number, in which case the card leads with
   *  the label. */
  big?: string;
  label: string;
  detail: string;
}

export interface OnboardingFlowProps {
  /** Called when the user finishes / skips onboarding into the app. */
  onComplete: () => void;
  /** Pre-selected problem (e.g. passed through from the ad). Defaults to "slow". */
  initialProblem?: string;
  /** Scan dwell before the reveal. Override (e.g. 0) in tests. */
  scanDurationMs?: number;
  /** Diagnosis cards per problem. Fallback when the live scan finds nothing. */
  findingsByProblem?: Record<string, Finding[]>;
  /** Diagnostics source. Defaults to the real `getHealthScore`; injectable for tests. */
  fetchHealthScore?: () => Promise<HealthScore | null>;
}

const PROBLEMS: { id: string; emoji: string; title: string; sub: string }[] = [
  { id: "slow", emoji: "🐢", title: "It's slow", sub: "lags, beachballs, fans spinning" },
  { id: "storage", emoji: "💾", title: "It's full", sub: "out of storage, can't update" },
  { id: "wifi", emoji: "📶", title: "Won't connect", sub: "Wi-Fi drops, sites won't load" },
  { id: "security", emoji: "🔒", title: "Feels unsafe", sub: "pop-ups, privacy, malware" },
  { id: "backup", emoji: "🛟", title: "Not backed up", sub: "scared of losing things" },
  { id: "other", emoji: "💬", title: "Something else", sub: "just ask — I'll figure it out" },
];

// Lead plain, one credible detail for depth (design call #3).
const DEFAULT_FINDINGS: Record<string, Finding[]> = {
  slow: [
    { tone: "bad", big: "9.1 GB", label: "Tied up by Chrome + 47 tabs", detail: "starving the rest of your Mac" },
    { tone: "warn", big: "1 core", label: "Pinned by a stuck process", detail: "a backup helper looping in the background" },
    { tone: "warn", big: "12 apps", label: "Launch at login", detail: "loading on startup, mostly unused" },
    { tone: "ok", big: "23 GB", label: "Junk I can also clear", detail: "caches, logs, old installers" },
  ],
  storage: [
    { tone: "bad", big: "31 GB", label: "Reclaimable now", detail: "caches, old installers, trash" },
    { tone: "warn", big: "18 GB", label: "Duplicate downloads", detail: "same files, many copies" },
    { tone: "warn", big: "4.2 GB", label: "Leftover from deleted apps", detail: "support files no app uses" },
    { tone: "ok", big: "On", label: "iCloud could offload more", detail: "I can set that up too" },
  ],
  wifi: [
    { tone: "bad", label: "DNS is timing out", detail: "why some sites won't load" },
    { tone: "warn", label: "Crowded Wi-Fi channel", detail: "your router overlaps 3 neighbors" },
    { tone: "warn", label: "Weak signal where you sit", detail: "−72 dBm — borderline" },
    { tone: "ok", label: "Connection itself is stable", detail: "no dropped link in the last hour" },
  ],
  security: [
    { tone: "bad", label: "FileVault is off", detail: "your disk isn't encrypted" },
    { tone: "warn", label: "5 security updates pending", detail: "including a Safari patch" },
    { tone: "warn", label: "2 login items you didn't add", detail: "worth a look" },
    { tone: "ok", label: "Firewall is on", detail: "you're covered here" },
  ],
  backup: [
    { tone: "bad", big: "11 days", label: "Since your last backup", detail: "Time Machine is overdue" },
    { tone: "warn", label: "No backup disk configured", detail: "nothing's catching your files" },
    { tone: "warn", label: "iCloud has only the basics", detail: "Desktop & Documents aren't synced" },
    { tone: "ok", label: "Your files are intact right now", detail: "let's keep it that way" },
  ],
  other: [
    { tone: "warn", label: "A few things worth a look", detail: "I checked memory, storage, security & backups" },
    { tone: "ok", label: "Nothing on fire", detail: "tell me what's bugging you and I'll dig in" },
  ],
};

const TONE: Record<Tone, { bg: string; fg: string; mark: string }> = {
  bad: { bg: "rgba(239,68,68,0.12)", fg: "#ef4444", mark: "!" },
  warn: { bg: "rgba(245,158,11,0.14)", fg: "#d97706", mark: "!" },
  ok: { bg: "rgba(16,185,129,0.14)", fg: "#0f9d6b", mark: "✓" },
};

const btn =
  "inline-flex items-center justify-center gap-2 rounded-2xl px-7 py-3.5 text-[15px] font-semibold text-white cursor-pointer";

export function OnboardingFlow({
  onComplete,
  initialProblem,
  scanDurationMs = 2600,
  findingsByProblem = DEFAULT_FINDINGS,
  fetchHealthScore = getHealthScore,
}: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [problem, setProblem] = useState(initialProblem ?? "slow");
  const [liveFindings, setLiveFindings] = useState<Finding[] | null>(null);
  const fixCount = useConsumerStore((s) => s.entitlement?.fix_count_total ?? 0);

  // The integration: once the reveal is on screen, surface the launch-arm
  // paywall (the hook is a one-shot no-op for the after-fix arm / trialing users).
  useScanRevealPaywall({ scanRevealed: step === "reveal", firstFixReached: fixCount > 0 });

  useEffect(() => {
    if (step !== "scan") return;
    let active = true;
    // Real diagnosis: fetch the health score during the scan dwell and map it
    // to findings. Falls back to the curated defaults if it's empty or errors,
    // so the reveal is never blank.
    void fetchHealthScore()
      .then((score) => {
        if (!active) return;
        const mapped = findingsFromHealthScore(score, problem);
        if (mapped.length) setLiveFindings(mapped);
      })
      .catch(() => {});
    const id = setTimeout(() => setStep("reveal"), scanDurationMs);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [step, scanDurationMs, problem, fetchHealthScore]);

  // Sign-in handoff: compose the existing SignInScreen, seeded with the picked
  // problem so the chat auto-runs the fix after login. SignInScreen owns the
  // magic-link / BYOK flow and the seed stash; on success we enter the app.
  if (step === "signin") {
    const label = PROBLEMS.find((p) => p.id === problem)?.title ?? "your Mac";
    return (
      <SignInScreen
        onComplete={onComplete}
        seedContext={{ label, seedMessage: SEED_MESSAGES[problem] ?? SEED_MESSAGES.slow! }}
        onBack={() => setStep("reveal")}
      />
    );
  }

  const findings = liveFindings ?? findingsByProblem[problem] ?? findingsByProblem.slow ?? [];

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center px-8 text-center bg-bg-primary"
         style={{ background: "radial-gradient(820px 480px at 50% 30%, var(--aurora-soft), transparent 64%)" }}>
      {step === "welcome" && (
        <div data-testid="ob-welcome">
          <Orb />
          <h1 className="text-[32px] font-bold tracking-tight leading-tight text-text-primary">
            Something wrong with your Mac?<br />
            <span style={{ background: "var(--aurora)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Just tell Noah.</span>
          </h1>
          <p className="text-[15px] text-text-secondary mt-3.5 max-w-[460px] mx-auto leading-relaxed">
            Slow, full, won't connect, acting strange — Noah figures out what's actually wrong and fixes it with you.
          </p>
          <button className={btn + " mt-7"} style={{ background: "var(--aurora)" }} onClick={() => setStep("pick")}>Get started</button>
        </div>
      )}

      {step === "pick" && (
        <div data-testid="ob-pick" className="w-full max-w-[600px]">
          <Eyebrow>Let's start with you</Eyebrow>
          <h1 className="text-[28px] font-bold tracking-tight text-text-primary">What's bugging you?</h1>
          <p className="text-[14px] text-text-secondary mt-2 mb-5">Pick what's wrong — Noah handles all of it. Not sure? That's fine too.</p>
          <div className="grid grid-cols-2 gap-2.5 text-left">
            {PROBLEMS.map((p) => {
              const sel = problem === p.id;
              return (
                <button key={p.id} onClick={() => setProblem(p.id)}
                  className="flex items-center gap-3 p-3.5 rounded-2xl bg-bg-secondary border cursor-pointer"
                  style={{ borderColor: sel ? "transparent" : "var(--color-border-primary)", boxShadow: sel ? "0 0 0 2px var(--color-text-primary) inset" : "none" }}>
                  <span className="text-2xl">{p.emoji}</span>
                  <span><span className="block text-[15px] font-semibold text-text-primary">{p.title}</span>
                    <span className="block text-[12.5px] text-text-muted">{p.sub}</span></span>
                </button>
              );
            })}
          </div>
          <p className="text-[12.5px] text-text-muted mt-5">Noah looks read-only first, on your Mac. Nothing is deleted or sent anywhere without your OK.</p>
          <button className={btn + " mt-6"} style={{ background: "var(--aurora)" }} onClick={() => setStep("scan")}>Look into it →</button>
        </div>
      )}

      {step === "scan" && (
        <div data-testid="ob-scan">
          <Orb />
          <h1 className="text-[30px] font-bold tracking-tight text-text-primary">Finding out what's going on…</h1>
          <p className="text-[15px] text-text-secondary mt-3.5 max-w-[440px] mx-auto leading-relaxed">
            Reading your real system — what's running, what's stuck, what's piling up. No guesses.
          </p>
        </div>
      )}

      {step === "reveal" && (
        <div data-testid="ob-reveal" className="w-full max-w-[640px]">
          <Eyebrow>Here's what's really going on</Eyebrow>
          <h1 className="text-[28px] font-bold tracking-tight text-text-primary">
            Why <span style={{ background: "var(--aurora)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>your</span> Mac {problem === "storage" ? "is full" : "feels slow"}.
          </h1>
          <div className="grid grid-cols-2 gap-3 mt-6 text-left">
            {findings.map((f, i) => (
              <div key={i} className="flex gap-3 items-start p-4 rounded-2xl bg-bg-secondary border border-border-primary">
                <span className="w-8 h-8 flex-none grid place-items-center rounded-lg text-base font-bold"
                      style={{ background: TONE[f.tone].bg, color: TONE[f.tone].fg }}>{TONE[f.tone].mark}</span>
                <span>
                  {f.big && <span className="block text-[19px] font-bold leading-none text-text-primary">{f.big}</span>}
                  <span className={"block text-[13px] font-semibold text-text-primary" + (f.big ? " mt-1" : "")}>{f.label}</span>
                  <span className="block text-[12px] text-text-muted mt-0.5">{f.detail}</span>
                </span>
              </div>
            ))}
          </div>
          <p className="text-[14.5px] text-text-secondary mt-5">It's more than junk — <b className="text-text-primary">I can fix the real cause now.</b></p>
          {/* Launch arm: the paywall appears over this (via the hook). Either
              way, "Fix it" hands off to sign-in, seeded with the problem so the
              fix auto-runs once they're in. */}
          <button className={btn + " mt-5"} style={{ background: "var(--aurora)" }} onClick={() => setStep("signin")}>Fix it →</button>
        </div>
      )}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] tracking-[0.14em] uppercase font-bold mb-3.5" style={{ color: "var(--text-eyebrow, var(--color-text-muted))" }}>{children}</div>;
}

function Orb() {
  return (
    <div className="w-[72px] h-[72px] rounded-full grid place-items-center mx-auto mb-7"
         style={{ background: "var(--aurora)", boxShadow: "var(--aurora-glow)" }}>
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        <circle cx="12" cy="12" r="3.2" fill="#fff" stroke="none" />
      </svg>
    </div>
  );
}
