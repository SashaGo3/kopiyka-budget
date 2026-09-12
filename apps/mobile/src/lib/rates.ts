import { useEffect, useState } from "react";
import { latestCachedRate, rateOrFallback } from "@kopiyka/core";
import { db } from "@/db";
import { getMeta, setMeta, listRows } from "@kopiyka/core";

/** Base currency for totals: stored locally, defaults to the most common account currency. */
export function getBaseCurrency(): string {
  const m = getMeta(db, "base_currency");
  if (m) return m;
  // The currency you transact in most is the natural base.
  const top = db.get<{ currency: string }>(`SELECT a.currency FROM transactions t JOIN accounts a ON a.id=t.account_id WHERE t.deleted=0 GROUP BY a.currency ORDER BY COUNT(*) DESC LIMIT 1`);
  return top?.currency ?? listRows(db, "accounts")[0]?.currency ?? "EUR";
}
export function setBaseCurrency(c: string): void { setMeta(db, "base_currency", c); }

/** Rate lookup for a set of currencies into `base`; fetches missing ones in the background (Frankfurter, cached). */
export function useRates(currencies: string[], base: string): { rateFor: (from: string, to: string) => number | null; loading: boolean } {
  const [, bump] = useState(0);
  const [loading, setLoading] = useState(false);
  const key = currencies.filter((c) => c !== base).sort().join(",");
  useEffect(() => {
    let alive = true;
    const missing = (key ? key.split(",") : []).filter((c) => !latestCachedRate(db, c, base));
    if (!missing.length) return;
    setLoading(true);
    (async () => {
      for (const c of missing) { try { await rateOrFallback(db, c, base); } catch { /* offline */ } }
      if (alive) { setLoading(false); bump((n) => n + 1); }
    })();
    return () => { alive = false; };
  }, [key, base]);
  return { rateFor: (from, to) => (from === to ? 1 : latestCachedRate(db, from, to)?.rate ?? null), loading };
}
