/**
 * What the compiler reads and where each part of it goes.
 *
 * Messages live in `locales/<language>/<namespace>.json`. The file name is the first segment of every
 * key in it — `locales/en/settings.json` holds `settings.*` — so one screen's strings are one file,
 * and two people (or agents) translating two screens never touch the same file.
 *
 * A namespace is sent to the outputs listed in `outputs`; anything not listed goes to the app (`ts`).
 * Adding a place that shows text is a new output plus a line here; the message files do not change.
 */
export interface Language {
  code: string;
  /** In its own language, so the picker is readable by someone who does not read English. */
  name: string;
  english: string;
  /** BCP 47 tag for dates and numbers ("uk-UA"), and the App Store / website language code. */
  locale: string;
  appStore: string;
}

export type Output = "ts" | "swift" | "android" | "expo" | "site" | "store" | "demo";

export const config = {
  source: "en",
  languages: [
    { code: "en", name: "English", english: "English", locale: "en-GB", appStore: "en-US" },
    { code: "uk", name: "Українська", english: "Ukrainian", locale: "uk-UA", appStore: "uk" },
  ] satisfies Language[],
  /** Namespaces whose messages are not for the React Native app. */
  outputs: {
    native: ["swift", "android"],   // the watch, complications, widgets, App Intents, notifications posted by Swift
    preset: ["ts", "swift"],        // ready-made category names: core, and Swift reading the database itself (KPPreset)
    system: ["expo"],               // Info.plist: permission prompts, the display name, the home-screen quick action
    site: ["site"],                 // kopiyka.dev
    store: ["store"],               // screenshot captions and the App Store listing
    demo: ["demo"],                 // the demo data the screenshots are taken over
  } as Record<string, Output[]>,
};

export function outputsOf(namespace: string): Output[] {
  return config.outputs[namespace] ?? ["ts"];
}
