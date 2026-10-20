import { describe, expect, test } from "bun:test";
import { deriveTransfer } from "../src/transferAmounts";

const typed = (from: boolean, to: boolean) => ({ from, to });

describe("the two figures of a transfer", () => {
  test("nothing typed, nothing shown", () => {
    expect(deriveTransfer({ from: null, to: null, typed: typed(false, false), rate: 4 })).toEqual({ from: null, to: null });
  });

  test("the sent amount leads and the received follows at the rate", () => {
    expect(deriveTransfer({ from: 500, to: null, typed: typed(true, false), rate: 3.7655 })).toEqual({ from: 500, to: 1882.75 });
  });

  test("the received amount can lead just as well", () => {
    expect(deriveTransfer({ from: null, to: 1882.75, typed: typed(false, true), rate: 3.7655 })).toEqual({ from: 500, to: 1882.75 });
  });

  test("one currency: rate 1, the same amount", () => {
    expect(deriveTransfer({ from: 120, to: null, typed: typed(true, false), rate: 1 })).toEqual({ from: 120, to: 120 });
  });

  test("both typed stand as typed, whatever the rate says (a fee, the bank's own conversion)", () => {
    expect(deriveTransfer({ from: 500, to: 1850, typed: typed(true, true), rate: 3.7655 })).toEqual({ from: 500, to: 1850 });
    expect(deriveTransfer({ from: 100, to: 99, typed: typed(true, true), rate: 1 })).toEqual({ from: 100, to: 99 });
  });

  test("without a rate the other side is unknown, never invented", () => {
    expect(deriveTransfer({ from: 500, to: null, typed: typed(true, false), rate: null })).toEqual({ from: 500, to: null });
    expect(deriveTransfer({ from: null, to: 10, typed: typed(false, true), rate: 0 })).toEqual({ from: null, to: 10 });
    expect(deriveTransfer({ from: 1, to: null, typed: typed(true, false), rate: Number.NaN })).toEqual({ from: 1, to: null });
  });

  test("a stale figure on a side that is no longer typed is ignored", () => {
    expect(deriveTransfer({ from: 500, to: 9999, typed: typed(true, false), rate: 2 })).toEqual({ from: 500, to: 1000 });
  });

  test("an expression still being typed (null) gives nothing to follow", () => {
    expect(deriveTransfer({ from: null, to: null, typed: typed(true, false), rate: 2 })).toEqual({ from: null, to: null });
  });
});
