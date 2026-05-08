import type { AssistantFinding, AssistantTone } from "../lib/tauri-commands";
import { useLocale } from "../i18n";

/** Tone → value-text color. The value's color IS the tone signal — no dot,
 *  no badge, no chip. Default is `neutral` (text-primary) so non-evaluative
 *  facts like IPs and DNS servers stay calm and the one `bad` value pops. */
const toneColor: Record<AssistantTone, string> = {
  good: "var(--color-accent-green)",
  warn: "var(--color-accent-amber)",
  bad: "var(--color-accent-red)",
  neutral: "var(--color-text-primary)",
};

/**
 * Renders structured diagnostic facts as a horizontal tile row.
 *
 * Visual hierarchy (top to bottom inside each tile):
 *   1. label    — uppercase eyebrow, small, muted
 *   2. value    — large, tone-colored, hero of the tile
 *   3. hint     — small, muted, optional
 *
 * Layout: a single soft-elevation container holds N tiles separated by
 * subtle dividers. Up to 4 tiles fit in one row; 5–8 wrap to two rows of
 * four. The label is the secondary signal, the value is the hero, the
 * hint is a footnote — three weights, one container.
 */
export function FindingsGrid({ findings }: { findings: AssistantFinding[] }) {
  const { t } = useLocale();
  // Hard cap at 6. Schema enforces this server-side (maxItems: 6); the
  // slice here is a defensive safety net for legacy payloads or a
  // misbehaving model.
  const capped = findings.slice(0, 6);
  if (capped.length === 0) return null;
  // Column count by lookup. The prompt strongly steers toward 4 (one
  // tight row) or 6 (3×2 grid). 5 lands at 3 cols (3+2 with one
  // stranded cell — the lesser evil vs. a 5-col narrow row that
  // would truncate IPs).
  const cols = ({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 3, 6: 3 } as Record<number, number>)[
    capped.length
  ] ?? 3;
  return (
    <div className="px-5 pb-3">
      <span className="eyebrow mb-2.5">{t("chat.whatIChecked")}</span>
      <div className="findings-container mt-1">
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {capped.map((f, i) => {
            const isFirstInRow = i % cols === 0;
            const isFirstRow = i < cols;
            return (
              <div
                key={`${f.label}-${i}`}
                className="px-4 py-3 flex flex-col gap-1 min-w-0"
                style={{
                  borderLeft:
                    !isFirstInRow
                      ? "1px solid var(--color-surface-card-border)"
                      : undefined,
                  borderTop:
                    !isFirstRow
                      ? "1px solid var(--color-surface-card-border)"
                      : undefined,
                }}
              >
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-text-muted truncate">
                  {f.label}
                </span>
                <span
                  className="text-[22px] font-bold leading-[1.15] tabular-nums truncate"
                  style={{
                    color: toneColor[f.tone ?? "neutral"],
                    letterSpacing: "-0.02em",
                  }}
                  title={f.value}
                >
                  {f.value}
                </span>
                {f.sub && (
                  <span className="text-[11px] text-text-muted leading-snug truncate mt-0.5">
                    {f.sub}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
