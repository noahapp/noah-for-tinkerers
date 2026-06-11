import { useCallback, useMemo } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BatteryLow,
  Cloud,
  Gauge,
  HardDrive,
  MessageCircle,
  Mic,
  Wifi,
} from "lucide-react";
import { NoahIcon } from "./NoahIcon";
import { useLocale } from "../i18n";

interface TilePickerScreenProps {
  onComplete: () => void;
}

interface Tile {
  id: string;
  Icon: LucideIcon;
  titleKey: string;
  descKey: string;
  hintKey: string;
}

// Tiles tuned for the ICP: knowledge worker whose Mac/PC is their primary
// income tool. Each is a workday-breaker that Noah's actual tool set can
// diagnose + fix. Matches the website's eight tiles 1:1 (see
// onnoah.app/public/previews.jsx ISSUES) — keep them in sync.
const TILES: readonly Tile[] = [
  { id: "slow",    Icon: Gauge,         titleKey: "onboarding.tile.slow.title",    descKey: "onboarding.tile.slow.desc",    hintKey: "onboarding.tile.slow.hint" },
  { id: "wifi",    Icon: Wifi,          titleKey: "onboarding.tile.wifi.title",    descKey: "onboarding.tile.wifi.desc",    hintKey: "onboarding.tile.wifi.hint" },
  { id: "crash",   Icon: AlertTriangle, titleKey: "onboarding.tile.crash.title",   descKey: "onboarding.tile.crash.desc",   hintKey: "onboarding.tile.crash.hint" },
  { id: "storage", Icon: HardDrive,     titleKey: "onboarding.tile.storage.title", descKey: "onboarding.tile.storage.desc", hintKey: "onboarding.tile.storage.hint" },
  { id: "battery", Icon: BatteryLow,    titleKey: "onboarding.tile.battery.title", descKey: "onboarding.tile.battery.desc", hintKey: "onboarding.tile.battery.hint" },
  { id: "av",      Icon: Mic,           titleKey: "onboarding.tile.av.title",      descKey: "onboarding.tile.av.desc",      hintKey: "onboarding.tile.av.hint" },
  { id: "sync",    Icon: Cloud,         titleKey: "onboarding.tile.sync.title",    descKey: "onboarding.tile.sync.desc",    hintKey: "onboarding.tile.sync.hint" },
  { id: "other",   Icon: MessageCircle, titleKey: "onboarding.tile.other.title",   descKey: "onboarding.tile.other.desc",   hintKey: "onboarding.tile.other.hint" },
];

/**
 * First-run entry (BYOK). Shows a grid of eight common Mac problems
 * ("Pick One"). Picking a concrete tile goes STRAIGHT into the diagnosis —
 * the tile IS the statement of intent, so we seed it as the first chat turn
 * and let Noah ask for any specifics conversationally. The "other" tile,
 * which has no preset problem, opens the chat empty so the user can describe
 * it there. No sign-in required.
 */
export function TilePickerScreen({ onComplete }: TilePickerScreenProps) {
  const { t } = useLocale();

  const handlePick = useCallback(
    (tile: Tile) => {
      // "Other" has no preset problem — open the chat empty and let the
      // user describe it there (Noah's empty state prompts "tell me
      // what's wrong"). No forced textarea.
      if (tile.id === "other") {
        onComplete();
        return;
      }
      // Concrete problem → diagnose immediately. Seed the tile's title as
      // the first turn; ChatPanel auto-sends it on the first fresh session.
      const message = composeSeedMessage(tile.id, t(tile.titleKey), "");
      try {
        localStorage.setItem(
          "noah.pendingSeed",
          JSON.stringify({ message, expiresAt: Date.now() + 60 * 60 * 1000 }),
        );
      } catch {
        // localStorage disabled — user can type in chat instead, fine.
      }
      onComplete();
    },
    [onComplete, t],
  );

  return <PickStage onPick={handlePick} />;
}

// ── Pick stage ────────────────────────────────────────────────────────────

