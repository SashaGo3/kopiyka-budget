#!/usr/bin/env bun
/**
 * bun run i18n            check every message, then regenerate every output
 * bun run i18n --check    check, and fail if any generated file is out of date (what `bun test` runs)
 * bun run i18n --partial  as above, but a message that fails is left out instead of stopping everything
 *                         (and reported) — while one screen is translated, the rest keep compiling
 * bun run i18n --watch    regenerate on every save — with Metro running, the app picks the change up
 *                         through Fast Refresh, so a translation can be tuned on a live screen
 *
 * Outputs (all committed, so a build never depends on running this first):
 *   ts       packages/i18n/generated/                         the app and core
 *   swift    apps/mobile/native/Localizable.xcstrings, KPStrings.swift
 *   android  apps/mobile/locales/android/values*\/strings.xml
 *   expo     apps/mobile/locales/<lang>.json                  Info.plist via `locales` in app config
 *   site     site/i18n/<lang>.json
 *   store    apps/mobile/screenshots/i18n/<lang>.json, screenshots/metadata/<store lang>/*.txt
 *   demo     apps/mobile/scripts/screenshots/i18n/<lang>.json
 */
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { config } from "../i18n.config";
import { check } from "./check";
import { emitAndroid } from "./emit/android";
import { emitExpo, emitFlat } from "./emit/flat";
import { emitSwift } from "./emit/swift";
import { emitTs } from "./emit/ts";
import { loadAll, LOCALES, ROOT } from "./load";

const REPO = join(ROOT, "..", "..");
const MOBILE = join(REPO, "apps", "mobile");

/**
 * Every generated file, path → contents. Throws when the messages do not pass the checker — unless
 * `partial`, which leaves the failing keys out of every output and reports them instead: for working
 * on one screen while another is half-translated, never for a build.
 */
export function build(opts: { partial?: boolean } = {}): Map<string, string> {
  // --partial: a file that does not even load is skipped (its keys then show as missing elsewhere).
  const locales = loadAll(undefined, opts.partial ? (e) => console.error(`skipped — ${e.message}`) : undefined);
  const problems = check(locales);
  const errors = problems.filter((p) => p.level === "error");
  if (errors.length) {
    const lines = errors.map((p) => `  ${p.file ?? p.lang}  ${p.key}: ${p.message}`);
    const report = `${errors.length} problem${errors.length === 1 ? "" : "s"} in the messages:\n${lines.join("\n")}`;
    if (!opts.partial || errors.some((p) => p.key === "*")) throw new Error(report);
    console.error(`${report}\n(--partial: those keys are left out of the generated files)`);
    const bad = new Set(errors.map((p) => p.key));
    for (const locale of locales.values()) for (const k of bad) locale.delete(k);
  }
  const files = new Map<string, string>();
  const put = (dir: string, map: Record<string, string>) => { for (const [f, c] of Object.entries(map)) files.set(join(dir, f), c); };
  const json = (o: unknown) => JSON.stringify(o, null, 2) + "\n";

  put(join(ROOT, "generated"), emitTs(locales));
  put(join(MOBILE, "native"), emitSwift(locales));
  put(join(MOBILE, "locales", "android"), emitAndroid(locales));
  put(join(MOBILE, "locales"), emitExpo(locales));
  for (const [lang, m] of Object.entries(emitFlat(locales, "site"))) files.set(join(REPO, "site", "i18n", `${lang}.json`), json(m));
  for (const [lang, m] of Object.entries(emitFlat(locales, "demo"))) files.set(join(MOBILE, "scripts", "screenshots", "i18n", `${lang}.json`), json(m));
  for (const [lang, m] of Object.entries(emitFlat(locales, "store"))) {
    files.set(join(MOBILE, "screenshots", "i18n", `${lang}.json`), json(m));
    // The App Store listing as App Store Connect wants it: one text file per field, per store language.
    const store = config.languages.find((l) => l.code === lang)!.appStore;
    for (const [key, text] of Object.entries(m)) {
      if (!key.startsWith("store.listing.")) continue;
      files.set(join(MOBILE, "screenshots", "metadata", store, `${key.slice("store.listing.".length).replace(/\./g, "_")}.txt`), text + "\n");
    }
  }
  return files;
}

function run(mode: "write" | "check", partial = false): boolean {
  let files: Map<string, string>;
  try { files = build({ partial }); }
  catch (e) { console.error((e as Error).message); return false; }
  const stale: string[] = [];
  for (const [path, contents] of files) {
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === contents) continue;
    stale.push(relative(REPO, path));
    if (mode === "write") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents); }
  }
  if (mode === "check" && stale.length) { console.error(`Out of date — run \`bun run i18n\`:\n  ${stale.join("\n  ")}`); return false; }
  if (mode === "write") console.log(stale.length ? `Updated ${stale.length} file${stale.length === 1 ? "" : "s"}:\n  ${stale.join("\n  ")}` : "Up to date.");
  return true;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) process.exit(run("check") ? 0 : 1);
  const partial = args.includes("--partial");
  const ok = run("write", partial);
  if (!args.includes("--watch")) process.exit(ok ? 0 : 1);
  let timer: ReturnType<typeof setTimeout> | null = null;
  watch(LOCALES, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { console.log(`— ${new Date().toLocaleTimeString()}`); run("write", partial); }, 100);
  });
  console.log(`Watching ${relative(REPO, LOCALES)} …`);
}
