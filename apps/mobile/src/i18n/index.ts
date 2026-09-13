/**
 * The app's language.
 *
 * Keys are the English sentence itself, not an invented identifier. That is deliberate: it keeps the
 * code readable (`t("Add a note")` says what will be on screen), it makes an untranslated string
 * degrade into correct English rather than into `settings.note.placeholder`, and it means a new
 * string works everywhere the moment it is written. The cost is that editing the English wording
 * orphans its translations — `bun test` catches that, since `i18n.test.ts` compares every catalogue
 * against the keys actually used in the source.
 *
 * Placeholders are `{name}` and are filled from the second argument. Plurals go through `tn`, which
 * takes the three forms Slavic languages need; English and the Romance languages use two of them.
 *
 * The language is chosen once from the phone (`resolveDeviceLanguage`) and then lives in `meta` like
 * every other preference, so it survives a reinstall and travels in a backup. Components read it
 * through `useT()`, which re-renders them when it changes — that is why switching language in
 * Settings redraws the app instead of waiting for the next screen.
 */
import { useSyncExternalStore } from "react";
import { getMeta, setMeta } from "@kopiyka/core";
import { db } from "@/db";
import { deviceLocales } from "@/lib/device";
import { uk } from "./uk";
import { pl } from "./pl";
import { es } from "./es";
import { pt } from "./pt";

export type Language = "en" | "uk" | "pl" | "es" | "pt";

/** Offered in Settings, each named in its own language — a list nobody has to read English to use. */
export const LANGUAGES: { code: Language; name: string; english: string }[] = [
  { code: "en", name: "English", english: "English" },
  { code: "uk", name: "Українська", english: "Ukrainian" },
  { code: "pl", name: "Polski", english: "Polish" },
  { code: "es", name: "Español", english: "Spanish" },
  { code: "pt", name: "Português", english: "Portuguese" },
];

export type Catalog = Record<string, string | string[]>;

const CATALOGS: Record<Language, Catalog | null> = { en: null, uk, pl, es, pt };

const META_KEY = "language";
/** Stored when the user picks a language by hand; "" means "keep following the phone". */
const META_AUTO = "";

let current: Language = "en";
let followingDevice = true;
const listeners = new Set<() => void>();

/**
 * The first language in the phone's list that Kopiyka speaks. Matched on the language subtag, so
 * "pt-BR" and "pt-PT" both land on Portuguese and "es-419" on Spanish; English is the fallback and
 * also what a phone set to a language nothing here matches gets.
 */
export function resolveDeviceLanguage(): Language {
  const known = new Set(LANGUAGES.map((l) => l.code));
  for (const tag of deviceLocales().languages) {
    const base = tag.replace(/_/g, "-").split("-")[0]?.toLowerCase();
    if (base && known.has(base as Language)) return base as Language;
  }
  return "en";
}

/** Read the stored choice (or the phone's) and make it current. Called once, before the first render. */
export function initLanguage(): Language {
  const stored = getMeta(db, META_KEY);
  followingDevice = !stored || stored === META_AUTO;
  current = followingDevice ? resolveDeviceLanguage() : normalize(stored);
  return current;
}

function normalize(code: string | null): Language {
  return LANGUAGES.some((l) => l.code === code) ? (code as Language) : "en";
}

export function getLanguage(): Language { return current; }

/** True while the app is following the phone's language rather than a choice made in Settings. */
export function isFollowingDevice(): boolean { return followingDevice; }

/**
 * Switch language. `null` goes back to following the phone. Everything showing text re-renders,
 * because every component that calls `useT` is subscribed here.
 */
export function setLanguage(code: Language | null): void {
  const next = code ?? resolveDeviceLanguage();
  followingDevice = code === null;
  setMeta(db, META_KEY, code ?? META_AUTO);
  if (next === current) { for (const l of listeners) l(); return; }
  current = next;
  for (const l of listeners) l();
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** Translate `key` into the current language, filling `{placeholders}` from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = CATALOGS[current]?.[key];
  const translated = typeof entry === "string" && entry ? entry : key;
  return vars ? fill(translated, vars) : translated;
}

function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/**
 * Plural forms. `key` is the English singular, and the catalogue holds the forms as an array in the
 * order the language needs: two for English, Spanish and Portuguese (one / other), three for
 * Ukrainian and Polish (one / few / many). `{n}` is filled in for you.
 *
 * English has no catalogue of its own, so the fallback builds both forms from `key` and `other`.
 */
export function tn(key: string, other: string, n: number, vars?: Record<string, string | number>): string {
  const forms = CATALOGS[current]?.[key];
  const all = { ...vars, n };
  if (Array.isArray(forms) && forms.length) return fill(forms[pluralIndex(current, n, forms.length)] ?? forms[0]!, all);
  return fill(n === 1 ? key : other, all);
}

/**
 * Which form of `forms` a count takes. The Slavic rule is the Unicode CLDR one for Ukrainian and
 * Polish: 1 (but not 11) is "one"; 2–4 (but not 12–14) is "few"; everything else is "many".
 */
function pluralIndex(lang: Language, n: number, count: number): number {
  if (count < 3 || (lang !== "uk" && lang !== "pl")) return n === 1 ? 0 : count - 1;
  const abs = Math.abs(n) % 100, last = abs % 10;
  if (last === 1 && abs !== 11) return 0;
  if (last >= 2 && last <= 4 && (abs < 12 || abs > 14)) return 1;
  return 2;
}

/**
 * `t` for components. Identical to the bare `t`, except that calling it subscribes the component to
 * language changes, so Settings can switch the whole app without a relaunch.
 */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return t;
}

/** `tn` for components, subscribed the same way. */
export function useTn(): typeof tn {
  useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return tn;
}

/** Every catalogue, for the test that checks them against the strings the app actually uses. */
export const ALL_CATALOGS = CATALOGS;
