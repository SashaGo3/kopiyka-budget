/**
 * The app's language.
 *
 * Messages live in packages/i18n/locales/<lang>/<namespace>.json and are compiled by `bun run i18n`
 * into typed catalogues; this file only decides *which* language and hands out `t`.
 *
 *   t("settings.title")
 *   t("budgets.daysLeft", { count: 3 })        // a missing or misspelt argument is a type error
 *   <Trans k="shortcut.howTo" tags={{ b: (c) => <Text style={bold}>{c}</Text> }} />
 *
 * `t` is a plain function, usable from components, alerts, and lib code alike. That works because a
 * change of language does not try to re-render the app in place — with the React Compiler memoising
 * every pure call, a `dayLabel(date)` would quietly keep its old language. Instead the root layout is
 * keyed on the language (`useLanguage`), so the whole tree mounts again in the new one, and Settings
 * sends you back to where you were. The one rule that follows: never call `t` at module scope — a
 * constant computed at import time is computed once, in whatever language the app started in.
 *
 * The choice lives in `meta` under `language`: "" (or absent) follows the phone, anything else is a
 * language picked in Settings. It travels in a backup (DATA.md rule 7). Swift reads the resolved
 * language from the App Group (native/KPLocale.swift), so the watch, widgets, intents and the
 * notifications Swift posts follow the app rather than the phone.
 */
import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { getMeta, setMeta, setNumberFormat } from "@kopiyka/core";
import { createTranslator, type Segment, type Vars } from "@kopiyka/i18n";
import { catalog, LANGUAGES, SOURCE, type LanguageCode, type MessageKey, type Messages } from "@kopiyka/i18n/generated";
import { db } from "@/db";
import { deviceLocales } from "@/lib/device";
import { setNativeLanguage } from "@/lib/bridge";
import { onAfterWrite } from "@/store";

export { LANGUAGES, type LanguageCode, type MessageKey };

export const LANGUAGE_META_KEY = "language";

const translator = createTranslator({
  source: SOURCE,
  catalog,
  onMissing: __DEV__ ? (key, lang) => { if (lang !== SOURCE) console.warn(`[i18n] ${lang} has no "${key}"`); } : undefined,
});

let current: LanguageCode = SOURCE as LanguageCode;
let following = true;
const listeners = new Set<() => void>();

const known = (code: string | null | undefined): code is LanguageCode => LANGUAGES.some((l) => l.code === code);

/**
 * The first of the phone's languages that the app has. Matched on the language subtag, so "uk-UA"
 * and "uk" are both Ukrainian. iOS's per-app language (Settings → Kopiyka → Language) is the first
 * entry of this list when set, so choosing it there works too.
 */
export function deviceLanguage(): LanguageCode {
  for (const tag of deviceLocales().languages) {
    const base = tag.replace(/_/g, "-").split("-")[0]?.toLowerCase();
    if (known(base)) return base;
  }
  return SOURCE as LanguageCode;
}

function apply(next: LanguageCode) {
  current = next;
  // Money is formatted without Intl (identical in Hermes and Bun); only the separators follow the language.
  setNumberFormat(next === "en" ? { decimal: ".", grouping: " " } : { decimal: ",", grouping: " " });
  setNativeLanguage(next);
}

/** What the database says the language is: a stored choice, or the phone's. */
function resolve(): { following: boolean; lang: LanguageCode } {
  let stored: string | null = null;
  try { stored = getMeta(db, LANGUAGE_META_KEY); } catch { /* a fresh database: follow the phone */ }
  return known(stored) ? { following: false, lang: stored } : { following: true, lang: deviceLanguage() };
}

{ const r = resolve(); following = r.following; apply(r.lang); }
// A restore can carry a `language` setting (DATA.md rule 7); whichever path wrote it, take it up.
onAfterWrite(() => reloadLanguage());

export function getLanguage(): LanguageCode { return current; }
/** BCP 47 locale for Intl and the date pickers: "uk-UA", "en-GB". */
export function getLocale(): string { return LANGUAGES.find((l) => l.code === current)?.locale ?? "en-GB"; }
/** True while the app follows the phone rather than a language picked in Settings. */
export function isFollowingDevice(): boolean { return following; }

/**
 * Switch language; `null` goes back to following the phone. The root layout re-mounts in the new
 * language (see the top of this file). Also called after a restore that carried a `language`
 * setting, to make what the database now says take effect.
 */
export function setLanguage(code: LanguageCode | null): void {
  setMeta(db, LANGUAGE_META_KEY, code ?? "");
  reloadLanguage();
}

/** Re-read the stored choice — after `setLanguage`, or a restore that wrote `language` into meta. */
export function reloadLanguage(): void {
  const r = resolve();
  following = r.following;
  if (r.lang === current) return;
  apply(r.lang);
  for (const l of listeners) l();
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The current language, re-rendering when it changes. Only the root layout needs this. */
export function useLanguage(): LanguageCode {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

type VarsOf<K extends MessageKey> = Messages[K] extends undefined ? [] : [vars: Messages[K]];

/** The message `key` in the current language. Arguments are checked against the English message. */
export function t<K extends MessageKey>(key: K, ...vars: VarsOf<K>): string {
  return translator.string(current, key, vars[0] as Vars | undefined);
}

/** The same message in a given language — for text that is written into data (a seeded name). */
export function tIn<K extends MessageKey>(lang: string, key: K, ...vars: VarsOf<K>): string {
  return translator.string(lang, key, vars[0] as Vars | undefined);
}

/**
 * A message with tags in it — `Tap <b>Save</b>` — rendered through `tags`, one function per tag name.
 * Returns fragments, so it goes inside a `<Text>`; a tag with no renderer is shown as plain text.
 */
export function Trans<K extends MessageKey>({ k, vars, tags = {} }: { k: K; vars?: Messages[K]; tags?: Record<string, (children: ReactNode) => ReactNode> }) {
  const render = (parts: Segment[]): ReactNode[] => parts.map((p, i) =>
    typeof p === "string" ? <Fragment key={i}>{p}</Fragment>
      : <Fragment key={i}>{(tags[p.tag] ?? ((c: ReactNode) => c))(render(p.children))}</Fragment>);
  return <>{render(translator.parts(current, k, vars as Vars | undefined))}</>;
}
