/**
 * Everything the Apple Watch needs to log and browse offline, written to `watch-state.json`
 * next to the widget snapshot. Native code reads this file instead of opening SQLite while JS
 * owns the database (two SQLite copies in one process corrupt the WAL — see native/KPWrites.swift
 * and native/KPShared.swift `KPStore`/`KPWatchState`, which this mirrors field-for-field).
 * Rebuilt after every write, so this stays a handful of grouped queries — no per-row round-trips.
 */
import { fromMinor, getHome, iconFor, jsonIds } from "@kopiyka/core";
import { db } from "@/db";
import { getCurrentAccount, getLocationEnabled, getShortcutNotify } from "./settings";
import type { WidgetSnapshot } from "./widget";

export interface WatchCategory {
  id: string; name: string; parent_id: string | null; parent_name: string | null; kind: string;
  icon: string | null; color: string | null; uses: number; description: string | null;
  /** Retired in the app: still named on the history rows that carry it, never offered for a new one. */
  archived: boolean;
}
export interface WatchTag { id: string; name: string; color: string | null; category_ids: string[]; uses: number; archived: boolean }
export interface WatchTx {
  id: string; date: string; title: string; sub: string; amount: number; currency: string;
  account_id: string; category_id: string | null; tag_ids: string[]; pending: boolean; transfer: boolean;
}

export interface WatchState {
  generated_at: string;
  current_account: string;
  accounts: WidgetSnapshot["accounts"];
  categories: WatchCategory[];
  tags: WatchTag[];
  /** category_id -> tag_id -> count, over all non-deleted transactions with tags (no date limit). */
  together: Record<string, Record<string, number>>;
  history: WatchTx[];
  snapshot: WidgetSnapshot;
  location_enabled: boolean;
  /** Whether the Shortcut automation may post a notification: the intent reads it from here while JS owns the database. */
  shortcut_notify: boolean;
  home: { lat: number; lon: number } | null;
  /** "BASE>QUOTE" -> rate, newest cached row per pair, both directions as stored. */
  rates: Record<string, number>;
}

/** yyyy-mm-dd, 180 days ago: the usage window the app's own pickers use. */
function sinceDay(): string {
  return new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Archived categories and tags travel with a flag rather than being left out: a history row still
 * has to be able to print the name it was filed under. What must not happen is being *offered* one,
 * and that is decided in one place on the other side — `KPRank.categories` / `KPRank.tags`, which
 * every intent, the watch and the receipt reader go through.
 */
export function buildWatchState(snapshot: WidgetSnapshot): WatchState {
  const t0 = __DEV__ ? Date.now() : 0;
  const since = sinceDay();

  const categories: WatchCategory[] = db.all<{
    id: string; name: string; parent_id: string | null; parent_name: string | null; kind: string;
    icon: string | null; color: string | null; description: string | null; uses: number; archived: number;
  }>(
    `SELECT c.id, c.name, c.parent_id, p.name AS parent_name, c.kind, c.icon, c.color, c.description, c.archived,
       (SELECT COUNT(*) FROM transactions t WHERE t.deleted=0 AND t.category_id=c.id AND t.date>=?) AS uses
     FROM categories c LEFT JOIN categories p ON p.id=c.parent_id
     WHERE c.deleted=0 ORDER BY c.sort, c.name`,
    [since],
  ).map((c) => {
    const m = iconFor(c.name, { icon: c.icon, color: c.color });
    return { id: c.id, name: c.name, parent_id: c.parent_id, parent_name: c.parent_name, kind: c.kind, icon: m.icon, color: m.color, uses: c.uses, description: c.description, archived: !!c.archived };
  });

  // One pass over every tagged transaction: last-180-day usage per tag, all-time category<->tag co-occurrence.
  const tagUses = new Map<string, number>();
  const together: WatchState["together"] = {};
  for (const r of db.all<{ category_id: string | null; tag_ids: string; date: string }>(
    `SELECT category_id, tag_ids, date FROM transactions WHERE deleted=0 AND tag_ids<>'[]'`,
  )) {
    const recent = r.date >= since;
    for (const id of jsonIds(r.tag_ids)) {
      if (recent) tagUses.set(id, (tagUses.get(id) ?? 0) + 1);
      if (r.category_id) { const byTag = (together[r.category_id] ??= {}); byTag[id] = (byTag[id] ?? 0) + 1; }
    }
  }
  const tags: WatchTag[] = db.all<{ id: string; name: string; color: string | null; category_ids: string; archived: number }>(
    `SELECT id, name, color, category_ids, archived FROM tags WHERE deleted=0 ORDER BY name`,
  ).map((t) => ({ id: t.id, name: t.name, color: t.color, category_ids: jsonIds(t.category_ids), uses: tagUses.get(t.id) ?? 0, archived: !!t.archived }));

  const history: WatchTx[] = db.all<{
    id: string; date: string; amount_minor: number; currency: string; account_name: string; account_id: string;
    category_id: string | null; cat_name: string | null; parent_name: string | null; notes: string | null; payee: string | null;
    tag_ids: string; pending: number; transfer_id: string | null;
  }>(
    `SELECT t.id, t.date, t.amount_minor, a.currency, a.name AS account_name, t.account_id, t.category_id,
       c.name AS cat_name, p.name AS parent_name, t.notes, t.payee, t.tag_ids, t.pending, t.transfer_id
     FROM transactions t JOIN accounts a ON a.id=t.account_id
     LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN categories p ON p.id=c.parent_id
     WHERE t.deleted=0 ORDER BY t.date DESC, t.updated_at DESC LIMIT 50`,
  ).map((r) => {
    const transfer = r.transfer_id != null;
    const note = r.notes?.split("\n")[0] ?? "";
    const title = transfer ? "Transfer" : note || r.payee || r.cat_name || r.parent_name || "Uncategorized";
    const catLabel = transfer ? null : r.cat_name ? (r.parent_name ? `${r.parent_name} › ${r.cat_name}` : r.cat_name) : r.parent_name;
    const sub = [r.account_name, catLabel].filter((x): x is string => !!x).join(" · ");
    return {
      id: r.id, date: r.date, title, sub, amount: fromMinor(r.amount_minor, r.currency), currency: r.currency,
      account_id: r.account_id, category_id: r.category_id, tag_ids: jsonIds(r.tag_ids), pending: r.pending === 1, transfer,
    };
  });

  // SQLite's documented "bare column" rule: with a single MAX() aggregate, the other selected
  // columns come from the row that produced it — the newest rate per (base, quote) in one pass.
  const rates: WatchState["rates"] = {};
  for (const r of db.all<{ base: string; quote: string; rate: number }>(`SELECT base, quote, rate, MAX(day) FROM exchange_rates GROUP BY base, quote`)) {
    rates[`${r.base}>${r.quote}`] = r.rate;
  }

  const home = getHome(db);
  const state: WatchState = {
    generated_at: new Date().toISOString(),
    current_account: getCurrentAccount(),
    accounts: snapshot.accounts,
    categories, tags, together, history, snapshot,
    location_enabled: getLocationEnabled(),
    shortcut_notify: getShortcutNotify(),
    home: home ? { lat: home.lat, lon: home.lon } : null,
    rates,
  };
  if (__DEV__) console.log(`[watchState] built in ${Date.now() - t0}ms (${categories.length} categories, ${tags.length} tags, ${history.length} history rows)`);
  return state;
}
