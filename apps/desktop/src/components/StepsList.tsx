import type { AssistantStep } from "../lib/tauri-commands";
import { useLocale } from "../i18n";

/**
 * Ordered remediation steps, replacing the legacy `plan_md` markdown
 * paragraph. Used inside ActionCard's "HERE'S WHAT I'D DO" section.
 *
 * Each step has a status: pending (numbered hollow circle), active
 * (numbered aurora-filled circle), done (aurora-teal check). The visual
 * distinction lets the user scan execution progress without reading.
 *
 * `tool` field is rendered in monospace beside the detail line — gives
 * the user a verifiable sense of what Noah is invoking, without leaking
 * implementation noise into the main label.
 */
export function StepsList({ steps }: { steps: AssistantStep[] }) {
  const { t } = useLocale();
  if (steps.length === 0) return null;
  return (
    <div className="px-5 pb-3">
      <span className="eyebrow mb-2">{t("chat.whatIdDo")}</span>
      <ol className="flex flex-col gap-2 mt-1">
        {steps.map((s, i) => {
          const status = s.status ?? "pending";
          return (
            <li key={`${s.label}-${i}`} className="flex items-start gap-3">
              <StepBullet index={i + 1} status={status} />
              <div className="flex-1 min-w-0 pt-0.5">
                <div
                  className={`text-[15px] leading-snug ${
                    status === "done"
                      ? "text-text-muted line-through"
                      : "text-text-primary font-medium"
                  }`}
                >
                  {s.label}
                </div>
                {/* Detail line. Tool names (e.g. `mac_flush_dns`) are
                    intentionally NOT rendered here — they're internal
                    plumbing, not user-facing. The schema retains the
                    `tool` field for telemetry / future debug surfaces,
                    but the chat surface only shows the human detail. */}
                {s.detail && (
                  <div className="text-[12px] text-text-muted leading-snug mt-0.5">
                    {s.detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StepBullet({
  index,
  status,
}: {
  index: number;
  status: NonNullable<AssistantStep["status"]>;
}) {
  if (status === "done") {
    return (
      <span
        aria-hidden
        className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0"
        style={{ background: "var(--color-accent-green)" }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return (
      <span
        aria-hidden
        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[12px] font-semibold shrink-0"
        style={{
          background: "var(--aurora)",
          boxShadow: "var(--aurora-glow)",
        }}
      >
        {index}
      </span>
    );
  }
  // pending — outline-only at 30% indigo. No fill. The numeral and the
  // ring carry the bullet; the title beside it carries the weight.
  return (
    <span
      aria-hidden
      className="w-6 h-6 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0"
      style={{
        border: "1.5px solid rgba(99, 102, 241, 0.3)",
        color: "var(--color-accent-indigo)",
        background: "transparent",
      }}
    >
      {index}
    </span>
  );
}
