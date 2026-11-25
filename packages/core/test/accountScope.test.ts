import { expect, it } from "bun:test";
import { scopeAccountIds } from "../src/accountScope";

it("treats an archived or deleted account as all accounts", () => {
  const accounts = [{ id: "a", group_name: "Personal", currency: "PLN" }, { id: "old", group_name: "Personal", currency: "PLN", archived: 1 }];
  expect(scopeAccountIds("a", accounts)).toEqual(["a"]);
  expect(scopeAccountIds("old", accounts)).toEqual([]);
  expect(scopeAccountIds("gone", accounts)).toEqual([]);
});
