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
    // Pressing it again changes nothing about the number. The key is a switch between the two
    // halves of what is being typed — cents while it is lit, whole units while it is not — and the
    // keypad, which is the only thing that knows which half it is pointing at, answers the second
    // press by moving that focus (`applyDigitWhole`). It used to delete the decimals instead, on
    // the grounds that a switch has to switch off; but the decimals are usually the part that was
    // right, and there is a backspace for the part that was not.
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

/**
 * A digit typed into the *whole* part of the number being written, the point staying where it is:
 * "12.34" and 5 make "125.34". This is the second press of the decimal point — it aims the next
 * digits in front of the point instead of after it, rather than throwing the cents away.
 *
 * Only the number being typed is touched, as everywhere else here: what came before the last
 * operator is left alone. A lone leading zero is replaced rather than kept ("0.34" → "5.34"), the
 * same way `applyKey` treats a whole part of "0", and the twelve-digit ceiling is the same one.
 * Anything that is not a digit, or a number with no point to type in front of, falls through to
 * `applyKey`, so a caller can send every key here and get the ordinary behaviour back.
 */
export function applyDigitWhole(expr: string, key: string): string {
  if (!/^\d$/.test(key)) return applyKey(expr, key);
  const tail = expr.split(/[+−×÷]/).pop() ?? "";
  const at = tail.indexOf(".");
  if (at < 0) return applyKey(expr, key);
  if (tail.replace(".", "").length >= 12) return expr;
  const head = expr.slice(0, expr.length - tail.length);
  const whole = tail.slice(0, at);
  return head + (whole === "0" ? key : whole + key) + tail.slice(at);
}

/** Evaluate a keypad expression to a number rounded to cents, or null. */
export function evalExpr(expr: string): number | null {
  if (!expr) return null;
  const r = evaluate(expr.replace(/−/g, "-"));
  return r.ok ? Math.round(r.value * 100) / 100 : null;
}

/** True when the expression still contains a binary operator, i.e. it is a sum and not just a number. */
export function hasOperator(expr: string): boolean {
  return /[+×÷]/.test(expr) || /.−/.test(expr);
}

/**
 * The number to put in the amount field while a sum is being typed.
 *
 * There is no "=" key: the field always shows where the sum stands, and the sum itself is spelled
 * out underneath it (`formatExpr`). So a half-typed "90−" has to mean something — it is 90 until
 * the next number lands — and a trailing operator is simply dropped before evaluating. Returns null
 * only when there is nothing to evaluate at all.
 */
export function evalPartial(expr: string): number | null {
  let e = expr;
  while (e && KEYPAD_OPS.includes(e.slice(-1))) e = e.slice(0, -1);
  // "−" on its own is the start of a negative number, not a number.
  return e && e !== "−" ? evalExpr(e) : null;
}

/**
 * The expression as a line of arithmetic to read: "−90+30" becomes "−90 + 30". Binary operators get
 * spaces, a leading sign does not, and a trailing operator keeps its space so the line grows where
 * the next digit will land. Returns "" when the expression is just a number and there is no sum to
 * show.
 */
export function formatExpr(expr: string): string {
  if (!hasOperator(expr)) return "";
  const lead = expr.startsWith("−") ? "−" : "";
  const rest = expr.slice(lead.length);
  return lead + rest.replace(/[+−×÷]/g, (op) => ` ${op} `).replace(/\s+/g, " ").trimStart();
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
