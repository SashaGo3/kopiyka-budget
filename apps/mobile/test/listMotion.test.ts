/// <reference types="bun" />
/**
 * The Transactions list on a month switch (lib/listMotion.ts), and the wiring that relies on it.
 *
 * What went wrong, 2026-11-15: on an empty month a gap opened under the title, deep enough for the
 * pull-to-refresh spinner to show with nobody pulling, and the list jumped back on the next switch;
 * the title had gone small; and "Show everything" under an empty current month did nothing.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KEEP_POSITION_FROM, keepsPosition, listKey, slideDirection } from "../src/lib/listMotion";

const SRC = join(import.meta.dir, "..", "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

describe("position keeping", () => {
  test("off at the top, where it pushed a list that had just gone short below its resting place", () => {
    expect(keepsPosition(null)).toBe(false);
    expect(keepsPosition(-140)).toBe(false);   // resting under an expanded large title
    expect(keepsPosition(0)).toBe(false);
    expect(keepsPosition(KEEP_POSITION_FROM)).toBe(false);
  });
  test("on once scrolled into the rows", () => {
    expect(keepsPosition(KEEP_POSITION_FROM + 1)).toBe(true);
    expect(keepsPosition(2400)).toBe(true);
  });
  test("the list only ever asks for it through keepsPosition", () => {
    const list = read("components/TransactionList.tsx");
    expect(list).toContain("maintainVisibleContentPosition={keep ? MAINTAIN_POSITION : undefined}");
    expect(list).not.toMatch(/maintainVisibleContentPosition=\{MAINTAIN_POSITION\}/);
  });
});

describe("a month switch", () => {
  test("is a new list, so no offset or refresh state carries over from the last month", () => {
    expect(listKey(0, "2026-11-01")).not.toBe(listKey(0, "2026-10-01"));
    expect(listKey(1, "2026-11-01")).not.toBe(listKey(0, "2026-11-01"));
    expect(listKey(0, null)).toBe(listKey(0, null));
    expect(read("app/(tabs)/transactions/index.tsx")).toContain("resetKey={listKey(sortGen, listPeriod?.start ?? null)}");
  });
  test("slides a later month in from the right and an earlier one from the left", () => {
    expect(slideDirection("2026-10-01", "2026-11-01")).toBe(1);
    expect(slideDirection("2026-11-15", "2026-10-15")).toBe(-1);
    expect(slideDirection("2025-12-01", "2026-01-01")).toBe(1);
    expect(slideDirection("2026-11-01", "2026-11-01")).toBe(0);
  });
});

describe("tab titles", () => {
  // Asked for large on 2026-11-15, after a build that had made them small.
  test.each([
    ["transactions/index.tsx", "headerLargeTitle: !custom"],
    ["budgets/index.tsx", "headerLargeTitle: true"],
    ["insights/index.tsx", "headerLargeTitle: true"],
    ["settings/index.tsx", "headerLargeTitle: true"],
  ])("%s keeps the large title", (file, expected) => {
    expect(read(`app/(tabs)/${file}`)).toContain(expected);
  });
});

describe("the empty list's button", () => {
  test("is chosen by emptyListAction, never a fixed Show everything", () => {
    const screen = read("app/(tabs)/transactions/index.tsx");
    expect(screen).toContain("emptyListAction(");
    expect(screen).not.toContain(`action={{ label: t("transactions.empty.action"), onPress: showEverything }}`);
  });
});
