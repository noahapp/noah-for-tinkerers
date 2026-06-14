import { useState, useEffect, useCallback } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useTheme, type ThemePreference } from "../hooks/useTheme";
import * as commands from "../lib/tauri-commands";
import { useLocale } from "../i18n";

/**
 * BYOK Settings — single stacked column at 760px:
 *   1. API key — the user's own Anthropic API key (BYOK).
 *   2. Appearance — segmented control with a sliding aurora thumb.
 *   3. Privacy — anonymous usage statistics opt-out.
 *   4. Help & feedback — quiet action rows.
 *
 * Aurora is reserved strictly for the commit moment.
 */
export function SettingsPanel() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    commands.getAppVersion().then(setVersion).catch(() => {});
  }, []);

  const { preference: themePref, setTheme } = useTheme();
  const { t } = useLocale();

  const handleReportProblem = useCallback(async () => {
    const subject = encodeURIComponent("Noah feedback");
    const body = encodeURIComponent(
      `\n\n\n---\nNoah v${version || "?"} — please describe the issue above this line.`,
    );
    await openUrl(`mailto:support@onnoah.app?subject=${subject}&body=${body}`);
  }, [version]);

  const handleOpenHelp = useCallback(async () => {
    await openUrl("https://help.onnoah.app");
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-bg-primary">
      <div className="mx-auto w-full max-w-[760px] px-6 py-10 pb-16">
        {/* Page header */}
        <header className="mb-7">
          <SectionEyebrow>{t("settings.eyebrow")}</SectionEyebrow>
          <h1 className="text-display font-bold tracking-[-0.028em] text-text-primary mt-2 mb-1">
            {t("settings.title")}
          </h1>
          <p className="text-caption text-text-secondary leading-[1.55]">
            {t("settings.subtitle")}
          </p>
        </header>

        <div className="space-y-[18px]">
          {/* ── API key card ─────────────────────────────────────── */}
          <ApiKeySection t={t} />

          {/* ── Appearance card ──────────────────────────────────── */}
          <SettingsCard>
            <div className="px-[22px] py-5">
              <div className="flex items-center justify-between mb-3">
                <SectionEyebrow>{t("settings.appearance")}</SectionEyebrow>
                <span className="text-micro text-text-muted whitespace-nowrap">
                  {themePref === "system"
                    ? t("settings.followsOSShort")
                    : themePref === "light"
                      ? t("settings.alwaysLightShort")
                      : t("settings.alwaysDarkShort")}
                </span>
              </div>
              <AppearanceToggle value={themePref} onChange={setTheme} t={t} />
            </div>
          </SettingsCard>

          {/* ── Privacy card ─────────────────────────────────────── */}
          <PrivacySection t={t} />

          {/* ── Help & feedback card ─────────────────────────────── */}
          <SettingsCard>
            <div className="px-[14px] pt-[18px] pb-3">
              <div className="px-2 pb-2">
                <SectionEyebrow>{t("settings.helpFeedback")}</SectionEyebrow>
              </div>
              <ActionLink
                onClick={handleReportProblem}
                icon={<MailIcon />}
                label={t("settings.contactSupport")}
              />
              <ActionLink
                onClick={handleOpenHelp}
                icon={<HelpIcon />}
                label={t("settings.helpAndFaq")}
              />
            </div>
          </SettingsCard>

          {/* ── About / Update ───────────────────────────────────── */}
          <AboutCard version={version} t={t} />
        </div>
      </div>
    </div>
  );
}

