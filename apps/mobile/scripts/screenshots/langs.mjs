#!/usr/bin/env node
/**
 * The languages the screenshot pipeline shoots, and what each is called where.
 *
 *   node scripts/screenshots/langs.mjs [all|<code>[,<code>…]]
 *
 * prints one line per language: `<code> <App Store code> <locale>`, e.g. `uk uk uk-UA` — which the
 * shell scripts read with `while read -r code store locale`. Exits 1 on a code the app does not have.
 *
 * The list is apps/mobile/locales/languages.json (written by `bun run i18n`); the App Store code
 * and the locale come from packages/i18n/i18n.config.ts, read as text so this needs neither Bun nor
 * a TypeScript loader — frame.mjs imports `languages()` from here and stays dependency-free.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, "../..");
const CONFIG = path.resolve(MOBILE, "../../packages/i18n/i18n.config.ts");
const LIST = path.join(MOBILE, "locales", "languages.json");

/** Every language the app has, in the order `bun run i18n` lists them: { code, store, locale }. */
export function allLanguages() {
  const codes = JSON.parse(fs.readFileSync(LIST, "utf8"));
  const config = fs.readFileSync(CONFIG, "utf8");
  return codes.map((code) => {
    const line = config.split("\n").find((l) => new RegExp(`code:\\s*"${code}"`).test(l));
    const field = (name) => (line && new RegExp(`${name}:\\s*"([^"]+)"`).exec(line)?.[1]) || null;
    return { code, store: field("appStore") ?? code, locale: field("locale") ?? code };
  });
}

/** `all` (or nothing) → every language; otherwise the comma-separated codes, in the order given. */
export function languages(spec = "all") {
  const all = allLanguages();
  if (!spec || spec === "all" || spec === true) return all;
  return String(spec).split(",").map((s) => s.trim()).filter(Boolean).map((code) => {
    const hit = all.find((l) => l.code === code);
    if (!hit) throw new Error(`unknown language "${code}" — the app has ${all.map((l) => l.code).join(", ")}`);
    return hit;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const l of languages(process.argv[2])) console.log(`${l.code} ${l.store} ${l.locale}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
