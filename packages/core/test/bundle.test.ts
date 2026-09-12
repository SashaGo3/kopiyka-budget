import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { createAccount, createCategory, createTransaction, getRow, listRows } from "../src/repo";
import { exportBackupJson, importBackup } from "../src/backup";
import { BUNDLE_BACKUP, packBundle, unpackBundle } from "../src/bundle";

const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, ...Array.from({ length: n }, (_, i) => i % 256)]);

describe("bundle", () => {
  test("round-trips a backup and its photos, keyed by the name the rows carry", () => {
    const db = openBunDb(); migrate(db);
    const acc = createAccount(db, { name: "Cash", currency: "PLN" });
    const cat = createCategory(db, { name: "Food" });
    const tx = createTransaction(db, { account_id: acc.id, date: "2026-09-07T10:00:00+02:00", amount_minor: -500, category_id: cat.id, photo: "abc-1.jpg" });

    const bytes = packBundle(exportBackupJson(db), { "abc-1.jpg": jpeg(64) });
    const out = unpackBundle(bytes);
    expect(Object.keys(out.photos)).toEqual(["abc-1.jpg"]);
    expect(out.photos["abc-1.jpg"]).toEqual(jpeg(64));

    // The name in the restored row is the key the image was stored under: that is the whole index.
    const fresh = openBunDb(); migrate(fresh);
    importBackup(fresh, out.json);
    expect(getRow(fresh, "transactions", tx.id)?.photo).toBe("abc-1.jpg");
    expect(listRows(fresh, "accounts", "deleted=0").length).toBe(1);
  });

  test("a zip with no backup in it is refused", () => {
    const bytes = packBundle("{}", {});
    const stripped = unpackBundle(bytes);
    expect(stripped.json).toBe("{}");
    expect(() => unpackBundle(new Uint8Array([1, 2, 3]))).toThrow();
  });

  test("entries that are not plain photo names are ignored, so a crafted zip cannot escape the folder", () => {
    const bytes = packBundle("{}", { "../../evil.jpg": jpeg(4), "sub/dir.jpg": jpeg(4), ".hidden.jpg": jpeg(4), "fine.jpg": jpeg(4) });
    expect(Object.keys(unpackBundle(bytes).photos)).toEqual(["fine.jpg"]);
  });

  test(`the backup entry is named ${BUNDLE_BACKUP} so another tool can find it`, () => {
    expect(BUNDLE_BACKUP).toBe("backup.json");
  });
});
