import { describe, expect, test } from "bun:test";
import { backupDue, backupFileName, parseBackupName, retentionPlan } from "../src/backupSchedule";

const file = (day: string, hhmm: string) => { const name = `kopiyka-${day}T${hhmm.replace(":", "-")}-00.json`; return { name, day, time: parseBackupName(name)!.time }; };

describe("backup schedule", () => {
  test("names round-trip in local time", () => {
    const d = new Date(2026, 8, 8, 14, 5, 33);
    expect(backupFileName(d)).toBe("kopiyka-2026-09-08T14-05-33.json");
    expect(parseBackupName(backupFileName(d))).toEqual({ day: "2026-09-08", time: d.getTime() });
    expect(parseBackupName("notes.json")).toBeNull();
  });

  test("keeps the day's first plus the newest, drops old days", () => {
    const now = new Date(2026, 8, 8, 23, 0, 0);
    const files = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"].map((t) => file("2026-09-08", t));
    expect(retentionPlan(files, { perDay: 7, keepDays: 30 }, now).map((f) => f.name.slice(19, 21))).toEqual(["08", "09"]);
    const old = [file("2026-08-09", "10:00"), file("2026-08-10", "10:00")];
    expect(retentionPlan(old, { perDay: 7, keepDays: 30 }, now).map((f) => f.day)).toEqual(["2026-08-09"]);
    expect(retentionPlan(old, { perDay: 7, keepDays: 0 }, now)).toEqual([]);
  });

  test("due: changes, wait, daily, nothing", () => {
    const now = new Date(2026, 8, 8, 12, 0, 0);
    const m = 60_000;
    expect(backupDue({ now, changed: true, lastAt: 0, hasToday: false, minIntervalMs: 30 * m })).toBe("changes");
    expect(backupDue({ now, changed: true, lastAt: now.getTime() - 10 * m, hasToday: true, minIntervalMs: 30 * m })).toBe("wait");
    expect(backupDue({ now, changed: true, lastAt: now.getTime() - 40 * m, hasToday: true, minIntervalMs: 30 * m })).toBe("changes");
    expect(backupDue({ now, changed: false, lastAt: now.getTime() - 40 * m, hasToday: false, minIntervalMs: 30 * m })).toBe("daily");
    expect(backupDue({ now, changed: false, lastAt: now.getTime() - 40 * m, hasToday: true, minIntervalMs: 30 * m })).toBeNull();
  });
});
