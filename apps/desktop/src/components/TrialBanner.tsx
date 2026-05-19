import { useConsumerStore } from "../stores/consumerStore";
import { useLocale } from "../i18n";
import { formatTrialEndDate } from "../lib/trial-format";

/**
 * Compact trial-state card pinned to the sidebar footer. Renders only
 * while the entitlement is "trialing". Clicking the Subscribe button
 * opens the subscribe modal — same target as the previous horizontal
 * banner; relocated to the sidebar so the chat canvas stays unobstructed.
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
    <div className="rounded-xl border border-border-primary bg-bg-primary/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: "var(--color-accent-green)" }}
        />
        <span className="text-[12px] text-text-primary font-medium leading-tight">
          {t("trialBanner.lead")}
        </span>
      </div>
      <div className="text-[11px] text-text-muted mt-1 leading-snug">
        {dateText}
      </div>
      <button
        type="button"
        onClick={() => openModal("second_issue")}
        className="mt-2 w-full text-center text-[12px] font-semibold py-1.5 rounded-lg transition-colors cursor-pointer"
        style={{
          background: "var(--aurora-soft)",
          color: "var(--color-accent-indigo)",
        }}
      >
        {t("trialBanner.subscribeCta")}
      </button>
    </div>
  );
}
