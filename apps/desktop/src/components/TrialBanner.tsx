import { useConsumerStore } from "../stores/consumerStore";
import { useLocale } from "../i18n";
import { formatTrialEndDate } from "../lib/trial-format";

/**
 * Subtle persistent strip that shows a single fact: the date the user's
 * free trial runs through. Renders only while status === "trialing".
 *
 * The whole strip is clickable — opens the subscribe modal with the
 * "second_issue" variant copy (which is the "you're on a trial, here
 * are your plan options" surface). This is the user-initiated way to
 * subscribe before either the auto-trigger or trial expiry.
 *
 * Date format mirrors the server's confirmation-email format
 * (e.g. "Thu, May 8") so the customer-visible "until" string is
 * identical across surfaces.
 */
export function TrialBanner() {
  const { t } = useLocale();
  const ent = useConsumerStore((s) => s.entitlement);
  const openModal = useConsumerStore((s) => s.openSubscribeModal);
  if (!ent || ent.status !== "trialing" || !ent.trial_ends_at) return null;

  const dateLabel = formatTrialEndDate(
    ent.trial_ends_at,
    ent.tz_offset_minutes ?? null,
  );
  const dateText = t("trialBanner.activeUntil").replace("{date}", dateLabel);

  return (
    <button
      type="button"
      onClick={() => openModal("second_issue")}
      className="w-full px-4 py-2 text-[12.5px] bg-bg-secondary/40 hover:bg-bg-secondary border-b border-border-primary transition-colors flex items-center justify-center gap-2.5 cursor-pointer"
    >
      <span
        aria-hidden
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: "var(--color-accent-green)" }}
      />
      {/* Value-led: the user is reminded that Noah is *theirs to use*
          before they're shown the deadline. The deadline is a soft
          dependent clause, not the headline. */}
      <span className="text-text-primary font-medium">
        {t("trialBanner.lead")}
      </span>
      <span className="text-text-muted">— {dateText}</span>
      <span className="text-text-muted/40 mx-1">·</span>
      <span
        className="hover:underline font-medium"
        style={{ color: "var(--color-accent-indigo)" }}
      >
        {t("trialBanner.subscribeCta")}
      </span>
    </button>
  );
}
