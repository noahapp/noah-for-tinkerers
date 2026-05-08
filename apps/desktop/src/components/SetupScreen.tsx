import { useState, useCallback, useMemo } from "react";
import * as commands from "../lib/tauri-commands";
import { NoahIcon } from "./NoahIcon";
import { useLocale } from "../i18n";

const PROXY_URL = "https://noah-proxy.fly.dev";

interface SetupScreenProps {
  onComplete: () => void;
}

type AuthPath = "invite" | "api_key";

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const { t, tArray } = useLocale();
  const [authPath, setAuthPath] = useState<AuthPath>("invite");
  const [inviteCode, setInviteCode] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const taglines = tArray("setup.taglines");
  const tagline = useMemo(() => taglines[Math.floor(Math.random() * taglines.length)], [taglines]);

  const handleSave = useCallback(async () => {
    setError(null);
    setSaving(true);

    try {
      if (authPath === "invite") {
        const code = inviteCode.trim().toUpperCase();
        if (!code) {
          setError(t("setup.errorInviteEmpty"));
          return;
        }
        await commands.redeemInviteCode(PROXY_URL, code);
      } else {
        const key = apiKey.trim();
        if (!key) {
          setError(t("setup.errorApiKeyEmpty"));
          return;
        }
        if (!key.startsWith("sk-ant-")) {
          setError(t("setup.errorApiKeyInvalid"));
          return;
        }
        await commands.setApiKey(key);
      }
      onComplete();
    } catch (err) {
      setError(
        `Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  }, [authPath, inviteCode, apiKey, onComplete]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg-primary px-6">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <NoahIcon className="w-16 h-16 rounded-2xl mb-4" alt="Noah" />
          <h1 className="text-xl font-semibold text-text-primary">
            {t("setup.welcomeTitle")}
          </h1>
          <p className="text-sm text-text-secondary mt-2 text-center leading-relaxed">
            {tagline}
          </p>
        </div>

        {/* Auth path toggle */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              className="flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors"
              style={{
                borderColor:
                  authPath === "invite"
                    ? "rgba(99, 102, 241, 0.5)"
                    : "var(--color-border-primary)",
                backgroundColor:
                  authPath === "invite"
                    ? "var(--color-accent-blue-soft)"
                    : "transparent",
              }}
            >
              <input
                type="radio"
                name="auth-path"
                checked={authPath === "invite"}
                onChange={() => {
                  setAuthPath("invite");
                  setError(null);
                }}
                className="accent-[var(--color-accent-indigo)]"
              />
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t("setup.inviteOption")}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t("setup.inviteOptionDesc")}
                </div>
              </div>
            </label>

            <label
              className="flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors"
              style={{
                borderColor:
                  authPath === "api_key"
                    ? "rgba(99, 102, 241, 0.5)"
                    : "var(--color-border-primary)",
                backgroundColor:
                  authPath === "api_key"
                    ? "var(--color-accent-blue-soft)"
                    : "transparent",
              }}
            >
              <input
                type="radio"
                name="auth-path"
                checked={authPath === "api_key"}
                onChange={() => {
                  setAuthPath("api_key");
                  setError(null);
                }}
                className="accent-[var(--color-accent-indigo)]"
              />
              <div>
                <div className="text-sm font-medium text-text-primary">
                  {t("setup.apiKeyOption")}
                </div>
                <div className="text-[11px] text-text-muted">
                  {t("setup.apiKeyOptionDesc")}
                </div>
              </div>
            </label>
          </div>

          {/* Input field */}
          <div>
            {authPath === "invite" ? (
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                placeholder={t("setup.invitePlaceholder")}
                className="w-full px-4 py-2.5 rounded-xl bg-bg-input border border-border-primary text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors tracking-widest font-mono"
                autoFocus
              />
            ) : (
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                placeholder={t("setup.apiKeyPlaceholder")}
                className="w-full px-4 py-2.5 rounded-xl bg-bg-input border border-border-primary text-sm text-text-primary placeholder-text-muted outline-none focus:border-border-focus transition-colors"
                autoFocus
              />
            )}
            {error && (
              <p className="text-xs text-accent-red mt-1.5">{error}</p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-launch w-full py-2.5 rounded-xl text-sm font-medium cursor-pointer"
          >
            {saving
              ? authPath === "invite"
                ? t("setup.connecting")
                : t("setup.saving")
              : authPath === "invite"
                ? t("setup.connect")
                : t("setup.saveAndStart")}
          </button>

          {authPath === "api_key" && (
            <p className="text-[11px] text-text-muted text-center leading-relaxed">
              {t("setup.noKey")}{" "}
              <a
                href="https://platform.claude.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
                style={{ color: "var(--color-accent-indigo)" }}
              >
                {t("setup.getFromAnthropic")}
              </a>
              .
              <br />
              {t("setup.keyLocalOnly")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
