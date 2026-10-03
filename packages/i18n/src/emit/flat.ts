/**
 * Plain outputs for the things that are not the app: Info.plist strings for Expo, and flat
 * `key → text` JSON for the website, the screenshot captions and the demo data. None of them has a
 * runtime, so the checker keeps their messages to plain text (and `{name}` placeholders where a script
 * fills them in itself). ICU's quoting is undone here — `It''s` is written `It's` — because nothing
 * downstream reads ICU.
 */
import { config, outputsOf, type Output } from "../../i18n.config";
import type { Locale } from "../load";
import { parse, plainText } from "../parse";

/** Every message of the namespaces going to `output`, flat, per language. */
export function emitFlat(locales: Map<string, Locale>, output: Output): Record<string, Record<string, string>> {
  const source = locales.get(config.source)!;
  const keys = [...source.values()].filter((e) => outputsOf(e.namespace).includes(output)).map((e) => e.key).sort();
  const out: Record<string, Record<string, string>> = {};
  for (const { code } of config.languages) {
    const locale = locales.get(code)!;
    out[code] = Object.fromEntries(keys.map((k) => [k, plainText(parse(locale.get(k)?.message ?? source.get(k)!.message))]));
  }
  return out;
}

/**
 * Expo's `locales` files: `{ "ios": { key: text } }`, which prebuild writes into each
 * `<lang>.lproj/InfoPlist.strings`.
 *
 * A key that is an Info.plist key (`NSCameraUsageDescription`, `CFBundleDisplayName`) is used as it
 * is. Anything else is a string Info.plist refers to *by value* — a home-screen quick action's title —
 * and iOS looks it up under whatever Info.plist says, so app.json names it by the message's last key
 * segment (`quickActionLog`), never by its English text: Expo writes the keys of InfoPlist.strings
 * unquoted, and a key with a space in it makes the whole file unparseable.
 */
export function emitExpo(locales: Map<string, Locale>): Record<string, string> {
  const flat = emitFlat(locales, "expo");
  const files: Record<string, string> = {};
  for (const { code } of config.languages) {
    const ios: Record<string, string> = {};
    for (const [key, text] of Object.entries(flat[code]!)) {
      const last = key.split(".").pop()!;
      ios[last] = text;
    }
    files[`${code}.json`] = JSON.stringify({ ios }, null, 2) + "\n";
  }
  files["languages.json"] = JSON.stringify(config.languages.map((l) => l.code)) + "\n";
  return files;
}
