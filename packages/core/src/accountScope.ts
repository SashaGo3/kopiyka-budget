/**
 * Which accounts a screen's account scope covers. "" = all accounts, "group:<name>" = every account
 * in a group, "currency:<code>" (scopes saved before 1.0.3) = every account in it, otherwise one
 * account id. [] means all.
 */
export interface ScopeAccount { id: string; group_name: string; currency: string; archived?: number }

export function scopeAccountIds(scope: string, accounts: ScopeAccount[]): string[] {
  if (!scope) return [];
  if (scope.startsWith("group:")) return accounts.filter((a) => a.group_name === scope.slice(6)).map((a) => a.id);
  if (scope.startsWith("currency:")) return accounts.filter((a) => a.currency === scope.slice(9)).map((a) => a.id);
  // An account that is gone or archived is all accounts, as the scope pill already says: filtering
  // by it showed an empty list under a pill reading "All accounts".
  return accounts.some((a) => a.id === scope && !a.archived) ? [scope] : [];
}
