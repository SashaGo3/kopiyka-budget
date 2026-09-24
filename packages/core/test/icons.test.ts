import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { autoIcon, iconFor, tagColor, searchIcons, ICON_CATALOG, ICON_GROUPS, ICON_PRESETS, COLORS, COLOR_PRESETS } from "../src/icons";

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
  test("has ~240 entries, all unique, each grouped and with keywords", () => {
    expect(ICON_CATALOG.length).toBeGreaterThanOrEqual(200);
    expect(ICON_CATALOG.length).toBeLessThanOrEqual(280);
    const names = ICON_CATALOG.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    for (const i of ICON_CATALOG) {
      expect(i.keywords.length).toBeGreaterThan(0);
      expect(ICON_GROUPS as readonly string[]).toContain(i.group);
    }
  });
  test("every group has icons, and the catalogue is ordered by group", () => {
    // The picker reads the catalogue straight through, so a group split in two would print
    // its heading twice.
    const seen: string[] = [];
    for (const i of ICON_CATALOG) if (seen[seen.length - 1] !== i.group) seen.push(i.group);
    expect(seen).toEqual([...ICON_GROUPS]);
  });
  /**
   * A symbol name is a plain string all the way to `SymbolView`, so a typo is not a type error —
   * it is an icon that silently renders as nothing. The app's floor is iOS 18, so every name has
   * to exist in SF Symbols 6.0 or earlier.
   */
  test("every symbol exists in SF Symbols 6.0 or earlier", () => {
    const dts = readFileSync(new URL("../../../node_modules/sf-symbols-typescript/dist/index.d.ts", import.meta.url), "utf8");
    const available = new Set<string>();
    for (const block of dts.split("export type SFSymbols").slice(1)) {
      const version = parseFloat(block.slice(0, block.indexOf(" ")).replace("_", "."));
      if (version <= 6.0) for (const m of block.matchAll(/'([^']+)'/g)) available.add(m[1]!);
    }
    expect(available.size).toBeGreaterThan(5000);   // the file was found and parsed
    expect(ICON_CATALOG.map((i) => i.name).filter((n) => !available.has(n))).toEqual([]);
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

describe("icon search", () => {
  test("a blank query is the whole catalogue, in catalogue order", () => {
    expect(searchIcons("  ")).toEqual(ICON_CATALOG);
  });
  test("a whole word beats a substring: \"car\" leads with the car, not the carrot", () => {
    const names = searchIcons("car").map((i) => i.name);
    expect(names).toContain("car.fill");
    expect(names.indexOf("car.fill")).toBeLessThan(names.indexOf("carrot.fill"));
  });
  test("every word has to match, so two words narrow rather than widen", () => {
    const both = searchIcons("car electric");
    expect(both.length).toBeGreaterThan(0);
    expect(both.length).toBeLessThan(searchIcons("car").length);
    for (const i of both) expect(`${i.name} ${i.keywords}`).toContain("electric");
  });
  test("finds icons by polish and ukrainian words, accents and all", () => {
    expect(searchIcons("kawa")[0]?.name).toBe("cup.and.saucer.fill");
    expect(searchIcons("кава")[0]?.name).toBe("cup.and.saucer.fill");
    expect(searchIcons("smieci").map((i) => i.name)).toContain("trash.fill");   // written without the ś
    expect(searchIcons("ksiazka").map((i) => i.name)).toContain("book.fill");   // ą folded, ż folded
  });
  test("nothing matches nothing", () => {
    expect(searchIcons("qwertyuiop")).toEqual([]);
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
