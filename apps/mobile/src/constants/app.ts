import Constants from "expo-constants";

const cfg = Constants.expoConfig;

/** "0.1.0 (13)" — the marketing version with the build number, as TestFlight and the App Store show it. */
export const APP_VERSION = `${cfg?.version ?? "?"}${cfg?.ios?.buildNumber ? ` (${cfg.ios.buildNumber})` : ""}`;
