/**
 * Account scope shared by Budgets, Insights and Transactions.
 * "" = all accounts, "group:<name>" = every account in a group, otherwise an account id.
 * ("currency:<code>" is still understood for scopes saved earlier, but no longer offered.)
 */
import type { Option } from "@/app/pick/option";
import { t } from "@/i18n";
import { acctName, groupName } from "@/lib/names";

export interface ScopedAccount { id: string; name: string; group_name: string; currency: string }

export function scopeAccountIds(scope: string, accounts: ScopedAccount[]): string[] {
  if (!scope) return [];
  if (scope.startsWith("group:")) return accounts.filter((a) => a.group_name === scope.slice(6)).map((a) => a.id);
  if (scope.startsWith("currency:")) return accounts.filter((a) => a.currency === scope.slice(9)).map((a) => a.id);
  return [scope];
}

/** The single account id when the scope is one account, else null. */
export function scopeAccount(scope: string): string | null {
  return scope && !scope.startsWith("group:") && !scope.startsWith("currency:") ? scope : null;
}

export function scopeLabel(scope: string, accounts: ScopedAccount[]): string {
  if (!scope) return t("period.scope.all");
  if (scope.startsWith("group:")) return groupName(scope.slice(6));
  if (scope.startsWith("currency:")) return t("period.scope.allCurrency", { currency: scope.slice(9) });
  const a = accounts.find((a) => a.id === scope);
  return a ? acctName(a) : t("period.scope.all");
}

/**
 * Options for the scope picker: everything, then each group followed by its accounts,
 * then accounts outside any group.
 * When every account sits in the same group that group is the same as "All accounts",
 * so the accounts are listed under "All accounts" directly.
 */
export function scopeOptions(accounts: ScopedAccount[]): Option[] {
  const n = (count: number) => t("period.scope.accounts", { count });
  const allGroups = [...new Set(accounts.map((a) => a.group_name))];
  const single = allGroups.length === 1;
  const groups = single ? [] : allGroups.filter(Boolean);
  const account = (a: ScopedAccount, indent: boolean): Option => ({ value: a.id, label: acctName(a), subtitle: a.currency, indent });
  return [
    { value: "all", label: t("period.scope.all"), subtitle: single && allGroups[0] ? `${groupName(allGroups[0])} · ${n(accounts.length)}` : n(accounts.length) },
    ...(single ? accounts.map((a) => account(a, true)) : []),
    ...groups.flatMap((g) => {
      const members = accounts.filter((a) => a.group_name === g);
      return [{ value: `group:${g}`, label: groupName(g), subtitle: t("period.scope.group", { count: members.length }) }, ...members.map((a) => account(a, true))];
    }),
    ...(single ? [] : accounts.filter((a) => !a.group_name).map((a) => account(a, false))),
  ];
}
