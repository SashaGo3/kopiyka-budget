import { describe, expect, test } from "bun:test";
import { evaluate, isPlainNumber } from "../src/calc";

describe("calculator", () => {
  test("basic arithmetic", () => {
    expect(evaluate("12+3")).toEqual({ ok: true, value: 15 });
    expect(evaluate("10-2*3")).toEqual({ ok: true, value: 4 });
    expect(evaluate("(10-2)*3")).toEqual({ ok: true, value: 24 });
    expect(evaluate("7/2")).toEqual({ ok: true, value: 3.5 });
    expect(evaluate("-5+2")).toEqual({ ok: true, value: -3 });
  });
  test("keypad glyphs and comma decimals", () => {
    expect(evaluate("2×3,5")).toEqual({ ok: true, value: 7 });
    expect(evaluate("9÷3")).toEqual({ ok: true, value: 3 });
  });
  test("errors", () => {
    expect(evaluate("1/0").ok).toBe(false);
    expect(evaluate("1+").ok).toBe(false);
    expect(evaluate("abc").ok).toBe(false);
    expect(evaluate("").ok).toBe(false);
    expect(evaluate("1..2").ok).toBe(false);
  });
  test("plain number detection", () => {
    expect(isPlainNumber("12.5")).toBe(true);
    expect(isPlainNumber("12+")).toBe(false);
    expect(isPlainNumber("-")).toBe(false);
  });
});
