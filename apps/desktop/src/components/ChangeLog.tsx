import { useCallback } from "react";
import { useSessionStore } from "../stores/sessionStore";
import * as commands from "../lib/tauri-commands";
import type { ChangeEntry } from "../lib/tauri-commands";
import { useLocale } from "../i18n";

function ChangeItem({ change }: { change: ChangeEntry }) {
  const { t } = useLocale();
  const markChangeUndone = useSessionStore((s) => s.markChangeUndone);

  const handleUndo = useCallback(async () => {
    if (change.undone) return;
    try {
      await commands.undoChange(change.id);
      markChangeUndone(change.id);
    } catch (err) {
      console.error("Failed to undo change:", err);
    }
  }, [change.id, change.undone, markChangeUndone]);

  const time = new Date(change.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      className={`
        px-4 py-3 border-b border-border-primary last:border-b-0
        transition-opacity
        ${change.undone ? "opacity-50" : ""}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="px-1.5 py-0.5 rounded bg-accent-purple/15 text-accent-purple text-micro font-mono">
              {change.tool_name}
            </span>
            <span className="text-micro text-text-muted">{time}</span>
          </div>
          <p
            className={`text-xs text-text-secondary leading-relaxed ${
              change.undone ? "line-through" : ""
            }`}
          >
            {change.description}
          </p>
        </div>
        <button
          onClick={handleUndo}
          disabled={change.undone}
          title={change.undone ? t("changeLog.tooltipUndone") : t("changeLog.tooltipUndo")}
          className={`
            flex-shrink-0 px-2 py-1 rounded-md text-micro font-medium
            transition-colors cursor-pointer
            ${
              change.undone
                ? "text-text-muted cursor-not-allowed"
                : "text-accent-amber hover:bg-accent-amber/10"
            }
          `}
        >
          {change.undone ? t("changeLog.undone") : t("changeLog.undo")}
        </button>
      </div>
    </div>
  );
}

export function ChangeLog() {
  const { t } = useLocale();
  const changeLogOpen = useSessionStore((s) => s.changeLogOpen);
  const setChangeLogOpen = useSessionStore((s) => s.setChangeLogOpen);
  const changes = useSessionStore((s) => s.changes);

  if (!changeLogOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/20"
        onClick={() => setChangeLogOpen(false)}
      />

      {/* Slide-out panel */}
      <div className="fixed top-0 right-0 bottom-0 z-40 w-80 bg-bg-secondary border-l border-border-primary shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-primary">
          <h2 className="text-sm font-semibold text-text-primary">
            {t("changeLog.title")}
          </h2>
          <button
            onClick={() => setChangeLogOpen(false)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M3 3L11 11M11 3L3 11"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Changes list */}
        <div className="flex-1 overflow-y-auto">
          {changes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-text-muted px-4">
              <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="mb-3 opacity-50"
              >
                <path
                  d="M8 10H24M8 16H20M8 22H16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <p className="text-xs text-center">
                {t("changeLog.emptyTitle")}
                <br />
                {t("changeLog.emptySubtitle")}
              </p>
            </div>
          ) : (
            <div>
              {/* Show most recent first */}
              {[...changes].reverse().map((change) => (
                <ChangeItem key={change.id} change={change} />
              ))}
            </div>
          )}
        </div>

        {/* Footer summary */}
        {changes.length > 0 && (
          <div className="px-4 py-2.5 border-t border-border-primary">
            <p className="text-micro text-text-muted">
              {t("changeLog.totalActions", { count: changes.length })}
              {" \u00B7 "}
              {t("changeLog.totalUndone", { count: changes.filter((c) => c.undone).length })}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
