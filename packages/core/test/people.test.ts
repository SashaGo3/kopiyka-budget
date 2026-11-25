import { describe, expect, test } from "bun:test";
import { openBunDb } from "../src/drivers/bun";
import { migrate } from "../src/schema";
import { categorySpend, createAccount, createCategory, createPerson, createTransaction, getRow, listRows } from "../src/repo";
import { budgetPeople, divideShares, groupName, groupPeople, leaveGroup, peopleGroups, ungroup, itemsToStore, letItGo, listPeople, personBalances, personHistory, shareItems, sharesOf, toSplitQueue } from "../src/people";
import { exportBackup, importBackup } from "../src/backup";
import { payeeHistory } from "../src/payee";

function seed() {
  const db = openBunDb(); migrate(db);
  const acc = createAccount(db, { name: "Main", currency: "PLN" });
  const food = createCategory(db, { name: "Eating out" });
  const ola = createPerson(db, { name: " Ola " });
  const max = createPerson(db, { name: "Max" });
  return { db, acc, food, ola, max };
}

/** A 120.00 dinner split three ways the way the entry sheet writes it: yours keeps the category. */
function dinner(s: ReturnType<typeof seed>, date = "2026-11-07T20:00:00+01:00", total = 12000) {
  const [mine, a, b] = divideShares(total, [1, 1, 1]);
  const own = createTransaction(s.db, { account_id: s.acc.id, date, amount_minor: -mine!, category_id: s.food.id, payee: "Bistro", tag_ids: "[]" });
  const olaShare = createTransaction(s.db, { account_id: s.acc.id, date, amount_minor: -a!, payee: "Bistro", person_id: s.ola.id, share_of: own.id, items: itemsToStore([{ name: "Pierogi", amount_minor: a! }]) });
  const maxShare = createTransaction(s.db, { account_id: s.acc.id, date, amount_minor: -b!, payee: "Bistro", person_id: s.max.id, share_of: own.id });
  return { own, olaShare, maxShare };
}

