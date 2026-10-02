#!/usr/bin/env node
/* global Buffer */
/**
 * Prints the advance widths frame.mjs needs for Cyrillic captions, read straight out of the font
 * rsvg-convert actually renders with. Run once; paste the output over W_CYR_REG / W_CYR_BOLD in
 * frame.mjs. Nothing calls this at framing time.
 *
 *   node scripts/screenshots/font-widths.mjs [font.ttc]     (default /System/Library/Fonts/HelveticaNeue.ttc)
 *
 * Why this font: frame.mjs asks for "-apple-system, 'SF Pro Display', 'Helvetica Neue', …", and
 * fontconfig on a Mac has no SF Pro, so `fc-match "Helvetica Neue"` is what every slide is set in.
 * The Latin table in frame.mjs is Helvetica's AFM (within ~2% of Helvetica Neue); AFM files have no
 * Cyrillic at all, which is why this exists.
 *
 * No dependencies: a TrueType collection is a header pointing at fonts, and a font is a table
 * directory. Three tables answer the question — `cmap` (character → glyph), `hmtx` (glyph → advance)
 * and `head` (units per em) — plus `name` to tell Regular from Bold inside the collection.
 * Widths are printed in 1/1000 em, the unit the AFM table uses.
 */
import fs from "node:fs";

const FILE = process.argv[2] || "/System/Library/Fonts/HelveticaNeue.ttc";
const buf = fs.readFileSync(FILE);

/** Every character the captions may need beyond the Latin table: Cyrillic, ʼ, «», –, —, ₴, №. */
const CHARS = [];
for (let cp = 0x0400; cp <= 0x04ff; cp++) CHARS.push(cp);
CHARS.push(0x02bc, 0x00ab, 0x00bb, 0x2013, 0x2014, 0x20b4, 0x2116);

function tables(off) {
  const n = buf.readUInt16BE(off + 4);
  const out = {};
  for (let i = 0; i < n; i++) {
    const r = off + 12 + i * 16;
    out[buf.toString("ascii", r, r + 4)] = buf.readUInt32BE(r + 8);
  }
  return out;
}

/** Full name (nameID 4), from the first Unicode/Windows record that has it. */
function fullName(t) {
  const base = t.name;
  const count = buf.readUInt16BE(base + 2);
  const strings = base + buf.readUInt16BE(base + 4);
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platform = buf.readUInt16BE(r);
    if (buf.readUInt16BE(r + 6) !== 4) continue;
    const len = buf.readUInt16BE(r + 8), at = strings + buf.readUInt16BE(r + 10);
    if (platform === 0 || platform === 3) {
      let s = "";
      for (let j = 0; j < len; j += 2) s += String.fromCharCode(buf.readUInt16BE(at + j));
      return s;
    }
    if (platform === 1) return buf.toString("latin1", at, at + len);
  }
  return "?";
}

/** cmap → a lookup function, from a format 4 or format 12 Unicode subtable. */
function cmapOf(t) {
  const base = t.cmap;
  const n = buf.readUInt16BE(base + 2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const r = base + 4 + i * 8;
    const platform = buf.readUInt16BE(r), encoding = buf.readUInt16BE(r + 2);
    const sub = base + buf.readUInt32BE(r + 4);
    const format = buf.readUInt16BE(sub);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    if (format === 12) { best = { format, sub }; break; }
    if (format === 4 && !best) best = { format, sub };
  }
  if (!best) throw new Error("no Unicode cmap");
  const { format, sub } = best;
  if (format === 12) {
    const groups = buf.readUInt32BE(sub + 12);
    return (cp) => {
      for (let g = 0; g < groups; g++) {
        const r = sub + 16 + g * 12;
        const start = buf.readUInt32BE(r), end = buf.readUInt32BE(r + 4);
        if (cp >= start && cp <= end) return buf.readUInt32BE(r + 8) + (cp - start);
      }
      return 0;
    };
  }
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
  return (cp) => {
    for (let s = 0; s < segX2; s += 2) {
      const end = buf.readUInt16BE(ends + s);
      if (cp > end) continue;
      const start = buf.readUInt16BE(starts + s);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltas + s), ro = buf.readUInt16BE(ranges + s);
      if (ro === 0) return (cp + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + s + ro + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
}

function advances(t) {
  const upem = buf.readUInt16BE(t.head + 18);
  const nHMetrics = buf.readUInt16BE(t.hhea + 34);
  const glyph = cmapOf(t);
  return (cp) => {
    const g = glyph(cp);
    if (!g) return null;
    const i = Math.min(g, nHMetrics - 1);
    return Math.round((buf.readUInt16BE(t.hmtx + i * 4) * 1000) / upem);
  };
}

const offsets = buf.toString("ascii", 0, 4) === "ttcf"
  ? Array.from({ length: buf.readUInt32BE(8) }, (_, i) => buf.readUInt32BE(12 + i * 4))
  : [0];
const fonts = offsets.map((o) => { const t = tables(o); return { t, name: fullName(t) }; });
const pick = (want) => fonts.find((f) => f.name === want) ?? (() => { throw new Error(`no "${want}" in ${FILE}: ${fonts.map((f) => f.name).join(", ")}`); })();

for (const [label, want] of [["W_CYR_REG", "Helvetica Neue"], ["W_CYR_BOLD", "Helvetica Neue Bold"]]) {
  const adv = advances(pick(want).t);
  const pairs = [];
  for (const cp of CHARS) {
    const w = adv(cp);
    if (w !== null) pairs.push(`${JSON.stringify(String.fromCodePoint(cp))}: ${w}`);
  }
  console.log(`const ${label} = { ${pairs.join(", ")} };`);
}
