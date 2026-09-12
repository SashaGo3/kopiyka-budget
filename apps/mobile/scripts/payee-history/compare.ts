/** Reports every question where the Swift answer and core's differ. Exit code 1 when any does. */
import { readFileSync } from "node:fs";

const paths = process.argv.slice(2);
if (paths.length !== 3) { console.error("usage: bun compare.ts <questions.json> <expected.json> <actual.json>"); process.exit(2); }
const [questions, expected, actual] = paths.map((p) => JSON.parse(readFileSync(p, "utf8")));

/** JSON.stringify with object keys sorted, so key order is never a difference. */
const norm = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
  return v;
};
const show = (v: unknown) => JSON.stringify(norm(v));

let failed = 0;
for (const section of ["history", "payment", "fill"] as const) {
  const qs = questions[section] as unknown[];
  for (let i = 0; i < qs.length; i++) {
    const want = show(expected[section][i]), got = show(actual[section]?.[i]);
    if (want === got) continue;
    failed++;
    console.log(`\n✗ ${section}[${i}]  ${show(qs[i])}`);
    console.log(`   core:  ${want}`);
    console.log(`   swift: ${got}`);
  }
}
const total = (["history", "payment", "fill"] as const).reduce((n, s) => n + (questions[s] as unknown[]).length, 0);
console.log(failed ? `\n${failed} of ${total} questions differ.` : `✓ Swift and core agree on all ${total} questions.`);
process.exit(failed ? 1 : 0);
