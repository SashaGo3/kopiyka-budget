import { describe, expect, test } from "bun:test";
import { compareVersions, hasNotes, releasesSince, type Release } from "../src/release";

const R = (version: string, added: string[] = ["a thing"]): Release => ({ version, date: "2026-09-21", added });
const NOTES: Release[] = [R("1.2.0"), R("1.1.0"), R("1.0.1"), R("1.0.0")];

describe("compareVersions", () => {
  test("numeric parts, not string order", () => {
    // The whole reason this exists: "1.9" sorts after "1.10" as a string.
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.2", "1.0.10")).toBe(-1);
  });
  test("a missing part is zero", () => {
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
    expect(compareVersions("1.1", "1.1.1")).toBe(-1);
  });
  test("something unparseable is zero rather than a crash at launch", () => {
    expect(compareVersions("1.0.x", "1.0.0")).toBe(0);
    expect(compareVersions("", "0")).toBe(0);
  });
});

describe("which releases are news", () => {
  test("everything newer than what this install last saw, newest first", () => {
    expect(releasesSince(NOTES, { seen: "1.0.1", current: "1.2.0", fresh: false }).map((r) => r.version))
      .toEqual(["1.2.0", "1.1.0"]);
  });

  test("nothing when it is already up to date", () => {
    expect(releasesSince(NOTES, { seen: "1.2.0", current: "1.2.0", fresh: false })).toEqual([]);
  });

  test("a fresh install is told nothing — everything is new to someone who has never used it", () => {
    expect(releasesSince(NOTES, { seen: null, current: "1.2.0", fresh: true })).toEqual([]);
  });

  test("an install that has never recorded a version gets this release only, not the whole history", () => {
    expect(releasesSince(NOTES, { seen: null, current: "1.2.0", fresh: false }).map((r) => r.version)).toEqual(["1.2.0"]);
  });

  test("notes written ahead of the build they describe stay hidden", () => {
    // 1.2.0 is in the file; this build is 1.1.0 and must not leak it.
    expect(releasesSince(NOTES, { seen: "1.0.1", current: "1.1.0", fresh: false }).map((r) => r.version)).toEqual(["1.1.0"]);
  });

  test("a downgrade shows nothing rather than the same notes again", () => {
    expect(releasesSince(NOTES, { seen: "1.2.0", current: "1.1.0", fresh: false })).toEqual([]);
  });

  test("a version with no entry of its own still catches up the ones before it", () => {
    expect(releasesSince(NOTES, { seen: "1.0.0", current: "1.1.5", fresh: false }).map((r) => r.version))
      .toEqual(["1.1.0", "1.0.1"]);
  });
});

describe("hasNotes", () => {
  test("an entry with nothing in it is not worth a sheet", () => {
    expect(hasNotes({ version: "1.0.0", date: "2026-09-21" })).toBe(false);
    expect(hasNotes({ version: "1.0.0", date: "2026-09-21", fixed: [] })).toBe(false);
    expect(hasNotes({ version: "1.0.0", date: "2026-09-21", fixed: ["one thing"] })).toBe(true);
  });
});