describe("divideShares", () => {
  test("adds up exactly, the first share taking the rounding", () => {
    expect(divideShares(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(divideShares(10000, [1, 2])).toEqual([3334, 6666]);
    expect(divideShares(-999, [1, 1])).toEqual([500, 499]);
  });
  test("weights that are not positive get nothing, and the rounding goes to the first that counts", () => {
    expect(divideShares(1000, [0, 1, 1])).toEqual([0, 500, 500]);
    expect(divideShares(1001, [0, 1, 1])).toEqual([0, 501, 500]);
    expect(divideShares(1000, [])).toEqual([]);
    expect(divideShares(1000, [0, 0])).toEqual([0, 0]);
  });
});

describe("people", () => {
  test("a name is trimmed and the list keeps the order friends were added in", () => {
    const { db, ola, max } = seed();
    expect(ola.name).toBe("Ola");
    expect(listPeople(db).map((p) => p.id)).toEqual([ola.id, max.id]);
  });

  test("a friend's share is not your spending: the month counts only your part", () => {
    const s = seed();
    dinner(s);
    const spent = categorySpend(s.db, "2026-11-01", "2026-12-01");
    expect(spent).toEqual([{ category_id: s.food.id, currency: "PLN", spent_minor: -4000 }]);
  });

  test("what a friend owes is their shares less what they paid back, per currency", () => {
    const s = seed();
    dinner(s);
    createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-09T10:00:00+01:00", amount_minor: 2500, person_id: s.ola.id, payee: "Ola" });
    expect(personBalances(s.db)).toEqual(expect.arrayContaining([
      { person_id: s.ola.id, currency: "PLN", owed_minor: 1500 },
      { person_id: s.max.id, currency: "PLN", owed_minor: 4000 },
    ]));
    // Paying back is not income either.
    expect(categorySpend(s.db, "2026-11-01", "2026-12-01").every((r) => r.spent_minor === -4000)).toBe(true);
  });

  test("history runs oldest first with the balance after each line, and names the purchase", () => {
    const s = seed();
    const { own } = dinner(s);
    createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-09T10:00:00+01:00", amount_minor: 4000, person_id: s.ola.id });
    const lines = personHistory(s.db, s.ola.id);
    expect(lines.map((l) => [l.kind, l.balance_minor])).toEqual([["share", 4000], ["repaid", 0]]);
    expect(lines[0]!.purchase?.id).toBe(own.id);
    expect(lines[0]!.items).toEqual([{ name: "Pierogi", amount_minor: 4000 }]);
    expect(personBalances(s.db, s.ola.id)).toEqual([]);
  });

  test("sharesOf finds what was carved from a purchase", () => {
    const s = seed();
    const { own, olaShare, maxShare } = dinner(s);
    expect(sharesOf(s.db, own.id).map((t) => t.id).sort()).toEqual([olaShare.id, maxShare.id].sort());
  });

  test("a share never teaches a shop's category", () => {
    const s = seed();
    // Only a share at this shop: history knows nothing about it rather than "no category".
    createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-07T20:00:00+01:00", amount_minor: -4000, payee: "Cafe Nero", person_id: s.ola.id });
    expect(payeeHistory(s.db, "Cafe Nero")?.category_id ?? null).toBeNull();
    createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-01T09:00:00+01:00", amount_minor: -1500, payee: "Cafe Nero", category_id: s.food.id });
    expect(payeeHistory(s.db, "Cafe Nero")?.category_id).toBe(s.food.id);
  });
});

describe("letItGo", () => {
  test("what is still owed becomes yours under the purchase's category, the same rows", () => {
    const s = seed();
    const { olaShare } = dinner(s);
    expect(letItGo(s.db, s.ola.id, "PLN")).toBe(4000);
    const row = getRow(s.db, "transactions", olaShare.id)!;
    expect([row.person_id, row.category_id, row.items]).toEqual([null, s.food.id, null]);
    expect(personBalances(s.db, s.ola.id)).toEqual([]);
    expect(categorySpend(s.db, "2026-11-01", "2026-12-01")[0]!.spent_minor).toBe(-8000);
  });

  test("a share partly paid is split: the paid part stays theirs, the rest becomes yours", () => {
    const s = seed();
    const { olaShare } = dinner(s);
    createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-09T10:00:00+01:00", amount_minor: 1500, person_id: s.ola.id });
    expect(letItGo(s.db, s.ola.id, "PLN", { categoryId: null })).toBe(2500);
    expect(getRow(s.db, "transactions", olaShare.id)!.amount_minor).toBe(-1500);
    const yours = listRows(s.db, "transactions", "deleted=0 AND person_id IS NULL AND share_of=? AND amount_minor=-2500", [olaShare.share_of!]);
    expect(yours.length).toBe(1);
    expect(personBalances(s.db, s.ola.id)).toEqual([]);
    // The account still lost exactly what the bank took.
    const total = s.db.get<{ s: number }>(`SELECT SUM(amount_minor) AS s FROM transactions WHERE deleted=0 AND amount_minor<0`)!.s;
    expect(total).toBe(-12000);
  });

  test("the newest shares are the unpaid ones", () => {
    const s = seed();
    const first = dinner(s, "2026-11-01T20:00:00+01:00", 3000);   // Ola 1000
    const second = dinner(s, "2026-11-05T20:00:00+01:00", 6000);  // Ola 2000
    createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-06T10:00:00+01:00", amount_minor: 1000, person_id: s.ola.id });
    expect(letItGo(s.db, s.ola.id, "PLN")).toBe(2000);
    expect(getRow(s.db, "transactions", first.olaShare.id)!.person_id).toBe(s.ola.id);
    expect(getRow(s.db, "transactions", second.olaShare.id)!.person_id).toBeNull();
  });

  test("nothing happens when nothing is owed", () => {
    const s = seed();
    expect(letItGo(s.db, s.ola.id, "PLN")).toBe(0);
  });
});

describe("small readers", () => {
  test("items read safely and store as NULL when empty", () => {
    expect(shareItems('[{"name":" Lamp ","amount_minor":4000},{"name":"","amount_minor":1},{"name":"x","amount_minor":-5}]')).toEqual([{ name: "Lamp", amount_minor: 4000 }]);
    expect(shareItems("nope")).toEqual([]);
    expect(itemsToStore([])).toBeNull();
    expect(budgetPeople('["a","a",3,"b"]')).toEqual(["a", "b"]);
    expect(budgetPeople(null)).toEqual([]);
  });

  test("the To split queue holds marked payments until they are split", () => {
    const s = seed();
    const t = createTransaction(s.db, { account_id: s.acc.id, date: "2026-11-07T20:00:00+01:00", amount_minor: -9000, to_split: 1 });
    expect(toSplitQueue(s.db).map((r) => r.id)).toEqual([t.id]);
  });
});

describe("backups", () => {
  test("people travel with a backup", () => {
    const a = seed();
    dinner(a);
    const file = exportBackup(a.db);
    const b = openBunDb(); migrate(b);
    importBackup(b, file);
    expect(listPeople(b).map((p) => p.name)).toEqual(["Ola", "Max"]);
    expect(personBalances(b).length).toBe(2);
  });

  test("replacing from a file from before people leaves the phone's friends alone", () => {
    const a = seed();
    const file = exportBackup(a.db) as unknown as Record<string, unknown>;
    delete file.people;
    importBackup(a.db, file as never, { mode: "replace" });
    expect(listPeople(a.db).length).toBe(2);
  });
});

describe("friend groups (v26)", () => {
  test("named after the friends in it, by first name", () => {
    expect(groupName(["Ola Kowalska", "Max"], "&")).toBe("Ola & Max");
    expect(groupName(["Ola", "Max", "Ira"], "і")).toBe("Ola, Max і Ira");
    expect(groupName(["Ola"], "&")).toBe("Ola");
  });

  test("grouping, joining, leaving: a group of one is no group", () => {
    const s = seed();
    const ira = createPerson(s.db, { name: "Ira" });
    const g = groupPeople(s.db, [s.ola.id, s.max.id])!;
    expect([...peopleGroups(listPeople(s.db)).get(g)!.map((p) => p.id)].sort()).toEqual([s.ola.id, s.max.id].sort());
    // Ira added to the couple: same group, not a new one.
    expect(groupPeople(s.db, [s.ola.id, s.max.id, ira.id], g)).toBe(g);
    expect(peopleGroups(listPeople(s.db)).get(g)!.length).toBe(3);
    leaveGroup(s.db, ira.id);
    leaveGroup(s.db, s.max.id);
    // Ola, left alone, is cleared rather than kept in a group of one.
    expect(getRow(s.db, "people", s.ola.id)!.group_id).toBeNull();
    expect(peopleGroups(listPeople(s.db)).size).toBe(0);
  });

  test("moving a friend to another group clears the one left alone; untouched rows keep updated_at", () => {
    const s = seed();
    const ira = createPerson(s.db, { name: "Ira" }), jan = createPerson(s.db, { name: "Jan" });
    const a = groupPeople(s.db, [s.ola.id, s.max.id])!;
    groupPeople(s.db, [ira.id, jan.id]);
    const janBefore = getRow(s.db, "people", jan.id)!.updated_at;
    const b = groupPeople(s.db, [ira.id, s.ola.id])!;
    expect(getRow(s.db, "people", s.max.id)!.group_id).toBeNull();
    expect(getRow(s.db, "people", jan.id)!.group_id).toBeNull();
    expect(b).not.toBe(a);
    // Editing a group down to one member dissolves it.
    expect(groupPeople(s.db, [ira.id], b)).toBeNull();
    expect(peopleGroups(listPeople(s.db)).size).toBe(0);
    expect(janBefore).toBeGreaterThan(0);
  });

  test("a backup from before v26 leaves the phone's groups alone", () => {
    const s = seed();
    const g = groupPeople(s.db, [s.ola.id, s.max.id])!;
    const file = exportBackup(s.db);
    const old = { ...file, people: file.people!.map(({ group_id: _g, ...p }) => ({ ...p, updated_at: p.updated_at + 1000 })) };
    importBackup(s.db, old);
    expect(getRow(s.db, "people", s.ola.id)!.group_id).toBe(g);
  });
});