function PickStage({
  onPick,
}: {
  onPick: (tile: Tile) => void;
}) {
  const { t, tArray } = useLocale();
  const taglines = tArray("setup.taglines");
  const tagline = useMemo(
    () => taglines[Math.floor(Math.random() * taglines.length)],
    [taglines],
  );

  return (
    <div
      // Layered scroll: outer fixes the aurora wash + drag region to
      // the viewport, inner scrolls so the sign-in link is reachable
      // on shorter windows (≤ ~720px tall) instead of being silently
      // clipped below the fold. At the default window size everything
      // still fits without a scrollbar.
      className="relative h-screen overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse 80% 55% at 50% 0%, rgba(99, 102, 241, 0.16) 0%, transparent 70%), " +
          "radial-gradient(ellipse 50% 45% at 90% 100%, rgba(139, 92, 246, 0.08) 0%, transparent 65%), " +
          "var(--color-bg-primary)",
      }}
    >
      {/* Window drag region — MainTitleBar (which normally owns this)
          doesn't render on unauthenticated screens, so without this
          the window becomes unmovable on macOS overlay title bars.
          Pinned to the outer (viewport-anchored) so scrolling content
          doesn't move it out of the macOS overlay region. */}
      <div
        data-tauri-drag-region=""
        className="absolute top-0 left-0 right-0 h-9 z-20"
      />

      {/* Noise / subtle vignette to avoid banding on the gradient */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none opacity-[0.35]"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, transparent 40%, rgba(0,0,0,0.25) 100%)",
        }}
      />

      {/* Scrollable content layer — flex-center so it stays centered
          when it fits, scrolls naturally when it doesn't. */}
      <div className="absolute inset-0 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-6 py-8">
          <div className="relative w-full max-w-[660px]">
            <div className="flex flex-col items-center mb-8">
              <div className="relative mb-4">
                {/* Aurora-tinted glow behind the logo — same indigo as the
                    page wash, keeps Noah's mark anchored to the launch
                    identity rather than floating in legacy teal. */}
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-2xl blur-2xl opacity-70"
                  style={{ background: "rgba(99, 102, 241, 0.32)" }}
                />
                <NoahIcon
                  className="relative w-20 h-20 rounded-2xl shadow-xl"
                  alt="Noah"
                />
              </div>
              <span className="eyebrow mb-3">{t("onboarding.eyebrow")}</span>
              <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
                {t("onboarding.greeting")}
              </h1>
              <p className="text-sm text-text-muted mt-2 text-center leading-relaxed max-w-md">
                {t("onboarding.subgreeting")}
              </p>
              <p className="text-xs text-text-muted mt-3">{tagline}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {TILES.map((tile) => (
                <button
                  key={tile.id}
                  onClick={() => onPick(tile)}
                  className="card-soft interactive aurora-focus group relative flex items-start gap-3 text-left px-4 py-4 cursor-pointer transition-all duration-200"
                >
                  <span
                    className="flex items-center justify-center w-11 h-11 rounded-lg shrink-0 transition-colors"
                    style={{
                      background: "var(--color-accent-blue-soft)",
                      color: "var(--color-accent-indigo)",
                      border: "1px solid var(--color-accent-border)",
                    }}
                    aria-hidden
                  >
                    <tile.Icon size={19} strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="text-sm font-medium text-text-primary leading-snug">
                      {t(tile.titleKey)}
                    </div>
                    <div className="text-[11.5px] text-text-muted leading-relaxed mt-1">
                      {t(tile.descKey)}
                    </div>
                  </div>
                </button>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Seed message composition ──────────────────────────────────────────────

/**
 * Combine the tile category and the user's clarifier into a single
 * message that reads naturally as the first chat turn. For the "other"
 * tile we let the user's text stand on its own.
 */
function composeSeedMessage(
  tileId: string,
  categoryTitle: string,
  clarifier: string,
): string {
  const trimmed = clarifier.trim();
  if (!trimmed) return categoryTitle;
  if (tileId === "other") return trimmed;
  return `${categoryTitle}. ${trimmed}`;
}
