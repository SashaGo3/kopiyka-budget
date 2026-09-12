import { describe, expect, test } from "bun:test";
import { autoIcon, iconFor, tagColor, ICON_CATALOG, ICON_PRESETS, COLORS, COLOR_PRESETS } from "../src/icons";

describe("category icons", () => {
  test("matches english, ukrainian and polish names", () => {
    expect(autoIcon("Supermarket")?.icon).toBe("cart.fill");
    expect(autoIcon("Eat Outside/Restaurant")?.icon).toBe("fork.knife");
    expect(autoIcon("Хотелкі")?.icon).toBe("star.fill");
    expect(autoIcon("Car Fuel")?.icon).toBe("fuelpump.fill");
    expect(autoIcon("Polish")?.icon).toBe("book.fill");
    expect(autoIcon("Subscription (Monthly)")?.icon).toBe("repeat");
    expect(autoIcon("Cats")?.icon).toBe("pawprint.fill");
    expect(autoIcon("Salary")?.icon).toBe("banknote.fill");
    expect(autoIcon("Insurance")?.icon).toBe("shield.fill");
    expect(autoIcon("Zupełnie nieznane")).toBeNull();
  });
  test("explicit icon wins, fallback is stable", () => {
    expect(iconFor("Supermarket", { icon: "leaf.fill", color: null }).icon).toBe("leaf.fill");
    expect(iconFor("xyz").icon).toBe("tag.fill");
    expect(iconFor("xyz").color).toBe(iconFor("xyz").color);
  });
  test("explicit colour wins even when the icon auto-matches", () => {
    const m = iconFor("Supermarket", { icon: null, color: "#123456" });
    expect(m.icon).toBe("cart.fill"); // auto-matched icon kept
    expect(m.color).toBe("#123456");  // explicit colour overrides the rule's colour
  });
});

describe("icon catalogue", () => {
  test("has ~120 entries, all unique, each with keywords", () => {
    expect(ICON_CATALOG.length).toBeGreaterThanOrEqual(110);
    expect(ICON_CATALOG.length).toBeLessThanOrEqual(140);
    const names = ICON_CATALOG.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    for (const i of ICON_CATALOG) expect(i.keywords.length).toBeGreaterThan(0);
  });
  test("ICON_PRESETS is derived from the catalogue and keeps every old preset", () => {
    expect(ICON_PRESETS).toEqual(ICON_CATALOG.map((i) => i.name));
    const oldPresets = [
      "fork.knife", "cart.fill", "cup.and.saucer.fill", "cross.case.fill", "house.fill", "percent", "banknote.fill", "shield.fill", "figure.run", "repeat",
      "fuelpump.fill", "car.fill", "bus.fill", "airplane", "pawprint.fill", "gift.fill", "scissors", "figure.and.child.holdinghands", "tshirt.fill", "bag.fill",
      "antenna.radiowaves.left.and.right", "bolt.fill", "book.fill", "gamecontroller.fill", "film.fill", "star.fill", "building.columns.fill", "chart.line.uptrend.xyaxis",
      "person.2.fill", "sparkles", "pin.fill", "banknote", "wineglass.fill", "drop.fill", "doc.text.fill", "heart.fill", "tag.fill", "creditcard.fill", "wrench.and.screwdriver.fill", "leaf.fill",
      "bicycle", "tram.fill", "graduationcap.fill", "pills.fill", "stethoscope", "tv.fill", "music.note", "dumbbell.fill", "hammer.fill", "bed.double.fill",
      "birthday.cake.fill", "briefcase.fill", "key.fill", "lightbulb.fill", "laptopcomputer",
    ];
    for (const p of oldPresets) expect(ICON_PRESETS).toContain(p);
  });
});

describe("colour palette", () => {
  test("24 unique hex entries, each with a name", () => {
    expect(COLORS.length).toBe(24);
    expect(new Set(COLORS.map((c) => c.hex)).size).toBe(24);
    for (const c of COLORS) {
      expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });
  test("no two consecutive colours share a hue family", () => {
    // A colour's "family" is its name with any "dark"/"pastel" variant suffix stripped,
    // e.g. "red dark" and "red" are the same family, but never placed next to each other.
    const family = (name: string) => name.replace(/ (dark|pastel)$/, "");
    for (let i = 1; i < COLORS.length; i++) expect(family(COLORS[i]!.name)).not.toBe(family(COLORS[i - 1]!.name));
  });
  test("ends with neutral grey and brown", () => {
    expect(COLORS[COLORS.length - 2]!.name).toBe("grey");
    expect(COLORS[COLORS.length - 1]!.name).toBe("brown");
  });
  test("COLOR_PRESETS is derived from COLORS", () => {
    expect(COLOR_PRESETS).toEqual(COLORS.map((c) => c.hex));
  });
});

describe("automatic tag colour", () => {
  test("an explicit colour always wins", () => {
    expect(tagColor("work", "#FF0000")).toBe("#FF0000");
  });
  test("the same name always gets the same colour, case and padding aside", () => {
    expect(tagColor("work")).toBe(tagColor(" Work "));
    expect(tagColor("")).toMatch(/^#[0-9A-F]{6}$/);
  });
  test("a handful of ordinary tag names do not all land on one colour", () => {
    const names = ["work", "home", "travel", "coffee", "car", "gift", "kids", "health"];
    expect(new Set(names.map((n) => tagColor(n))).size).toBeGreaterThan(3);
  });
});
