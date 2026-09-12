/**
 * Pure keypad logic for the custom numeric keyboard, shared by the phone and tests.
 * Expressions use display glyphs: + − × ÷ and a dot decimal.
 */
import { evaluate } from "./calc";

export const KEYPAD_OPS = "+−×÷";

export function applyKey(expr: string, key: string): string {
  if (key === "⌫") return expr.slice(0, -1);
  if (key === "C") return "";
  if (key === "=") { const v = evalExpr(expr); return v === null ? expr : trimNumber(v); }
  const last = expr.slice(-1);
  if (KEYPAD_OPS.includes(key)) {
    if (!expr) return key === "−" ? "−" : expr;
    if (KEYPAD_OPS.includes(last)) return expr.slice(0, -1) + key; // replace operator
    return expr + key;
  }
  const tail = expr.split(/[+−×÷]/).pop() ?? "";
  if (key === ".") {
    if (tail.includes(".")) return expr;
    if (tail === "") return expr + "0.";
    return expr + ".";
  }
  if (!/^\d$/.test(key)) return expr;
  if (tail === "0") return expr.slice(0, -1) + key;
  const dec = tail.split(".")[1];
  if (dec && dec.length >= 2) return expr; // money: two decimals max
  if (tail.replace(".", "").length >= 12) return expr;
  return expr + key;
}

/** Evaluate a keypad expression to a number rounded to cents, or null. */
export function evalExpr(expr: string): number | null {
  if (!expr) return null;
  const r = evaluate(expr.replace(/−/g, "-"));
  return r.ok ? Math.round(r.value * 100) / 100 : null;
}

/** True when the expression still contains a binary operator (so "=" makes sense). */
export function hasOperator(expr: string): boolean {
  return /[+×÷]/.test(expr) || /.−/.test(expr);
}

export function trimNumber(n: number): string {
  const s = (Math.round(n * 100) / 100).toString();
  return s === "NaN" ? "" : s.replace(/^-/, "−");
}

/**
 * Signed-expression helpers for the Log sheet: there the expression IS the signed money
 * (expenses negative), unlike the magnitude-only sheets above (transfer/budget/amount),
 * which keep calling `applyKey`/`evalExpr`/`hasOperator` unchanged.
 */

/** Flip the sign of a signed expression. No-op on an empty expression — the caller should
 *  switch its own default mode instead when there is nothing typed yet. */
export function negateExpr(expr: string): string {
  if (!expr) return expr;
  return expr.startsWith("−") ? expr.slice(1) : "−" + expr;
}

/** `applyKey`, but the first digit/decimal typed into an empty expression gets a leading
 *  "−" when `negativeDefault` is set (Expense mode starts negative). */
export function applyKeySigned(expr: string, key: string, opts: { negativeDefault: boolean }): string {
  if (expr === "" && opts.negativeDefault && (key === "." || /^\d$/.test(key))) return applyKey("−", key);
  return applyKey(expr, key);
}

/** Sign of the evaluated expression: 1, -1, 0, or null when it doesn't evaluate (yet). */
export function exprSign(expr: string): 1 | -1 | 0 | null {
  const v = evalExpr(expr);
  return v === null ? null : v > 0 ? 1 : v < 0 ? -1 : 0;
}
