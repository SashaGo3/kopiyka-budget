import { describe, expect, test } from "bun:test";
import { applyDigitWhole, applyKey, applyKeySigned, evalExpr, evalPartial, exprSign, formatExpr, hasOperator, negateExpr } from "../src/keypad";

function type(keys: string, start = ""): string { return [...keys].reduce((e, k) => applyKey(e, k), start); }
function typeSigned(keys: string, negativeDefault: boolean): string {
  return [...keys].reduce((e, k) => applyKeySigned(e, k, { negativeDefault }), "");
}

describe("keypad", () => {
  test("typing digits and decimals", () => {
    expect(type("1234")).toBe("1234");
    expect(type("0005")).toBe("5");
    expect(type(".5")).toBe("0.5");
    // The second point leaves the number alone — what it moves is where the next digit goes, and
    // only the keypad knows that (`applyDigitWhole`). So typed blindly it is simply ignored.
    expect(type("1.2.3")).toBe("1.23");
    expect(type("1.999")).toBe("1.99");
  });
  test("operators replace each other and cannot lead", () => {
    expect(type("12+×3")).toBe("12×3");
    expect(type("+5")).toBe("5");
    expect(type("−5")).toBe("−5");
  });
  test("backspace and equals", () => {
    expect(applyKey("12+3", "⌫")).toBe("12+");
    expect(applyKey("12+3", "=")).toBe("15");
    expect(applyKey("10÷4", "=")).toBe("2.5");
    expect(applyKey("10÷0", "=")).toBe("10÷0");
  });
  test("evaluation and state", () => {
    expect(evalExpr("12.5+3×2")).toBe(18.5);
    expect(evalExpr("−5+2")).toBe(-3);
    expect(evalExpr("")).toBeNull();
    expect(evalExpr("12+")).toBeNull();
    expect(hasOperator("12+3")).toBe(true);
    expect(hasOperator("−12")).toBe(false);
    expect(hasOperator("12−3")).toBe(true);
    expect(hasOperator("−100")).toBe(false);
    expect(hasOperator("−100−20")).toBe(true);
  });

  test("signed typing: Expense mode gives the first digit/decimal a leading sign", () => {
    expect(typeSigned("100", true)).toBe("−100");
    expect(typeSigned(".5", true)).toBe("−0.5");
    expect(typeSigned("100−20", true)).toBe("−100−20");
    expect(evalExpr(typeSigned("100−20", true))).toBe(-120);
    expect(evalExpr(typeSigned("100+20", true))).toBe(-80);
  });
  test("signed typing: Income mode has no leading sign", () => {
    expect(typeSigned("100", false)).toBe("100");
    expect(typeSigned("100−20", false)).toBe("100−20");
    expect(evalExpr(typeSigned("100−20", false))).toBe(80);
  });
  test("negateExpr toggles the sign; no-op on an empty expression", () => {
    expect(negateExpr("100")).toBe("−100");
    expect(negateExpr("−100")).toBe("100");
    expect(negateExpr("−100−20")).toBe("100−20");
    expect(negateExpr("")).toBe("");
  });
  test("evalPartial keeps the amount field on a number while a sum is half typed", () => {
    // There is no "=" key: the field shows where the sum stands, so a trailing operator is dropped.
    expect(evalPartial("−90")).toBe(-90);
    expect(evalPartial("−90−")).toBe(-90);
    expect(evalPartial("−90−30")).toBe(-120);
    expect(evalPartial("10+30")).toBe(40);
    expect(evalPartial("10×")).toBe(10);
    expect(evalPartial("")).toBeNull();
    expect(evalPartial("−")).toBeNull();
  });
  test("formatExpr spells the sum out, and says nothing about a plain number", () => {
    expect(formatExpr("−90+30")).toBe("−90 + 30");
    expect(formatExpr("10−30")).toBe("10 − 30");
    expect(formatExpr("2×3÷4")).toBe("2 × 3 ÷ 4");
    expect(formatExpr("−90−")).toBe("−90 − ");
    expect(formatExpr("−90")).toBe("");
    expect(formatExpr("90")).toBe("");
    expect(formatExpr("")).toBe("");
  });

  test("exprSign follows the evaluated value", () => {
    expect(exprSign("−100−20")).toBe(-1);
    expect(exprSign("100−20")).toBe(1);
    expect(exprSign("50−50")).toBe(0);
    expect(exprSign("")).toBeNull();
    expect(exprSign("12+")).toBeNull();
  });
});

describe("the decimal point aims the next digit, and never deletes", () => {
  test("pressing it again leaves the number exactly as it was", () => {
    expect(applyKey("12.34", ".")).toBe("12.34");
    expect(applyKey("12.", ".")).toBe("12.");
    expect(applyKey("10+2.5", ".")).toBe("10+2.5");
    expect(applyKey("−7.5", ".")).toBe("−7.5");
  });
  test("a point typed into nothing still borrows its leading zero", () => {
    expect(applyKey("", ".")).toBe("0.");
    expect(applyKey("0.", ".")).toBe("0.");
  });
  test("a digit then goes in front of the point, cents untouched", () => {
    expect(applyDigitWhole("12.34", "5")).toBe("125.34");
    expect(applyDigitWhole(applyDigitWhole("1.50", "2"), "3")).toBe("123.50");
    expect(applyDigitWhole("12.", "5")).toBe("125.");
    // A lone leading zero is replaced, not built on — "0.34" is a number that starts at the cents.
    expect(applyDigitWhole("0.34", "5")).toBe("5.34");
    // Only the number being typed: what came before the operator stays as it was.
    expect(applyDigitWhole("10+2.5", "3")).toBe("10+23.5");
    expect(applyDigitWhole("−7.5", "1")).toBe("−71.5");   // a digit lands at the end of the whole part, as digits do
  });
  test("with no point to aim at, or a key that is not a digit, it is the ordinary keypad", () => {
    expect(applyDigitWhole("12", "5")).toBe("125");
    expect(applyDigitWhole("", "5")).toBe("5");
    expect(applyDigitWhole("12.34", ".")).toBe("12.34");
    expect(applyDigitWhole("12.34", "⌫")).toBe("12.3");
    expect(applyDigitWhole("12.34", "+")).toBe("12.34+");
  });
  test("the twelve-digit ceiling is the same one", () => {
    expect(applyDigitWhole("123456789012.34", "5")).toBe("123456789012.34");
  });
});
