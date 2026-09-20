/**
 * Writes made on behalf of native code (Apple Watch bridge, App Intents, receipt Shortcut).
 * Native code must not touch the database while JS has it open (two SQLite copies in one process
 * corrupt the WAL — native/KPWrites.swift), so it sends the write here and waits for the answer.
 */
import { createTransaction, fillPending, getRow, payeeHistory, payeeOptions, remove, samePaymentSince, save, suggestCategoryNear, withTripTag } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { KPBridge, type NativeWrite } from "./bridge";
import { localIso } from "./dates";

/** Entries waiting in the Pending queue: the app's badge, and what a native write is told after it lands. */
export function pendingCount(): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0 AND pending=1`)?.n ?? 0;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

async function apply(w: NativeWrite): Promise<Record<string, unknown>> {
  switch (w.op) {
    case "addTransaction": {
      const id = String(w.id);
      // The watch may deliver the same entry twice (a reply that timed out, then the queued transfer).
      if (getRow(db, "transactions", id)) return {};
      mutate((d) => createTransaction(d, {
        id, account_id: String(w.account_id), date: str(w.date) ?? localIso(), amount_minor: Number(w.amount_minor),
        category_id: str(w.category_id), payee: str(w.payee), notes: str(w.note),
        tag_ids: JSON.stringify(withTripTag(d, Array.isArray(w.tag_ids) ? w.tag_ids.map(String) : [])),
        pending: w.pending ? 1 : 0, lat: num(w.lat), lon: num(w.lon), place: str(w.place), source: str(w.source),
        // A payment the bank printed in another currency: what it charged, and the rate it was
        // expressed at, so the row can be checked rather than taken on trust.
        entered_amount_minor: num(w.entered_amount_minor), entered_currency: str(w.entered_currency), exchange_rate: num(w.exchange_rate),
      }));
      // What the badge on the app icon should read now. Native code cannot count it for itself
      // while JS has the database open, and the notification it is about to post carries the number.
      return { pending: pendingCount() };
    }
    case "delete":
      mutate((d) => remove(d, "transactions", String(w.id)));
      return {};
    case "updatePlace":
      mutate((d) => {
        const row = getRow(d, "transactions", String(w.id));
        if (row && !row.deleted && !row.place) save(d, "transactions", { ...row, place: String(w.place) });
      });
      return {};
    case "suggest": {
      // Native code can't touch SQLite while JS owns the database (see scratchpad/STATE-CONTRACT), so
      // the watch/Shortcuts location suggestion is forwarded here instead of read from the state file.
      const hit = suggestCategoryNear(db, Number(w.lat), Number(w.lon));
      return hit ? { category_id: hit.category_id, place: hit.place } : {};
    }
    case "payee":
    case "payment": {
      // What a logging Shortcut wants to know before it writes, forwarded for the same reason (and
      // absent from the state file, which carries no payees, no notes and no pending rows).
      // The same name, filed by hand once: exact shop name, then the note, then the shop's first word,
      // so different branches of one chain ("ZABKA ZE212 K.5" / "ZABKA NANO 3087") still find each
      // other. Tags and the name's last known location come back too.
      const hist = payeeHistory(db, str(w.payee), str(w.note));
      const reply: Record<string, unknown> = {
        category_id: hist.category_id ?? undefined, tag_ids: hist.tag_ids,
        place: hist.place ?? undefined, lat: hist.lat ?? undefined, lon: hist.lon ?? undefined,
        // How many different ways this name was filed before. More than one and the automation has no
        // business picking for you: the entry stays pending so the sheet can ask which it was.
        variants: payeeOptions(db, str(w.payee), str(w.note)).length,
      };
      if (w.op === "payment") {
        // Wallet and the bank app both notify the same tap, and iOS can re-deliver a notification.
        // Only the fields the intent needs cross the bridge, so it can fill the gaps of one that is
        // still pending; a twin at all means the charge is logged and nothing new is written.
        const sinceIso = localIso(new Date(Date.now() - Math.max(1, Number(w.within_minutes) || 1) * 60_000));
        const t = samePaymentSince(db, { account_id: String(w.account_id), amount_minor: Number(w.amount_minor), sinceIso });
        if (t) reply.twin = { id: t.id, payee: t.payee, place: t.place, category_id: t.category_id, pending: t.pending };
      }
      return reply;
    }
    case "fillIn": {
      // The second notification for one payment knows things the first did not (Wallet has the tidy
      // shop name, the bank app the city). Only empty fields are written — never an overwrite — and
      // `confirm` takes a row history already recognises out of the pending queue.
      mutate((d) => fillPending(d, String(w.id), {
        payee: str(w.payee), place: str(w.place), category_id: str(w.category_id),
        tag_ids: Array.isArray(w.tag_ids) ? w.tag_ids.map(String) : null, lat: num(w.lat), lon: num(w.lon),
      }, w.confirm === true));
      return {};
    }
    default:
      throw new Error(`Unknown native write: ${String(w.op)}`);
  }
}

/** Start answering native write requests. Call once, as early as possible (before any watch message can arrive). */
export function installNativeWrites(): () => void {
  return KPBridge.onNativeWrite((w) => {
    void apply(w).then(
      (reply) => KPBridge.finishNativeWrite(w.request, true, null, reply),
      (e: unknown) => KPBridge.finishNativeWrite(w.request, false, e instanceof Error ? e.message : String(e)),
    );
  });
}
