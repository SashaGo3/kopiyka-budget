/**
 * Calculator for the numeric keypad. Supports + - * / with left-to-right
 * precedence rules (* and / bind tighter), parentheses, decimal comma or dot.
 * Pure and dependency free so the keypad and the server share it.
 */
export type CalcResult = { ok: true; value: number } | { ok: false; error: string };

type Tok = { t: "num"; v: number } | { t: "op"; v: "+" | "-" | "*" | "/" } | { t: "("; v: "(" } | { t: ")"; v: ")" };

function tokenize(src: string): Tok[] | null {
  const s = src.replace(/,/g, ".").replace(/[×x]/g, "*").replace(/[÷]/g, "/").replace(/\s+/g, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j]!)) j++;
      const txt = s.slice(i, j);
      if ((txt.match(/\./g) ?? []).length > 1) return null;
      const v = Number(txt);
      if (!Number.isFinite(v)) return null;
      out.push({ t: "num", v });
      i = j;
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { out.push({ t: "(", v: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")", v: ")" }); i++; continue; }
    return null;
  }
  return out;
}

export function evaluate(expr: string): CalcResult {
  const toks = tokenize(expr);
  if (!toks) return { ok: false, error: "invalid" };
  if (toks.length === 0) return { ok: false, error: "empty" };
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function primary(): number {
    const t = next();
    if (!t) throw new Error("unexpected end");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "-") return -primary();
    if (t.t === "op" && t.v === "+") return primary();
    if (t.t === "(") {
      const v = additive();
      const close = next();
      if (!close || close.t !== ")") throw new Error("missing )");
      return v;
    }
    throw new Error("unexpected token");
  }
  function multiplicative(): number {
    let v = primary();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
        next();
        const r = primary();
        if (t.v === "/" && r === 0) throw new Error("divide by zero");
        v = t.v === "*" ? v * r : v / r;
      } else return v;
    }
  }
  function additive(): number {
    let v = multiplicative();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "+" || t.v === "-")) {
        next();
        const r = multiplicative();
        v = t.v === "+" ? v + r : v - r;
      } else return v;
    }
  }
  try {
    const value = additive();
    if (pos !== toks.length) return { ok: false, error: "trailing" };
    if (!Number.isFinite(value)) return { ok: false, error: "overflow" };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** True if the expression is a bare number, i.e. no operator pending. */
export function isPlainNumber(expr: string): boolean {
  return /^\s*-?[0-9]*[.,]?[0-9]*\s*$/.test(expr) && expr.trim() !== "" && expr.trim() !== "-";
}
