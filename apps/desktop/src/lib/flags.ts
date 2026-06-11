/**
 * Feature flags. Default OFF. Per-device override via localStorage for QA
 * (no rebuild): `localStorage.setItem("noah.flags.<key>", "1")` to enable,
 * `"0"` to force-disable. To ship a flag, flip its default below.
 */
function flag(key: string, defaultOn: boolean): boolean {
  try {
    const v = localStorage.getItem(`noah.flags.${key}`);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;
  } catch {
    // localStorage unavailable — fall through to the default.
  }
  return defaultOn;
}

export const flags = {
  /**
   * Scan-reveal onboarding + the placement-A/B paywall (OnboardingFlow).
   * Default OFF until it's mounted-and-released and the real diagnostics are
   * wired. See noah-consumer/designs/onboarding/SPEC.md.
   */
  scanRevealOnboarding: (): boolean => flag("scanRevealOnboarding", false),
};
