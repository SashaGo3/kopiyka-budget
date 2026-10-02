/**
 * Category names as the app shows them. A ready-made category is shown in the app's language until
 * it is renamed (core `categoryName`, DATA.md rule 16), so a name is never read straight off a row.
 *
 *   catName(category)                 a row you already have
 *   catNameById(id, rowName)          a row you only have the id of — a joined `category_name`, a
 *                                     transaction's `category_id`; `rowName` is shown if the id is gone
 *
 * Text that goes into a *file* (CSV export, a backup, the summary written into a note) keeps whatever
 * the user would recognise on screen, so it goes through here too; the stored `name` is untouched.
 *
 * Accounts and groups the same way (core `accountName` / `accountGroupName`, DATA.md rule 17): the
 * first account's "Main" and the default group "Personal" read in the app's language until renamed.
 *
 *   acctName(account)                 a row you have (or just its `name` — a joined `account_name`)
 *   groupName(group_name)             for display only; grouping keeps comparing the stored value
 */
import { accountGroupName, accountName, categoryDescription, categoryName, listRows, type Account, type Category } from "@kopiyka/core";
import { db } from "@/db";
import { dbVersion } from "@/store";
import { getLanguage } from "@/i18n";

export function catName(c: Pick<Category, "name"> & { preset?: string | null }): string {
  return categoryName(c, getLanguage());
}

export function catDescription(c: Pick<Category, "description"> & { preset?: string | null }): string | null {
  return categoryDescription(c, getLanguage());
}

let cache: { version: number; lang: string; byId: Map<string, string> } | null = null;

export function catNameById(id: string | null | undefined, fallback: string | null = null): string | null {
  if (!id) return fallback;
  const lang = getLanguage();
  if (!cache || cache.version !== dbVersion() || cache.lang !== lang) {
    cache = { version: dbVersion(), lang, byId: new Map(listRows(db, "categories", "1=1").map((c) => [c.id, categoryName(c, lang)])) };
  }
  return cache.byId.get(id) ?? fallback;
}

/** Takes a missing row too (`acctName(getRow(…)) ?? fallback`). */
export function acctName(a: Pick<Account, "name">): string;
export function acctName(a: Pick<Account, "name"> | null | undefined): string | undefined;
export function acctName(a: Pick<Account, "name"> | null | undefined): string | undefined {
  return a ? accountName(a, getLanguage()) : undefined;
}

/** Shown, not compared: group by the stored `group_name`, label with this. */
export function groupName(group: string | null | undefined): string {
  return accountGroupName(group, getLanguage());
}
