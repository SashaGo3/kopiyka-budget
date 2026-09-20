import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, LayoutAnimation, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { accountBalanceMinor, applyReturn, checkReturn, clearReturns, createTransaction, getRow, listRows, paidAmountMinor, payeeOptions, photoInUse, rateOrFallback, remove, save, shareEntered, splitAmounts, suggestCategoryAt, toMinor, fromMinor, formatMinor, iconFor, jsonIds, trimNumber, withTripTag, type SplitPart, type Transaction } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, CalcLine, ConfirmBar, applyKeySigned, evalPartial, negateExpr } from "@/components/Keypad";
import { Chip, ChipRow, Segmented, SheetFrame, TagPill, accountIcon } from "@/components/ui";
import { copyToClipboard } from "@/lib/device";
import { C, S } from "@/constants/theme";
import { dayLabel, dayWithNow, localIso, timeLabel, todayLocal, withTime } from "@/lib/dates";
import { ensureLocationPermission, placeName, quickLocation, type Coords } from "@/lib/location";
import { getCurrentAccount, getLocationEnabled, getShowBalance, setLocationEnabled } from "@/lib/settings";
import { RECEIPT_SCANNER_ENABLED } from "@/constants/features";
import { markSheetPainted } from "@/lib/boot";
import { deletePhoto, keepPhoto, photoUri } from "@/lib/photos";
import type { ReceiptParse } from "@/lib/bridge";
import type { SplitResult } from "./split";

type Kind = "expense" | "income" | "transfer";
type Params = { id: string; account?: string; category?: string; amount?: string; kind?: Kind; note?: string; tags?: string; receipt?: string;
  // Carried by Duplicate below, so a copy opens as the same entry whether or not the sheet remounts.
  date?: string; payee?: string; place?: string; lat?: string; lon?: string; pending?: string };

/**
 * Entry sheet: amount hero, a left-aligned details column (date, note, place, tags), the
 * account pill (icon + name; the balance before → after stays folded until unwrapped, so
 * screenshots show no numbers, unless Settings → Show balance when logging says otherwise),
 * type control, chips, keypad with Category + Tags keys and
 * the tap-to-add bar. Closing with an amount typed asks first. Saving a row that arrived pending
 * approves it: going through this sheet is the review, and the Pending chip is there to say
 * otherwise.
 *
 * The amount field shows what the sum comes to and spells the sum out underneath (there is no "="
 * key), and tapping it copies the number. The Return chip does not add anything: it takes the amount
 * typed as money that came *back* and books it against an earlier expense (packages/core/returns.ts).
 */