// ── API key (BYOK) card ──────────────────────────────────────────────
//
// TODO(byok-ux): let users set the API key from Settings with good
// ergonomics, not by hand-editing api_key.txt. This is the minimal
// in-app entry point — paste a key, save, done.
function ApiKeySection({ t }: { t: Tt }) {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    commands.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaved(false);
    const trimmed = value.trim();
    if (!trimmed) {
      setError(t("settings.apiKeyEmpty"));
      return;
    }
    if (!trimmed.startsWith("sk-ant-")) {
      setError(t("settings.apiKeyInvalid"));
      return;
    }
    setSaving(true);
    try {
      await commands.setApiKey(trimmed);
      setHasKey(true);
      setValue("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [value, t]);

  return (
    <SettingsCard>
      <div className="px-[22px] py-5">
        <div className="flex items-center justify-between mb-3">
          <SectionEyebrow>{t("settings.apiKey")}</SectionEyebrow>
          <span className="text-micro text-text-muted whitespace-nowrap">
            {hasKey
              ? t("settings.apiKeySet")
              : t("settings.apiKeyNotSet")}
          </span>
        </div>
        <p className="text-caption text-text-muted leading-relaxed mb-3">
          {t("settings.apiKeyDesc")}
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder={t("settings.apiKeyPlaceholder")}
          className="w-full px-4 py-2.5 rounded-xl bg-bg-input border border-border-primary text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors"
        />
        {error && <p className="text-xs text-accent-red mt-2">{error}</p>}
        {saved && (
          <p className="text-xs text-accent-green mt-2">
            {t("settings.apiKeySaved")}
          </p>
        )}
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-commit mt-3 px-3.5 py-2 rounded-input text-caption font-semibold cursor-pointer disabled:opacity-50"
        >
          {saving ? t("settings.apiKeySaving") : t("settings.apiKeySave")}
        </button>
      </div>
    </SettingsCard>
  );
}

// ── Privacy card — anonymous usage statistics opt-out (default ON) ────
function PrivacySection({ t }: { t: Tt }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    commands.getByokTelemetryEnabled().then(setEnabled).catch(() => setEnabled(true));
  }, []);

  const toggle = useCallback(async () => {
    const next = !(enabled ?? true);
    setEnabled(next);
    try {
      await commands.setByokTelemetryEnabled(next);
    } catch {
      // Revert on failure so the toggle reflects persisted state.
      setEnabled(!next);
    }
  }, [enabled]);

  const on = enabled ?? true;

  return (
    <SettingsCard>
      <div className="px-[22px] py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <SectionEyebrow>{t("settings.privacy")}</SectionEyebrow>
            <p className="text-caption font-medium text-text-primary mt-2">
              {t("settings.shareUsage")}
            </p>
            <p className="text-caption text-text-muted leading-relaxed mt-1">
              {t("settings.shareUsageDesc")}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={on}
            aria-label={t("settings.shareUsage")}
            onClick={toggle}
            className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors cursor-pointer"
            style={{
              background: on
                ? "var(--color-accent-indigo)"
                : "var(--color-bg-tertiary)",
            }}
          >
            <span
              className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
              style={{ transform: on ? "translateX(22px)" : "translateX(2px)" }}
            />
          </button>
        </div>
      </div>
    </SettingsCard>
  );
}

// ── About + Update card ──────────────────────────────────────────────
//
// Combined "current version + check/install update" surface. Replaces
// the bare footer line so the user always has a self-serve path to
// upgrade — the dismissible top banner alone wasn't enough (a user who
// clicks 'Later' once has no obvious second chance). Auto-checks on
// mount; the explicit button is for retries / on-demand checks.
type UpdateState = "idle" | "checking" | "available" | "downloading" | "installing" | "error";
function AboutCard({ version, t }: { version: string; t: Tt }) {
  const [state, setState] = useState<UpdateState>("idle");
  const [newVersion, setNewVersion] = useState<string | null>(null);

  const runCheck = useCallback(async () => {
    setState("checking");
    try {
      const update = await check();
      if (update?.available) {
        setNewVersion(update.version);
        setState("available");
      } else {
        setNewVersion(null);
        setState("idle");
      }
    } catch (err) {
      console.warn("[update] check failed:", err);
      setState("error");
    }
  }, []);

  const runInstall = useCallback(async () => {
    setState("downloading");
    try {
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall((evt) => {
          if (evt.event === "Finished") setState("installing");
        });
        // relaunch usually never returns — wrap defensively anyway
        await relaunch();
      }
    } catch (err) {
      console.warn("[update] install failed:", err);
      setState("error");
    }
  }, []);

  // Auto-check on mount. Cheap (single network call), silent on
  // failure (the user can still trigger a manual check).
  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const statusLine = ((): string => {
    if (state === "available" && newVersion) {
      return t("settings.newVersion", { version: newVersion });
    }
    if (state === "checking") return t("settings.checking");
    if (state === "error") return t("settings.updateError");
    return t("settings.upToDate");
  })();

  const statusColor =
    state === "available"
      ? "var(--color-accent-indigo)"
      : state === "error"
        ? "var(--color-accent-red)"
        : "var(--color-text-muted)";

  return (
    <SettingsCard>
      <div className="px-[22px] py-5">
        <div className="flex items-center justify-between mb-3">
          <SectionEyebrow>{t("settings.about")}</SectionEyebrow>
          <span
            className="text-micro whitespace-nowrap"
            style={{ color: statusColor }}
          >
            {statusLine}
          </span>
        </div>
        <div className="flex items-center gap-3.5">
          <NoahMark size={28} />
          <div className="flex-1 min-w-0">
            <div className="text-body font-semibold text-text-primary leading-tight">
              Noah
            </div>
            <div className="text-caption text-text-muted mt-0.5">
              {t("settings.versionLine", { version: version || "…" })}
            </div>
          </div>
          {state === "available" && newVersion ? (
            <button
              onClick={runInstall}
              className="btn-commit px-3.5 py-2 rounded-input text-caption font-semibold cursor-pointer whitespace-nowrap"
            >
              {t("settings.updateNow", { version: newVersion })}
            </button>
          ) : state === "downloading" || state === "installing" ? (
            <span className="px-3.5 py-2 text-caption text-text-muted whitespace-nowrap">
              {state === "downloading"
                ? t("settings.downloading")
                : t("settings.installing")}
            </span>
          ) : (
            <button
              onClick={runCheck}
              disabled={state === "checking"}
              className="px-3 py-1.5 rounded-lg bg-bg-tertiary text-caption text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
            >
              {state === "checking"
                ? t("settings.checking")
                : t("settings.checkForUpdates")}
            </button>
          )}
        </div>
      </div>
    </SettingsCard>
  );
}

