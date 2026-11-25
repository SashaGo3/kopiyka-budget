/// <reference types="bun" />
import { expect, test } from "bun:test";
import { breaksMidWord } from "../src/lib/wordBreak";

test("a word cut at the line end is caught; a break between words is not", () => {
  expect(breaksMidWord(["Обрати це ", "розташуванн", "я"])).toBe(true);
  expect(breaksMidWord(["Обрати це ", "розташування"])).toBe(false);
  expect(breaksMidWord(["Add ", "expense"])).toBe(false);
  expect(breaksMidWord(["Line one\n", "two"])).toBe(false);
  expect(breaksMidWord(["self-", "service"])).toBe(false);
  expect(breaksMidWord(["Один"])).toBe(false);
});
