import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";

/**
 * Returns true when the Tauri updater reports an available release.
 *
 * Used by Sidebar to render a small dot on the settings cog — the user
 * navigates to Settings to actually trigger the install (the existing
 * AboutCard in SettingsPanel has the download/relaunch flow). Lives in
 * a hook so the check is centralized and we don't double-fire.
 *
 * Re-checks every 6 hours. Silent on failure (offline, no endpoint
 * configured, etc.) — never blocks the UI or surfaces an error.
 */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const update = await check();
        if (!cancelled && update?.available) {
          setAvailable(true);
        }
      } catch {
        // Silent — offline, no endpoint, etc.
      }
    }

    run();
    const id = setInterval(run, 6 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return available;
}
