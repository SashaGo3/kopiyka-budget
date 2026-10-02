/**
 * Reads `locales/<language>/<namespace>.json` into flat entries keyed `namespace.path.to.key`.
 *
 * A leaf is either the message itself or, where it needs one, an object:
 *
 *   "title": "Settings"
 *   "left": { "message": "{count, plural, one {# day left} other {# days left}}",
 *             "note": "Under the budget bar; count = days to the end of the month",
 *             "max": 24 }
 *
 * `note` is for whoever translates (it is copied into the String Catalog as its comment) and `max` is
 * a length every language has to fit, checked on every branch of every plural. Both belong in the
 * source language; a translation may use the object form too, but only its `message` is read.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../i18n.config";

export interface Entry { key: string; namespace: string; message: string; note?: string; max?: number; file: string }
export type Locale = Map<string, Entry>;

export const ROOT = join(import.meta.dir, "..");
export const LOCALES = join(ROOT, "locales");

const SEGMENT = /^[A-Za-z][A-Za-z0-9_]*$/;

export class LoadError extends Error {}

function walk(node: unknown, path: string[], namespace: string, file: string, out: Locale) {
  const key = path.join(".");
  if (typeof node === "string") { out.set(key, { key, namespace, message: node, file }); return; }
  if (node && typeof node === "object" && !Array.isArray(node)) {
    const o = node as Record<string, unknown>;
    if (typeof o.message === "string") {
      const extra = Object.keys(o).filter((k) => !["message", "note", "max"].includes(k));
      if (extra.length) throw new LoadError(`${file}: "${key}" has unknown fields ${extra.join(", ")} — a group may not have a key named "message" (it reads as a leaf); rename that key`);
      out.set(key, { key, namespace, message: o.message, file,
        ...(typeof o.note === "string" ? { note: o.note } : {}),
        ...(typeof o.max === "number" ? { max: o.max } : {}) });
      return;
    }
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith("$")) continue;   // "$comment" and the like: notes for the file, not messages
      if (!SEGMENT.test(k)) throw new LoadError(`${file}: "${[...path, k].join(".")}" — key segments are letters, digits and _, starting with a letter`);
      walk(v, [...path, k], namespace, file, out);
    }
    return;
  }
  throw new LoadError(`${file}: "${key}" is neither a message nor a group`);
}

/** `onError` set: a file that fails to load is reported and skipped instead of stopping everything. */
export function loadLocale(lang: string, root = LOCALES, onError?: (e: LoadError) => void): Locale {
  const dir = join(root, lang);
  const out: Locale = new Map();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const namespace = f.slice(0, -5);
    if (!SEGMENT.test(namespace)) throw new LoadError(`${lang}/${f}: a namespace file is named like a key segment`);
    const file = `${lang}/${f}`;
    try {
      let json: unknown;
      try { json = JSON.parse(readFileSync(join(dir, f), "utf8")); }
      catch (e) { throw new LoadError(`${file}: ${(e as Error).message}`); }
      const own: Locale = new Map();
      walk(json, [namespace], namespace, file, own);
      for (const [k, v] of own) out.set(k, v);
    } catch (e) {
      if (!onError || !(e instanceof LoadError)) throw e;
      onError(e);
    }
  }
  return out;
}

export function loadAll(root = LOCALES, onError?: (e: LoadError) => void): Map<string, Locale> {
  return new Map(config.languages.map((l) => [l.code, loadLocale(l.code, root, onError)]));
}
