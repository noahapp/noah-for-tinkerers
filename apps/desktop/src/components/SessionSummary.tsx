import { useState, useEffect } from "react";
import * as commands from "../lib/tauri-commands";
import { useSessionStore } from "../stores/sessionStore";
import { useLocale } from "../i18n";

export function SessionSummary() {
  const { t } = useLocale();
  const sessionId = useSessionStore((s) => s.sessionId);
  const isActive = useSessionStore((s) => s.isActive);
  const changes = useSessionStore((s) => s.changes);
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [prevSessionId, setPrevSessionId] = useState<string | null>(null);

  // When session transitions from active to inactive, generate summary
  useEffect(() => {
    if (!isActive && sessionId && sessionId !== prevSessionId) {
      setPrevSessionId(sessionId);
      setDismissed(false);
      setLoading(true);
      commands
        .getSessionSummary(sessionId)
        .then((s) => setSummary(s))
        .catch(() => setSummary(null))
        .finally(() => setLoading(false));
    }
    if (isActive) {
      setSummary(null);
      setDismissed(false);
      setPrevSessionId(null);
    }
  }, [isActive, sessionId, prevSessionId]);

  if (isActive || dismissed || (!loading && !summary)) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 mb-3">
      <div className="rounded-xl border border-accent-green/30 bg-accent-green/5 px-4 py-3">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="text-xs font-semibold text-accent-green uppercase tracking-wider">
            {t("sessionSummary.title")}
          </h3>
          <button
            onClick={() => setDismissed(true)}
            className="text-text-muted hover:text-text-primary text-xs cursor-pointer"
          >
            {t("sessionSummary.dismiss")}
          </button>
        </div>
        {loading ? (
          <p className="text-xs text-text-muted">{t("sessionSummary.generating")}</p>
        ) : (
          <div className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
            {summary}
          </div>
        )}
        {changes.length > 0 && (
          <p className="text-micro text-text-muted mt-2">
            {t("sessionSummary.changesMade", { count: changes.filter((c) => !c.undone).length })}
          </p>
        )}
      </div>
    </div>
  );
}