export default function TransactionSheet() {
  const p = useLocalSearchParams<Params>();
  const navigation = useNavigation();
  const isNew = p.id === "new";
  const existing = useMemo(() => (isNew ? null : getRow(db, "transactions", p.id) ?? null), [isNew, p.id]);

  const accounts = useQuery((d) => listRows(d, "accounts", "deleted=0 AND archived=0", [], "sort, name"));
  const [accountId, setAccountId] = useState(existing?.account_id || p.account || getCurrentAccount() || accounts[0]?.id || "");
  // The expression IS the signed money (expenses negative); `defaultMode` only matters while
  // it's empty or doesn't evaluate — otherwise `kind` below is derived from its sign.
  const [defaultMode, setDefaultMode] = useState<"expense" | "income">(existing ? (existing.amount_minor >= 0 ? "income" : "expense") : p.kind === "income" ? "income" : "expense");
  const [expr, setExpr] = useState(() => {
    if (existing) return trimNumber(fromMinor(existing.amount_minor, getRow(db, "accounts", existing.account_id)?.currency ?? "EUR"));
    if (!p.amount) return "";
    return defaultMode === "expense" ? `−${p.amount}` : p.amount; // prefilled amount is a magnitude
  });
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? p.category ?? null);
  const [suggested, setSuggested] = useState(false);
  // Travel mode: new entries start with the trip tag (removable like any other).
  const [tagIds, setTagIds] = useState<string[]>(() => existing ? jsonIds(existing.tag_ids) : withTripTag(db, p.tags ? p.tags.split(",").filter(Boolean) : []));
  const [date, setDate] = useState(existing?.date ?? p.date ?? localIso());
  // A row logged by a Shortcut carries its shop in `payee` and nothing in `notes`, so the Note field
  // would open empty on the one kind of entry that always has something to say. The list shows the
  // note first and falls back to the payee (components/TransactionList.tsx), so seeding the note with
  // the payee puts the same words in the field that the row is already listed under — and renaming it
  // from here now changes the row's title, with the shop kept underneath it as the payee line.
  const [note, setNote] = useState(existing?.notes ?? existing?.payee ?? p.note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  // iOS drops the caret at the end of the text when a field takes focus, which opens a long note
  // scrolled past its first words. Pin the selection to the start for the moment focus lands and
  // then let go, so the note opens at its beginning and behaves like an ordinary field afterwards.
  const [caret, setCaret] = useState<{ start: number; end: number } | undefined>(undefined);
  const openNote = () => { setCaret({ start: 0, end: 0 }); setNoteOpen(true); };
  // The shop a Shortcut or a receipt filed this under. No field of its own — it is carried so that
  // saving keeps it and Duplicate copies it.
  const [payee] = useState<string | null>(existing?.payee ?? p.payee ?? null);
  // Opening the sheet on a pending row *is* the review, so the chip starts off and saving approves it:
  // the state here is what will be stored, not what is stored now. Turning the chip back on keeps the
  // row in the Pending queue — the only way an edited row stays pending.
  const [pending, setPending] = useState(existing ? false : p.pending === "1");
  const [coords, setCoords] = useState<Coords | null>(
    existing && existing.lat != null && existing.lon != null ? { lat: existing.lat, lon: existing.lon }
      : !existing && p.lat && p.lon ? { lat: Number(p.lat), lon: Number(p.lon) } : null);
  const [place, setPlace] = useState<string | null>(existing?.place ?? p.place ?? null);
  // Attached photo: `photo` is the stored file name, `shot` a freshly captured temporary file (kept on save).
  const [photo, setPhoto] = useState<string | null>(existing?.photo ?? null);
  const [shot, setShot] = useState<string | null>(null);
  // The parts carved off this entry. The entry itself is the first part and keeps what is left, so
  // the amount on the keypad stays the receipt total; these are only the *other* ones. They are
  // written as their own transactions on save and nothing links them afterwards (core/split.ts).
  const [parts, setParts] = useState<SplitPart[]>([]);
  const noteRef = useRef<TextInput>(null);
  // Unwrapped from the start when the preference says so (Settings → Preferences → Show balance
  // when logging); the chevron still folds it back for this one entry without changing the setting.
  const [expanded, setExpanded] = useState(getShowBalance);   // balance numbers unwrapped
  const [done, setDone] = useState(false);       // saved or discarded: no prompt on close
  const [stacked, setStacked] = useState(false); // transfer sheet on top: its save closes both

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const currency = account?.currency ?? "EUR";
  const balance = useQuery((d) => (account ? accountBalanceMinor(d, account.id) : 0), [account?.id]);
  const category = useQuery((d) => {
    if (!categoryId) return null;
    const c = getRow(d, "categories", categoryId);
    const parent = c?.parent_id ? getRow(d, "categories", c.parent_id) : null;
    return c ? { ...c, parentName: parent?.name ?? null } : null;
  }, [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((tag) => tagIds.includes(tag.id)), [tagIds.join(",")]);

  // ---- "What was it this time?" ------------------------------------------------------------------
  // A petrol station sells fuel, a hot dog and a bottle of something, and history can only ever
  // repeat whichever of them came last. So when this name has been filed more than one way before,
  // every one of those ways is offered as a chip: one tap sets that category *and* its tags together,
  // because the pair is the past decision. One way, or none, is nothing to ask about — the Category
  // key is right there for anything new.
  const catNames = useQuery((d) => new Map(listRows(d, "categories", "deleted=0").map((c) => [c.id, c.name])), []);
  const tagNames = useQuery((d) => new Map(listRows(d, "tags", "deleted=0").map((x) => [x.id, x.name])), []);
  const filed = useQuery((d) => payeeOptions(d, payee, note.trim() || null), [payee, note.trim()]);
  // A category or tag that has since been deleted is not an option any more: the tag is dropped from
  // the pairing, and a pairing whose category is gone is dropped whole. Two pairings that differ only
  // by a tag nobody kept are then the same pairing, and are shown once.
  const options = useMemo(() => {
    const seen = new Set<string>();
    return filed.flatMap((o) => {
      if (o.category_id && !catNames.has(o.category_id)) return [];
      const tag_ids = o.tag_ids.filter((x) => tagNames.has(x));
      const key = `${o.category_id ?? ""}|${tag_ids.join(",")}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ ...o, tag_ids, key }];
    });
  }, [filed, catNames, tagNames]);
  const sameAsNow = (o: { category_id: string | null; tag_ids: string[] }) =>
    o.category_id === categoryId && o.tag_ids.length === tagIds.length && o.tag_ids.every((x) => tagIds.includes(x));

  // The expression is the signed amount; `kind` follows its sign, falling back to the stored default
  // while it is empty. `evalPartial` rather than `evalExpr`, because with no "=" key the field has to
  // mean something the moment an operator is typed: "90−" is 90 until the next digit lands, and what
  // the field shows is what the bar adds.
  const raw = evalPartial(expr);
  const value = raw !== null ? Math.abs(raw) : null;
  // With a split, the parts have to leave the entry itself something. `splitAmounts` says whether
  // they do, and a total typed down under them is what makes an otherwise fine entry invalid.
  const splitMinors = useMemo(() => (value !== null && parts.length ? splitAmounts(toMinor(value, currency), parts.map((x) => x.amount_minor)) : null), [value, currency, parts]);
  const valid = value !== null && value > 0 && !!account && (!parts.length || !!splitMinors);
  const sign = raw === null ? null : raw > 0 ? 1 : raw < 0 ? -1 : 0;
  const kind: "expense" | "income" = sign === 1 ? "income" : sign === -1 ? "expense" : defaultMode;
  const signChar = kind === "expense" ? "−" : "+";
  const signed = value !== null ? toMinor(value, currency) * (kind === "expense" ? -1 : 1) : 0;
  const after = balance + signed - (existing && existing.account_id === account?.id ? existing.amount_minor : 0);

  const keys = useMemo(() => ({ cat: newPickKey("cat"), acc: newPickKey("acc"), tags: newPickKey("tags"), date: newPickKey("date"), time: newPickKey("time"), loc: newPickKey("loc"), receipt: newPickKey("receipt"), shot: newPickKey("shot"), photo: newPickKey("photo"), ret: newPickKey("ret"), split: newPickKey("split") }), []);
  usePickResult<string>(keys.shot, useCallback((uri: string) => { setShot(uri); }, []));
  usePickResult<boolean>(keys.photo, useCallback(() => { setShot(null); setPhoto(null); }, []));
  const photoSrc = shot ?? (photo ? photoUri(photo) : null);
  const openPhoto = () => photoSrc ? router.push({ pathname: "/photo/view", params: { uri: photoSrc, key: keys.photo } }) : router.push({ pathname: "/photo/capture", params: { key: keys.shot } });
  // A photographed receipt fills amount, category, note and place; the amount converts when the receipt is in another currency.
  const applyReceipt = (r: ReceiptParse) => {
    const apply = (amount: number) => setExpr(`−${Math.round(amount * 100) / 100}`); // a receipt is always an expense
    if (r.category_id) { setCategoryId(r.category_id); setSuggested(false); }
    if (r.merchant) setPlace((cur) => cur ?? r.merchant);
    if (r.summary) setNote(r.summary);
    if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date !== todayLocal()) setDate(dayWithNow(r.date));
    setDefaultMode("expense");
    if (r.currency && r.currency !== currency) {
      void rateOrFallback(db, r.currency, currency).then((x) => { if (x) apply(r.total * x.rate); else { apply(r.total); Alert.alert(`Receipt is in ${r.currency!}`, "No exchange rate available offline; the number was kept as is."); } }).catch(() => apply(r.total));
    } else apply(r.total);
  };
  usePickResult<ReceiptParse>(keys.receipt, applyReceipt);
  // Opened from the Log button's long press with the receipt already read.
  useEffect(() => { if (isNew && p.receipt) { try { applyReceipt(JSON.parse(p.receipt) as ReceiptParse); } catch { /* ignore */ } } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => { setCategoryId(v); setSuggested(false); }, []));
  usePickResult<string>(keys.acc, (v: string) => {
    const next = accounts.find((a) => a.id === v), prev = account;
    setAccountId(v);
    if (!next || !prev || next.currency === prev.currency || value === null) return;
    Alert.alert(`Convert to ${next.currency}?`,
      `The amount is ${formatMinor(toMinor(value, prev.currency), prev.currency)} ${prev.currency}. ${next.name} is in ${next.currency}.`, [
        { text: "Keep the number", style: "cancel" },
        { text: `Convert to ${next.currency}`, onPress: () => { void rateOrFallback(db, prev.currency, next.currency).then((r) => { if (!r) { Alert.alert("No exchange rate available offline"); return; } const converted = Math.round(value * r.rate * 100) / 100; setExpr(kind === "expense" ? `−${converted}` : String(converted)); }).catch(() => Alert.alert("No exchange rate available offline")); } },
      ]);
  });
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  // Splitting needs a total to share out, so the amount comes first — and the editor is given the
  // entry's own category and tags as the first part, because that part is this entry.
  const openSplit = () => {
    if (value === null || value <= 0) { Alert.alert("Type the total first", "A split shares out the amount on the entry, so there has to be one."); return; }
    router.push({ pathname: "/transaction/split", params: {
      key: keys.split, currency, kind, total: String(toMinor(value, currency)),
      main: JSON.stringify({ category_id: categoryId, tag_ids: tagIds }), parts: JSON.stringify(parts),
    } });
  };
  usePickResult<SplitResult>(keys.split, useCallback((r: SplitResult) => {
    setCategoryId(r.main.category_id);
    setSuggested(false);
    setTagIds(r.main.tag_ids);
    setParts(r.parts);
  }, []));
  usePickResult<string>(keys.date, useCallback((day: string) => setDate((d) => (day === d.slice(0, 10) ? d : day === todayLocal() ? localIso() : dayWithNow(day))), []));
  usePickResult<string>(keys.time, useCallback((hhmm: string) => setDate((d) => withTime(d, hhmm)), []));
  usePickResult<(Coords & { place: string | null }) | null>(keys.loc, useCallback((v: (Coords & { place: string | null }) | null) => { setCoords(v ? { lat: v.lat, lon: v.lon } : null); setPlace(v?.place ?? null); }, []));

  // ---- Money that came back ---------------------------------------------------------------------
  // You paid for the table and someone hands you their share. That is not a new entry: it makes the
  // original expense smaller. So the amount typed here is taken as the part coming back, an earlier
  // entry is chosen, and the return is booked on it — this sheet adds nothing and closes.
  //
  // The direction comes from the chosen row rather than from the sign typed here, so it works whether
  // the user reached for Expense or Income first; the picker only offers rows the return can fit in,
  // in this account's currency, since converting money back would need a rate and a conversation.
  const returnMinor = value !== null ? toMinor(value, currency) : 0;
  const askForReturn = () => {
    if (!valid) { Alert.alert("Type the amount that came back", "Enter how much you were paid back, then choose the entry it belongs to."); return; }
    router.push({ pathname: "/pick/transaction", params: {
      key: keys.ret, title: "What is this money from?",
      desc: `You paid, and ${formatMinor(returnMinor, currency)} ${currency} came back. Choose the entry it belongs to and it shrinks by that much — no new transaction is added.`,
      returnMinor: String(returnMinor), currency,
    } });
  };
  usePickResult<string>(keys.ret, (id: string) => {
    const target = getRow(db, "transactions", id);
    if (!target) return;
    // Towards zero, whichever way the chosen row points: money back on an expense, money returned on income.
    const delta = target.amount_minor < 0 ? returnMinor : -returnMinor;
    const check = checkReturn(db, id, delta);
    if (!check.ok) { Alert.alert("That entry cannot take this return", returnReason(check.reason)); return; }
    const name = target.notes?.split("\n")[0] || target.payee || "that entry";
    const cur = getRow(db, "accounts", target.account_id)?.currency ?? currency;
    Alert.alert(`Book ${formatMinor(returnMinor, currency)} ${currency} back?`,
      `${name}: ${formatMinor(target.amount_minor, cur)} → ${formatMinor(check.amount_minor, cur)} ${cur}`, [
        { text: "Cancel", style: "cancel" },
        { text: "Book it", onPress: () => {
          try { mutate((d) => applyReturn(d, id, delta)); } catch (e) { Alert.alert("Could not book the return", (e as Error).message); return; }
          setDone(true);
          router.back();
        } },
      ]);
  });
  // On an entry that already has returns: the amount it was paid at, and a way back out of a mistype.
  const refunded = existing?.refunded_minor ?? 0;
  const undoReturns = () => existing && Alert.alert("Forget the returns?",
    `${formatMinor(paidAmountMinor(existing), currency)} ${currency} goes back on the entry, as if nothing had come back.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Forget them", style: "destructive", onPress: () => { mutate((d) => clearReturns(d, existing.id)); setDone(true); router.back(); } },
    ]);

  // Tapping the amount copies it, plain and ungrouped so it pastes into anything.
  const [copied, setCopied] = useState(false);
  const copyAmount = () => {
    if (value === null) return;
    const text = formatMinor(toMinor(value, currency) * (kind === "expense" ? -1 : 1), currency, { grouping: "" });
    if (!copyToClipboard(text)) return;
    void Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  // Boot trace: the frame after this sheet first commits (a cold `kopiyka://log` launch's target). See lib/boot.ts's `bootTrace`.
  useEffect(() => {
    const id = requestAnimationFrame(markSheetPainted);
    return () => cancelAnimationFrame(id);
  }, []);
  useFocusEffect(useCallback(() => { setStacked(false); }, []));
  const unwrap = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpanded((v) => !v); };

  /** What the category field holds, for the async suggestion below to read without going stale. */
  const chosenCategory = useRef(categoryId);
  useEffect(() => { chosenCategory.current = categoryId; }, [categoryId]);
  /**
   * Coarse location for new entries: attach it, and suggest the category used here before.
   *
   * Twice, deliberately. The coordinate search answers immediately and is what there is to go on
   * while the geocoder is still thinking — or forever, offline. The name it comes back with is the
   * better question ("have I filed anything at Biedronka before?" rather than "what do I usually buy
   * within 80 m?"), so when it lands the suggestion is asked again and upgraded.
   *
   * The upgrade only ever replaces a blank or a suggestion of our own: a category picked by hand in
   * the meantime is an answer, and nothing here is allowed to move it.
   */
  useEffect(() => {
    if (!isNew) return;
    let alive = true;
    let offered: string | null = null;
    const offer = (id: string) => {
      if (!alive || (chosenCategory.current && chosenCategory.current !== offered)) return;
      offered = id;
      chosenCategory.current = id;
      setCategoryId(id);
      setSuggested(true);
    };
    void quickLocation().then(async (c) => {
      if (!c || !alive) return;
      setCoords((cur) => cur ?? c);
      const near = suggestCategoryAt(db, { lat: c.lat, lon: c.lon });
      if (near) offer(near.category_id);
      const name = near?.place ?? (await placeName(c));
      if (!alive || !name) return;
      setPlace((cur) => cur ?? name);
      const here = suggestCategoryAt(db, { lat: c.lat, lon: c.lon, place: name });
      if (here?.by === "place") offer(here.category_id);
    });
    return () => { alive = false; };
  }, [isNew]);

  const persist = () => {
    if (!valid || !account) return false;
    const minor = toMinor(value!, currency) * (kind === "expense" ? -1 : 1);
    // A new shot replaces the stored file; clearing the photo removes it.
    let photoName = photo;
    if (shot) { try { photoName = keepPhoto(shot); if (existing?.photo) releasePhoto(existing.photo, existing.id); } catch { photoName = photo; } }
    else if (existing?.photo && !photo) releasePhoto(existing.photo, existing.id);
    mutate((d) => {
      const base = { account_id: account.id, date, amount_minor: minor, category_id: categoryId, payee, notes: note.trim() || null, tag_ids: JSON.stringify(tagIds), pending: pending ? 1 : 0, lat: coords?.lat ?? null, lon: coords?.lon ?? null, place, photo: photoName } as const;
      if (!parts.length || !splitMinors) {
        if (existing) save(d, "transactions", { ...existing, ...base } as Transaction);
        else createTransaction(d, base);
        return;
      }
      // A split is several ordinary entries: the one being edited keeps its id and what the parts
      // leave it (rule 1 — renaming a row is not the same as replacing it), and each part becomes a
      // new row that differs from it only in amount, category and tags. A foreign original is shared
      // out in the same proportions, so a part still shows what the bank actually charged for it.
      const sign = kind === "expense" ? -1 : 1;
      const entered = existing?.entered_amount_minor ? shareEntered(existing.entered_amount_minor, splitMinors) : null;
      const shared = { account_id: base.account_id, date, payee, notes: base.notes, pending: base.pending, lat: base.lat, lon: base.lon, place, photo: photoName, source: existing?.source ?? null } as const;
      splitMinors.forEach((magnitude, i) => {
        const money = { amount_minor: magnitude * sign, ...(entered ? { entered_amount_minor: entered[i]!, entered_currency: existing!.entered_currency, exchange_rate: existing!.exchange_rate } : {}) };
        if (i === 0) {
          const first = { ...shared, ...money, category_id: categoryId, tag_ids: JSON.stringify(tagIds) };
          if (existing) save(d, "transactions", { ...existing, ...first } as Transaction);
          else createTransaction(d, first);
          return;
        }
        const part = parts[i - 1]!;
        createTransaction(d, { ...shared, ...money, category_id: part.category_id, tag_ids: JSON.stringify(part.tag_ids) });
      });
    });
    setDone(true);
    return true;
  };
  const commit = () => { if (persist()) router.back(); };
  // Closing with an amount typed (swipe, tap outside, back) asks first; the sheet stays until answered.
  usePreventRemove(isNew && !done && !stacked && !!expr, ({ data }) => {
    Alert.alert("Add this transaction?", valid ? `${formatMinor(toMinor(value!, currency), currency)} ${currency}${category ? ` · ${category.name}` : ""}` : "The amount is not complete yet.", [
      { text: "Discard", style: "destructive", onPress: () => { setDone(true); navigation.dispatch(data.action); } },
      { text: "Keep editing", style: "cancel" },
      ...(valid ? [{ text: "Add", onPress: () => { if (persist()) navigation.dispatch(data.action); } }] : []),
    ]);
  });
  // The same entry again, ready to edit before it is added: a second coffee, the fare back. The sheet is
  // replaced rather than stacked, so the original closes as the copy opens, and every field travels in
  // the params — the photo excepted, because one photo file belongs to the one row that stored it.
  const duplicate = () => existing && Alert.alert("Duplicate this transaction?",
    `${signChar}${formatMinor(toMinor(value ?? 0, currency), currency)} ${currency}${category ? ` · ${category.name}` : ""} opens as a new entry. Nothing is added until you confirm it.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Duplicate", onPress: () => {
        setPhoto(null); setShot(null);
        router.replace({ pathname: "/transaction/[id]", params: {
          id: "new", account: accountId, kind, date,
          ...(value !== null ? { amount: String(value) } : {}),
          ...(categoryId ? { category: categoryId } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(tagIds.length ? { tags: tagIds.join(",") } : {}),
          ...(payee ? { payee } : {}),
          ...(place ? { place } : {}),
          ...(coords ? { lat: String(coords.lat), lon: String(coords.lon) } : {}),
          ...(pending ? { pending: "1" } : {}),
        } });
      } },
    ]);
  const del = () => existing && Alert.alert("Delete transaction?", undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { setDone(true); releasePhoto(existing.photo, existing.id); mutate((d) => remove(d, "transactions", existing.id)); router.back(); } },
  ]);
  // ± and the segmented control both negate the signed expression; on an empty expression
  // there's nothing to negate, so they just switch the default mode instead.
  const negate = () => {
    if (!expr) { setDefaultMode((m) => (m === "expense" ? "income" : "expense")); return; }
    setExpr(negateExpr(expr));
  };
  const changeKind = (k: Kind) => {
    if (k === "transfer") {
      const go = () => { setStacked(true); router.push({ pathname: "/transfer/[id]", params: { id: "new", from: accountId, amount: value !== null ? String(value) : "", stacked: "1" } }); };
      Alert.alert("Make this a transfer?", value !== null ? `${formatMinor(toMinor(value, currency), currency)} ${currency} will be moved to the transfer.` : "Move money between two accounts.", [
        { text: "Cancel", style: "cancel" },
        { text: "Make transfer", onPress: go },
      ]);
      return;
    }
    if (!expr) { setDefaultMode(k); return; }
    if (k !== kind) negate();
  };
  const onKeypadChange = (newExpr: string, key?: string) =>
    setExpr(key !== undefined ? applyKeySigned(expr, key, { negativeDefault: defaultMode === "expense" }) : newExpr);
  const locationOn = useQuery(() => getLocationEnabled());
  const pickLocation = () => router.push({ pathname: "/pick/location", params: { key: keys.loc, ...(coords ? { lat: String(coords.lat), lon: String(coords.lon) } : {}) } });
  // Location stays off until the user says so, and the first tap on Place is that yes: it goes
  // straight to the iOS prompt, whose own text says why the app is asking. A message of ours in
  // front of it, with a way out of it, is what App Review reads as delaying the request
  // (guideline 5.1.1(iv)). Granting it turns the preference on; refusing still opens the picker,
  // where a place can be searched for and pinned by hand without any location access at all.
  const openLocation = () => {
    if (locationOn || coords || place) { pickLocation(); return; }
    void ensureLocationPermission().then((ok) => { if (ok) setLocationEnabled(true); pickLocation(); });
  };

  const signColor = kind === "expense" ? C.label : C.green;
  // The field is the answer, never the keystrokes: the sum itself goes on the line below (CalcLine).
  const shown = value !== null ? formatMinor(toMinor(value, currency), currency) : "0";
  const catIcon = category ? iconFor(category.name, { icon: category.icon, color: category.color }) : null;

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          {existing ? <Pressable onPress={duplicate} hitSlop={10} style={styles.corner} accessibilityRole="button" accessibilityLabel="Duplicate transaction"><SymbolView name="plus.square.on.square" size={16} tintColor={C.tint} /></Pressable> : null}
          {existing ? <Pressable onPress={del} hitSlop={10} style={styles.trash} accessibilityRole="button" accessibilityLabel="Delete transaction"><SymbolView name="trash" size={16} tintColor={C.red} /></Pressable> : null}
          <Pressable onPress={copyAmount} disabled={value === null} style={styles.amountRow} accessibilityRole="button"
            accessibilityLabel={`${expr ? signChar : ""}${shown} ${currency}. Tap to copy.`}>
            <Text style={[styles.amount, { color: expr ? signColor : C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{expr ? signChar : ""}{shown}</Text>
            <Text style={styles.currency}>{currency}</Text>
          </Pressable>
          {copied ? <Text style={[styles.result, { color: C.tint }]}>Copied</Text> : <CalcLine expr={expr} style={styles.result} />}
          <View style={styles.details}>
            {/* The note is the entry's title, so the line shows it whole where it fits and ends in an
                ellipsis where it does not — four lines is as much as the sheet can spare. */}
            <Pressable onPress={openNote} style={[styles.line, styles.noteLine]} accessibilityRole="button" accessibilityLabel={note ? `Note: ${note}` : "Add a note"}>
              <SymbolView name="text.alignleft" size={14} tintColor={C.secondary} /><Text style={[styles.lineText, !note && styles.placeholder]} numberOfLines={4} ellipsizeMode="tail">{note || "Add a note"}</Text>
            </Pressable>
            {/* A place name without coordinates is a location too: a Shortcut automation, a filled-in
                payment or a scanned receipt names the shop without ever pinning it on the map. */}
            {coords || place || locationOn ? (
              <Pressable onPress={openLocation} style={styles.line} accessibilityRole="button" accessibilityLabel={place ?? (coords ? "Location: pinned" : "Add location")}>
                <SymbolView name="mappin.and.ellipse" size={14} tintColor={C.secondary} /><Text style={[styles.lineText, !coords && !place && styles.placeholder]} numberOfLines={1}>{place ?? (coords ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : "Add location")}{suggested ? " · category suggested" : ""}</Text>
              </Pressable>
            ) : null}
            {parts.length && splitMinors ? (
              <Pressable onPress={openSplit} style={styles.line} accessibilityRole="button"
                accessibilityLabel={`Split into ${parts.length + 1} entries. Tap to edit.`}>
                <SymbolView name="square.split.2x1" size={14} tintColor={C.secondary} />
                <Text style={styles.lineText} numberOfLines={2}>
                  {splitMinors.map((minor, i) => `${formatMinor(minor, currency)} ${i === 0 ? (category?.name ?? "this entry") : (catNames.get(parts[i - 1]!.category_id ?? "") ?? "no category")}`).join(" · ")}
                </Text>
              </Pressable>
            ) : null}
            {refunded ? (
              <Pressable onPress={undoReturns} style={styles.line} accessibilityRole="button"
                accessibilityLabel={`${formatMinor(Math.abs(refunded), currency)} ${currency} came back; paid ${formatMinor(Math.abs(paidAmountMinor(existing!)), currency)}. Tap to forget the returns.`}>
                <SymbolView name="arrow.uturn.backward" size={14} tintColor={C.green as unknown as string} />
                <Text style={styles.lineText} numberOfLines={1}>{`${formatMinor(Math.abs(refunded), currency)} came back · paid ${formatMinor(Math.abs(paidAmountMinor(existing!)), currency)}`}</Text>
              </Pressable>
            ) : null}
            {photoSrc ? (
              <Pressable onPress={openPhoto} style={styles.line} accessibilityRole="button" accessibilityLabel="Photo attached">
                <Image source={{ uri: photoSrc }} style={styles.thumb} contentFit="cover" /><Text style={styles.lineText}>{shot ? "Photo · not saved yet" : "Photo"}</Text>
              </Pressable>
            ) : null}
            {tags.length ? (
              <View style={[styles.line, { flexWrap: "wrap" }]}>
                <SymbolView name="number" size={14} tintColor={C.secondary} />
                {tags.map((tag) => <TagPill key={tag.id} name={tag.name} color={tag.color} onPress={() => setTagIds((ids) => ids.filter((x) => x !== tag.id))} />)}
              </View>
            ) : null}
          </View>
          <View style={styles.accountRow}>
            <Pressable onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.acc, selected: accountId } })} style={styles.accountPill} accessibilityRole="button" accessibilityLabel={`Account: ${account?.name ?? "none"}`}>
              <View style={[styles.accountIcon, { backgroundColor: account?.color ?? (C.tint as unknown as string) }]}><SymbolView name={accountIcon(account?.type ?? "bank")} size={14} tintColor={account?.color ? "white" : C.onTint} /></View>
              <Text style={styles.accountText} numberOfLines={1}>{account?.name ?? "Choose account"}</Text>
              <SymbolView name="chevron.down" size={12} tintColor={C.tertiary} />
            </Pressable>
            <Pressable onPress={unwrap} hitSlop={8} style={styles.unwrap} accessibilityRole="button" accessibilityLabel={expanded ? "Hide balance" : "Show balance"} accessibilityState={{ expanded }}>
              <SymbolView name={expanded ? "chevron.up" : "chevron.down"} size={13} tintColor={C.secondary} />
              <Text style={styles.accountBal}>Balance</Text>
            </Pressable>
          </View>
          {/* Numbers on their own line so a long account name and both balances all fit; the currency is printed once. */}
          {expanded ? (
            <View style={styles.balanceLine} accessibilityLabel={valid && after !== balance ? `Balance ${formatMinor(balance, currency)} ${currency}, after ${formatMinor(after, currency)} ${currency}` : `Balance ${formatMinor(balance, currency)} ${currency}`}>
              <Text style={styles.accountBal}>{formatMinor(balance, currency)}</Text>
              {valid && after !== balance ? <><SymbolView name="arrow.right" size={11} tintColor={C.tertiary} /><Text style={[styles.accountBal, { fontWeight: "600", color: after < 0 ? C.red : kind === "income" ? C.green : C.label }]}>{formatMinor(after, currency)}</Text></> : null}
              <Text style={styles.accountBal}>{currency}</Text>
            </View>
          ) : null}
        </View>
      }
      bottom={noteOpen ? (
        <View style={styles.noteBox}>
          {/* Multiline, so Return writes a line instead of closing the field: Done closes it. The box
              grows with the note up to eight lines or so and scrolls beyond that, with the line that
              does not fit left half-shown so it is plain there is more. */}
          <TextInput ref={noteRef} autoFocus multiline value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor={C.tertiary} style={styles.noteInput}
            selection={caret} onFocus={() => setTimeout(() => setCaret(undefined), 0)}
            onBlur={() => setNoteOpen(false)} accessibilityLabel="Note" />
          <Pressable onPress={() => setNoteOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done"><Text style={styles.noteDone}>Done</Text></Pressable>
        </View>
      ) : (
        <>
          <View style={{ paddingHorizontal: S.md }}>
            {/* Transfer needs two accounts to be a transfer at all, so with one it is not offered. */}
            <Segmented value={kind} onChange={changeKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income", color: C.green as unknown as string }, ...(isNew && accounts.length > 1 ? [{ value: "transfer" as Kind, label: "Transfer" }] : [])]} />
          </View>
          {/* Only while the entry is being written: "what was it this time?" is a question about a
              new expense. An entry already saved has its answer, and the row cost the confirm bar
              its safe-area margin on a sheet that had run out of room. */}
          {isNew && options.length > 1 ? (
            <ChipRow>
              {options.map((o) => {
                const label = [o.category_id ? catNames.get(o.category_id)! : "No category", ...o.tag_ids.map((x) => `#${tagNames.get(x)!}`)].join(" ");
                return <Chip key={o.key} icon="clock.arrow.circlepath" label={label} active={sameAsNow(o)}
                  onPress={() => { setCategoryId(o.category_id); setTagIds(o.tag_ids); setSuggested(false); }} />;
              })}
            </ChipRow>
          ) : null}
          <ChipRow>
            <Chip icon="calendar" label={dayLabel(date)} active={date.slice(0, 10) !== todayLocal()} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: date.slice(0, 10) } })} />
            <Chip icon="clock" label={timeLabel(date)} compact onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: timeLabel(date) } })} />
            <Chip icon="text.alignleft" label="Note" active={!!note} onPress={openNote} />
            <Chip icon="mappin.and.ellipse" label="Place" active={!!coords || !!place} onPress={openLocation} />
            <Chip icon="hourglass" label="Pending" active={pending} compact onPress={() => setPending((v) => !v)} />
            <Chip icon="camera" label="Photo" active={!!photoSrc} compact onPress={openPhoto} />
            <Chip icon="square.split.2x1" label="Split" active={parts.length > 0} compact disabled={!valid} onPress={openSplit} />
            {/* Not an attribute of this entry but an action on another one: the amount typed goes
                back onto an earlier expense instead of being added here. */}
            {isNew ? <Chip icon="arrow.uturn.backward" label="Return" disabled={!valid} onPress={askForReturn} /> : null}
            {isNew && RECEIPT_SCANNER_ENABLED ? <Chip icon="doc.text.viewfinder" label="Receipt" compact onPress={() => router.push({ pathname: "/receipt/scan", params: { key: keys.receipt } })} /> : null}
          </ChipRow>
          <Keypad value={expr} onChange={onKeypadChange} onToggleSign={negate}
            extra={{ label: category ? category.name : "Category", a11y: `Category: ${category ? category.name : "none"}`, icon: catIcon ? (catIcon.icon as SFSymbol) : "folder.badge.plus", color: catIcon?.color, active: !!category, onPress: () => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: kind === "income" ? "income" : "expense", selected: categoryId ?? "" } }) }}
            extra2={{ a11y: tags.length ? `Tags: ${tags.map((tag) => tag.name).join(", ")}` : "Tags", icon: "number", badge: tags.length || undefined, active: tags.length > 0, onPress: () => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } }) }} />
          <ConfirmBar amount={`${value !== null ? signChar + formatMinor(toMinor(value, currency), currency) : "0.00"} ${currency}`}
            label={valid ? (existing ? "Tap to save" : "Tap to add") : "Enter an amount"} onPress={commit} disabled={!valid} color={pending ? (C.orange as unknown as string) : kind === "income" ? (C.green as unknown as string) : undefined} />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs, gap: 4 },
  amountRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8, maxWidth: "100%" },
  amount: { fontSize: 54, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  currency: { fontSize: 22, color: C.secondary, fontWeight: "600" },
  result: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"], minHeight: 20, textAlign: "center" },
  details: { alignSelf: "stretch", gap: 4, paddingHorizontal: S.xs },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  noteLine: { alignItems: "flex-start", paddingVertical: 4 },
  lineText: { color: C.label, fontSize: 15, flexShrink: 1 },
  placeholder: { color: C.tertiary },
  thumb: { width: 28, height: 28, borderRadius: 6, backgroundColor: C.fill },
  accountRow: { flexDirection: "row", alignItems: "center", gap: S.sm, alignSelf: "stretch", marginTop: 2 },
  accountPill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 22, paddingHorizontal: 12, minHeight: 40, paddingVertical: 6, flexShrink: 1 },
  accountIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  accountText: { fontSize: 15, color: C.label, flexShrink: 1 },
  accountBal: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"] },
  balanceLine: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: S.xs, marginTop: 2 },
  unwrap: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: C.fill, flexShrink: 1 },
  corner: { position: "absolute", top: 8, left: S.md, width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill, alignItems: "center", justifyContent: "center", zIndex: 1 },
  trash: { position: "absolute", top: 8, right: S.md, width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill, alignItems: "center", justifyContent: "center", zIndex: 1 },
  noteBox: { flexDirection: "row", alignItems: "flex-end", gap: S.md, marginHorizontal: S.md, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: S.md, paddingVertical: 8, minHeight: 50 },
  noteInput: { flex: 1, fontSize: 17, color: C.label, minHeight: 34, maxHeight: 176, paddingTop: 7, paddingBottom: 7 },
  noteDone: { color: C.tint, fontSize: 17, fontWeight: "700", paddingVertical: 7 },
});

/**
 * Let go of a photo file, and delete it only if no other live entry still points at it. The parts
 * of a split share one photo — the receipt was photographed once — so the file outlives any single
 * row of them (DATA.md rule 4: the name in the row is the index, and the file is written once).
 */
function releasePhoto(name: string | null | undefined, exceptId: string): void {
  if (!name || photoInUse(db, name, exceptId)) return;
  deletePhoto(name);
}

/** Why an entry cannot take the return the user typed, in words rather than in a code. */
function returnReason(reason: Exclude<ReturnType<typeof checkReturn>, { ok: true }>["reason"]): string {
  switch (reason) {
    case "transfer": return "A transfer moves money between your own accounts, so there is nothing to come back from.";
    case "too-much": return "That is more than is left on the entry. Book the rest against another one, or edit it by hand.";
    case "wrong-direction": return "Money can only come back the other way round from how it went out.";
    default: return "The entry is no longer there.";
  }
}
