import { describe, expect, test } from "bun:test";
import { LANGUAGES } from "@kopiyka/i18n/generated";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, getRow } from "../src/repo";
import { DEFAULT_ACCOUNT_GROUP } from "../src/models";
import { ACCOUNT_GROUP_PRESET, ACCOUNT_PRESET, accountGroupName, accountName } from "../src/defaultNames";
import { presetName } from "../src/presets";

describe("default names are shown in the app's language until renamed", () => {
  test("named in every language", () => {
    for (const l of LANGUAGES) {
      expect(presetName(ACCOUNT_PRESET, l.code)).toBeTruthy();
      expect(presetName(ACCOUNT_GROUP_PRESET, l.code)).toBeTruthy();
    }
    expect(presetName(ACCOUNT_GROUP_PRESET, "en")).toBe(DEFAULT_ACCOUNT_GROUP);
  });

  test("an account named in English onboarding reads in Ukrainian, and back, case and spacing aside", () => {
    expect(accountName({ name: "Main" }, "uk")).toBe("Основний");
    expect(accountName({ name: " main " }, "uk")).toBe("Основний");
    expect(accountName({ name: "Основний" }, "en")).toBe("Main");
    expect(accountName({ name: "Main" }, "en")).toBe("Main");
  });

  test("a renamed account is the user's, in every language", () => {
    expect(accountName({ name: "Monobank" }, "uk")).toBe("Monobank");
    expect(accountName({ name: "Main card" }, "uk")).toBe("Main card");
    expect(accountName({ name: "Особисті" }, "en")).toBe("Особисті");   // another default's name is not this one's
  });

  test("the default group follows the language; a typed one is kept; no group stays no group", () => {
    expect(accountGroupName("Personal", "uk")).toBe("Особисті");
    expect(accountGroupName("особисті", "en")).toBe("Personal");
    expect(accountGroupName("", "uk")).toBe("");
    expect(accountGroupName(null, "en")).toBe("");
    expect(accountGroupName("Business", "uk")).toBe("Business");
  });

  test("showing a name never rewrites the row", () => {
    const db = openBunDb(); migrate(db);
    const a = createAccount(db, { name: "Main", currency: "UAH" });
    expect(a.group_name).toBe(DEFAULT_ACCOUNT_GROUP);
    expect(accountName(a, "uk")).toBe("Основний");
    expect(accountGroupName(a.group_name, "uk")).toBe("Особисті");
    const again = getRow(db, "accounts", a.id)!;
    expect(again.name).toBe("Main");
    expect(again.group_name).toBe("Personal");
    expect(again.updated_at).toBe(a.updated_at);
  });
});