// ── Card primitive ────────────────────────────────────────────────────
function SettingsCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="rounded-2xl bg-bg-secondary overflow-hidden"
      style={{
        border: "1px solid var(--color-surface-card-border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {children}
    </section>
  );
}

// ── Section eyebrow with aurora hairline ─────────────────────────────
function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-[7px] text-micro font-bold uppercase tracking-[0.14em] text-text-muted whitespace-nowrap">
      <span
        className="block w-3 h-[2px] rounded-[1px]"
        style={{ background: "var(--aurora)" }}
      />
      {children}
    </span>
  );
}

// ── Appearance segmented control with sliding aurora thumb ───────────
type Tt = (key: string, vars?: Record<string, string | number>) => string;
function AppearanceToggle({
  value,
  onChange,
  t,
}: {
  value: ThemePreference;
  onChange: (v: ThemePreference) => void;
  t: Tt;
}) {
  const opts: { id: ThemePreference; label: string; icon: React.ReactNode }[] = [
    { id: "system", label: t("settings.system"), icon: <SystemIcon /> },
    { id: "light", label: t("settings.light"), icon: <SunIcon /> },
    { id: "dark", label: t("settings.dark"), icon: <MoonIcon /> },
  ];
  const idx = Math.max(
    0,
    opts.findIndex((o) => o.id === value),
  );
  return (
    <div
      className="relative grid grid-cols-3 p-1 rounded-xl bg-bg-primary"
      style={{ border: "1px solid var(--color-surface-card-border)" }}
    >
      {/* sliding thumb — easing matches Apple's "sub-100ms feel" curve */}
      <div
        className="absolute top-1 bottom-1 rounded-input pointer-events-none"
        style={{
          left: `calc(${(idx / 3) * 100}% + 4px)`,
          width: `calc(${100 / 3}% - 8px)`,
          background: "var(--color-bg-secondary)",
          border: "1px solid rgba(99, 102, 241, 0.35)",
          boxShadow:
            "0 1px 2px rgba(15,23,41,0.06), 0 0 0 3px rgba(99, 102, 241, 0.08)",
          transition: "left 220ms cubic-bezier(0.32, 0.72, 0, 1)",
        }}
      />
      {opts.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`relative inline-flex items-center justify-center gap-[7px] py-2 px-1.5 rounded-input text-caption cursor-pointer transition-colors ${
              active
                ? "font-semibold"
                : "font-medium text-text-muted hover:text-text-secondary"
            }`}
            style={
              active
                ? { color: "var(--color-accent-indigo)" }
                : undefined
            }
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Quiet action row — icon-in-aurora-square + label + chevron ───────
function ActionLink({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-3.5 py-3 rounded-input text-left cursor-pointer transition-colors hover:bg-bg-primary group"
    >
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0"
        style={{
          background: "var(--color-accent-blue-soft)",
          color: "var(--color-accent-indigo)",
        }}
      >
        {icon}
      </span>
      <span className="flex-1 text-caption font-medium text-text-primary tracking-[-0.005em]">
        {label}
      </span>
      <ChevronIcon className="text-text-muted group-hover:text-text-secondary transition-colors" />
    </button>
  );
}

// ── Icons (small, inline, no external deps) ──────────────────────────
function SystemIcon() {
  // "auto" / monitor — represents OS-derived theme
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function HelpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
function NoahMark({ size = 14 }: { size?: number }) {
  // Aurora bead — bigger when used in About row (sits next to text),
  // smaller for an inline mention.
  const radius = Math.max(4, Math.round(size * 0.3));
  return (
    <span
      className="inline-block flex-shrink-0"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: "var(--aurora)",
        boxShadow: "0 0 0 1px rgba(99, 102, 241, 0.15)",
      }}
    />
  );
}
