import Constants from "expo-constants";

const cfg = Constants.expoConfig;

/** "0.1.0" — the marketing version alone, which is what release notes are keyed by. */
export const APP_MARKETING_VERSION = cfg?.version ?? "0.0.0";

/** "0.1.0 (13)" — the marketing version with the build number, as TestFlight and the App Store show it. */
export const APP_VERSION = `${APP_MARKETING_VERSION}${cfg?.ios?.buildNumber ? ` (${cfg.ios.buildNumber})` : ""}`;

/** The privacy policy App Store Connect links to — the same page, reachable from Settings → About (Apple 5.1.1(i)). */
export const PRIVACY_POLICY_URL = "https://sashago3.github.io/kopiyka-budget/privacy.html";
