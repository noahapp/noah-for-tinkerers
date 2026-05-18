import { useCallback, useEffect, useState } from "react";
import { useConsumerStore } from "../stores/consumerStore";
import * as commands from "../lib/tauri-commands";
import { useLocale } from "../i18n";

const DISMISS_KEY = "noah:trial-email-asked";

/**
 * One-time soft email capture, shown only while the user is on a
 * trial without a captured email. Sits below the TrialBanner so the
 * trial-end date is the visual anchor; the nudge is the quiet,
 * dismissible ask.
 *
 * Why ask here and not at first-issue:
 *   The user has *opened the app + at least started a trial*. Their
 *   intent is real but not yet committed. This is the calmest
 *   moment to ask for an email — the user has stopped scanning and
 *   has something useful in front of them, but isn't being
 *   interrupted mid-action.
 *
 * Once dismissed OR submitted, never re-prompts on this device.
 * localStorage marker is sufficient — a fresh install ask is fine
 * (different device, possibly different user).
 *
 * The email is purely advisory: server stores it on the entitlement
 * so the day-5 trial-ending recovery cron knows where to write. We
 * don't gate any feature on whether the user provides one.
 */
export function TrialEmailNudge() {
  const { t } = useLocale();
  const entitlement = useConsumerStore((s) => s.entitlement);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Two terminal states, both removing the row from the UI:
  //   • "dismissed" — user clicked × without submitting
  //   • "thanks"    — submission succeeded; we briefly show a thank-you
  const [state, setState] = useState<"hidden" | "open" | "thanks">("hidden");

  // Decide on mount + when entitlement changes whether to show.
  // Conditions: trialing, no email already linked, not previously dismissed.
  useEffect(() => {
    if (!entitlement) return;
    if (entitlement.status !== "trialing") return;
    if (entitlement.email) return; // already captured
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    setState("open");
  }, [entitlement]);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setState("hidden");
  }, []);

  const submit = useCallback(async () => {
    const trimmed = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setError(t("trialEmailNudge.invalid"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await commands.consumerTrialLinkEmail(trimmed);
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
      setState("thanks");
      // Auto-collapse thank-you after a beat so the strip clears.
      window.setTimeout(() => setState("hidden"), 4000);
    } catch {
      // Soft-ask: don't make the user feel like they did something
      // wrong. Just let them try again, or dismiss.
      setError(t("trialEmailNudge.tryAgain"));
    } finally {
      setSubmitting(false);
    }
  }, [email, t]);

  if (state === "hidden") return null;

  return (
    <div
      className="w-full px-4 py-2.5 border-b border-border-primary flex items-center gap-3"
      style={{
        background:
          "linear-gradient(90deg, rgba(91,155,213,0.06), rgba(99,102,241,0.06) 50%, rgba(139,92,246,0.06))",
      }}
    >
      {state === "thanks" ? (
        <span className="text-[12.5px] text-text-primary flex-1">
          {t("trialEmailNudge.thanks")}
        </span>
      ) : (
        <>
          <span className="text-[12.5px] text-text-primary flex-shrink-0">
            {t("trialEmailNudge.headline")}
          </span>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder={t("trialEmailNudge.placeholder")}
            disabled={submitting}
            className="flex-1 min-w-0 px-2.5 py-1 rounded-md bg-bg-input border border-border-primary text-[12.5px] text-text-primary placeholder:text-text-muted aurora-focus"
          />
          <button
            onClick={submit}
            disabled={submitting || !email.trim()}
            className="px-3 py-1 rounded-md text-[12px] font-semibold disabled:opacity-50 cursor-pointer whitespace-nowrap"
            style={{
              background: "var(--color-accent-indigo)",
              color: "white",
            }}
          >
            {submitting ? t("trialEmailNudge.sending") : t("trialEmailNudge.submit")}
          </button>
          <button
            onClick={dismiss}
            aria-label={t("trialEmailNudge.dismissAria")}
            className="text-text-muted hover:text-text-secondary cursor-pointer text-[14px] leading-none px-1"
          >
            ×
          </button>
        </>
      )}
      {error && (
        <span className="text-[11px] text-accent-red flex-shrink-0">
          {error}
        </span>
      )}
    </div>
  );
}
