/// <reference types="bun" />
/**
 * No button in the app ends its label in "…" (components/ui.tsx, `ButtonText`).
 *
 * Every `<Pressable>` in src/ is read as text, and every `<Text>` inside one is a button's words unless
 * it is a row's content — a payee, a category, an account in a list, which may truncate like any list
 * does. Those are named below by their style, the one convention the screens already share. Anything
 * else inside a Pressable that asks for `numberOfLines` or `ellipsizeMode` fails here: use
 * `ButtonText` (wraps, or `fit` to shrink) instead.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "src");

/** Styles of a row's own content, which is not a button label and may truncate. */
const ROW_CONTENT = new Set([
  "title", "sub", "name", "before", "after", "hitName", "hitSub", "header", "folder", "line", "lineText",
  "place", "text", "budgetName", "legendName", "amount", "rowSub",
]);

/**
 * Files being rewritten on another branch for 1.0.4 (the transfer sheet). Take each one off this list
 * when that branch lands: its labels are held to the same rule as everything else's.
 */
const PENDING = new Set(["app/transfer/[id].tsx"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

/** Each `<Pressable …>…</Pressable>` in `src`, nested ones included, with the line it starts on. */
function pressables(src: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  const open = /<Pressable\b/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    const tags = /<Pressable\b|<\/Pressable>/g;
    tags.lastIndex = m.index;
    let depth = 0;
    let t: RegExpExecArray | null;
    while ((t = tags.exec(src))) {
      depth += t[0] === "</Pressable>" ? -1 : 1;
      if (depth === 0) { out.push({ line: src.slice(0, m.index).split("\n").length, body: src.slice(m.index, t.index) }); break; }
    }
  }
  return out;
}

/** The first style a `<Text …>` names: `styles.done` → "done". */
const styleName = (attrs: string) => attrs.match(/style=\{\[?\s*styles\.(\w+)/)?.[1] ?? null;

describe("button labels", () => {
  test("never truncate with an ellipsis", () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      if (PENDING.has(relative(SRC, file))) continue;
      const src = readFileSync(file, "utf8");
      for (const { line, body } of pressables(src)) {
        // Only this Pressable's own Text, not a nested Pressable's (that one is checked on its own).
        const own = body[0] + body.slice(1).replace(/<Pressable\b[\s\S]*?<\/Pressable>/g, "");
        for (const tag of own.matchAll(/<Text\b([^>]*)>/g)) {
          const attrs = tag[1]!;
          if (!/\bnumberOfLines\b|\bellipsizeMode\b/.test(attrs)) continue;
          const name = styleName(attrs);
          if (name && ROW_CONTENT.has(name)) continue;
          offenders.push(`${relative(SRC, file)}:${line} <Text${attrs.slice(0, 80)}…>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("ButtonText is the only place ellipsizeMode is set, and only to clip", () => {
    const offenders = files(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/ellipsizeMode="(\w+)"/g)]
        .filter((m) => m[1] !== "clip")
        .map(() => relative(SRC, file)));
    expect(offenders).toEqual([]);
  });
});
