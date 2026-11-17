import { describe, expect, it } from "bun:test";
import { appendBlock, compactDayLabel, itemLines, receiptBlock, receiptPlace, snapIndex } from "../src/receipt";

describe("receiptPlace", () => {
  it("is the printed address, not the shop's name", () => {
    expect(receiptPlace({ merchant: "ZETO Serwis", address: "ul. Oleska 7, 45-052 Opole" })).toBe("ul. Oleska 7, 45-052 Opole");
  });
  it("falls back to the shop when no address was printed", () => {
    expect(receiptPlace({ merchant: "Żabka", address: null })).toBe("Żabka");
    expect(receiptPlace({ merchant: " ", address: "" })).toBeNull();
  });
});

describe("receipt note", () => {
  const r = { merchant: "ZETO Serwis", total: 34.15, currency: "PLN", items: [{ name: "Ser", price: 5.95 }, { name: "Jabłka", price: 13.2 }] };
  it("lists the shop, each item and the total", () => {
    expect(receiptBlock(r, "EUR", (a) => `Total ${a}`)).toBe("ZETO Serwis\nSer — 5.95\nJabłka — 13.20\nTotal 34.15 PLN");
  });
  it("goes under what was written, and only once", () => {
    const block = itemLines(r.items, "PLN");
    expect(appendBlock("", block)).toBe(block);
    expect(appendBlock("dinner with Ola", block)).toBe(`dinner with Ola\n\n${block}`);
    expect(appendBlock(`dinner with Ola\n\n${block}`, block)).toBe(`dinner with Ola\n\n${block}`);
  });
});

describe("compactDayLabel", () => {
  const now = new Date("2026-11-16T12:00:00");
  it("keeps the weekday and shows another year as short digits", () => {
    expect(compactDayLabel("2018-08-14", "en-GB", now)).toBe("Tue 14/08/18");
  });
  it("names the month this year", () => {
    expect(compactDayLabel("2026-11-10", "en-GB", now)).toBe("Tue 10 Nov");
  });
});

describe("snapIndex", () => {
  const points = [120, 400, 700];
  it("rests at the nearest point when let go gently", () => {
    expect(snapIndex(points, 380, 0)).toBe(1);
    expect(snapIndex(points, 620, 0.1)).toBe(2);
  });
  it("follows a fling to the next point in its direction", () => {
    expect(snapIndex(points, 420, 1.2)).toBe(2);
    expect(snapIndex(points, 420, -1.2)).toBe(1);
    expect(snapIndex(points, 380, -1.2)).toBe(0);
  });
  it("never leaves the range", () => {
    expect(snapIndex(points, 900, 2)).toBe(2);
    expect(snapIndex(points, 50, -2)).toBe(0);
  });
});
