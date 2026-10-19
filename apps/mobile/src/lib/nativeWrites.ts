/**
 * Writes made on behalf of native code (Apple Watch bridge, App Intents, receipt Shortcut).
 * Native code must not touch the database while JS has it open (two SQLite copies in one process
 * corrupt the WAL — native/KPWrites.swift), so it sends the write here and waits for the answer.
 */
import { AppState } from "react-native";
import { approvePending, claimRecurring, createTransaction, fillPending, getRow, listRows, pairTransferLeg, pairTransferLegs, payeeHistory, payeeOptions, photoInUse, remove, samePaymentSince, save, suggestCategoryAt, withTripTag, writeBankRef, type PairOutcome } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, notifyChange } from "@/store";
import { KPBridge, type NativeWrite } from "./bridge";
import { localIso, todayLocal } from "./dates";
import { waitDefaultDays } from "./settings";
import { acctName } from "./names";
import { deletePhoto } from "./photos";

/** Entries waiting in the Pending queue: the app's badge, and what a native write is told after it lands. */
export function pendingCount(): number {
  return db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0 AND pending=1`)?.n ?? 0;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * What pairing made of a notification-written row, for the notification the automation posts next
 * (native/KopiykaIntents.swift): a transfer between two named accounts, or a repeat of a
 * notification already logged — which `pairTransferLeg` has just deleted, so there is nothing to say.
 */
function transferReply(p: PairOutcome): Record<string, unknown> {
  if (!p) return {};
  if (p.kind === "duplicate") return { duplicate: true };
  const legs = listRows(db, "transactions", "deleted=0 AND transfer_id=?", [p.transfer_id]);
  const out = legs.find((l) => l.amount_minor < 0), into = legs.find((l) => l.amount_minor > 0);
  const name = (accountId: string | undefined) => { const a = accountId ? getRow(db, "accounts", accountId) : null; return a ? acctName(a) : ""; };
  return { transfer: { kind: p.kind, id: p.transfer_id, from: name(out?.account_id), to: name(into?.account_id) } };
}

async function apply(w: NativeWrite): Promise<Record<string, unknown>> {
  switch (w.op) {
    case "addTransaction": {
      const id = String(w.id);
      // The watch may deliver the same entry twice (a reply that timed out, then the queued transfer).
      if (getRow(db, "transactions", id)) return {};
      let paired: PairOutcome = null;
      mutate((d) => {
        const row = createTransaction(d, {
          id, account_id: String(w.account_id), date: str(w.date) ?? localIso(), amount_minor: Number(w.amount_minor),
          category_id: str(w.category_id), payee: str(w.payee), notes: str(w.note), bank_note: str(w.bank_note),
          tag_ids: JSON.stringify(withTripTag(d, Array.isArray(w.tag_ids) ? w.tag_ids.map(String) : [])),
          pending: w.pending ? 1 : 0, lat: num(w.lat), lon: num(w.lon), place: str(w.place), source: str(w.source),
          // A payment the bank printed in another currency: what it charged, and the rate it was
          // expressed at, so the row can be checked rather than taken on trust.
          entered_amount_minor: num(w.entered_amount_minor), entered_currency: str(w.entered_currency), exchange_rate: num(w.exchange_rate),
          // The account numbers a bank notification printed: how the two notifications of one
          // transfer between your own accounts find each other (core transferPair.ts).
          bank_ref: writeBankRef({ own: str(w.bank_own), other: str(w.bank_other), balance: num(w.bank_balance) }),
        });
        // The charge a recurring rule has been waiting for: it takes the rule's id, category and
        // tags and moves the rule on, so the rule never writes the same payment a second time.
        claimRecurring(d, row, { today: todayLocal(), waitDefault: waitDefaultDays() });
        // The other half of a transfer: a debit and a credit between your own accounts become one
        // pending transfer instead of an expense and an income. A claimed recurring charge is not one.
        if (!getRow(d, "transactions", id)?.recurring_id) paired = pairTransferLeg(d, id);
      });
      // What the badge on the app icon should read now. Native code cannot count it for itself
      // while JS has the database open, and the notification it is about to post carries the number.
      // Pairing may have moved the row to the account its number names (core `rehome`): the
      // automation's notice then says that account and the bank's own amount, not the ones it guessed.
      const now = getRow(db, "transactions", id);
      const acc = now && now.account_id !== String(w.account_id) ? getRow(db, "accounts", now.account_id) : null;
      const moved = acc && now ? { moved: { account: acctName(acc), currency: acc.currency, amount_minor: now.amount_minor } } : {};
      return { pending: pendingCount(), ...moved, ...transferReply(paired) };
    }
    case "delete": {
      const row = getRow(db, "transactions", String(w.id));
      mutate((d) => remove(d, "transactions", String(w.id)));
      // The photo goes with the last entry holding it, as when one is deleted in the app (DATA.md rule 4).
      if (row?.photo && !photoInUse(db, row.photo, row.id)) deletePhoto(row.photo);
      return {};
    }
    case "approve":
      // The watch's Approve: filed under the category it chose first (a plain entry only — a transfer
      // keeps its own), then approved as the Pending screen approves, both legs and the account numbers.
      mutate((d) => {
        const row = getRow(d, "transactions", String(w.id));
        if (!row || row.deleted) return;
        const cat = str(w.category_id);
        if (cat && !row.transfer_id) save(d, "transactions", { ...row, category_id: cat, debt_id: null });
        approvePending(d, [row.id]);
      });
      return { pending: pendingCount() };
    case "updatePlace":
      mutate((d) => {
        const row = getRow(d, "transactions", String(w.id));
        if (row && !row.deleted && !row.place) save(d, "transactions", { ...row, place: String(w.place) });
      });
      return {};
    case "suggest": {
      // Native code can't touch SQLite while JS owns the database (see scratchpad/STATE-CONTRACT), so
      // the watch/Shortcuts location suggestion is forwarded here instead of read from the state file.
      // With a place name (the automation's placemark) this is "what have I filed at this shop
      // before", falling back to the coordinate search; the watch sends no name and only gets the latter.
      const hit = suggestCategoryAt(db, { lat: Number(w.lat), lon: Number(w.lon), place: str(w.place) });
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
        // Whether it was this very name or only one starting with the same word: the automation
        // trusts the first and treats the second as a guess.
        match: hist.match ?? undefined,
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

/**
 * Pair the transfer legs the automation wrote straight into the database while the app was closed
 * (core `pairTransferLegs`). Only a sweep that changed something counts as a write, or every return to
 * the app would mark the database dirty for nothing (DATA.md rule 12).
 */
function sweepTransfers(): void {
  try {
    if (db.transaction(() => pairTransferLegs(db)) > 0) notifyChange();
  } catch { /* a sweep is a nicety; the rows are still there, unpaired, for the next one */ }
}

/** Start answering native write requests. Call once, as early as possible (before any watch message can arrive). */
export function installNativeWrites(): () => void {
  sweepTransfers();
  const appState = AppState.addEventListener("change", (s) => { if (s === "active") sweepTransfers(); });
  const off = KPBridge.onNativeWrite((w) => {
    void apply(w).then(
      (reply) => KPBridge.finishNativeWrite(w.request, true, null, reply),
      (e: unknown) => KPBridge.finishNativeWrite(w.request, false, e instanceof Error ? e.message : String(e)),
    );
  });
  return () => { off(); appState.remove(); };
}
