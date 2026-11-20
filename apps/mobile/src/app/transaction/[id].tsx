import { offerUndo } from "@/lib/undo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Keyboard, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { LinearTransition } from "react-native-reanimated";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { rowIsIncome, accountBalanceMinor, applyReturn, itemsToStore, sharesOf, categoryForShop, checkReturn, kopiykaError, claimRecurring, clearReturns, createTransaction, settleIfPaid, getRow, learnFromRow, listRows, paidAmountMinor, payeeOptions, photoInUse, rateOrFallback, remove, save, shareEntered, splitAmounts, suggestCategoryAt, toMinor, uncarriedTagIds, fromMinor, formatMinor, numberFormat, iconFor, jsonIds, trimNumber, withTripTag, receiptChanges, receiptFill, receiptSave, type EntryNow, type SplitPart, type Transaction } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { shopParams } from "@/lib/shopPick";
import { KEY_HEIGHT, Keypad, CalcLine, Caret, ConfirmBar, applyKeySigned, evalPartial, negateExpr } from "@/components/Keypad";
import { ButtonText, Chip, ChipGrid, SheetFrame, TagPill, accountIcon, Tap } from "@/components/ui";
import { copyToClipboard } from "@/lib/device";
import { C, R, S, Type, themed } from "@/constants/theme";
import { dayChipLabel, dayWithNow, localIso, timeLabel, todayLocal, withTime } from "@/lib/dates";
import { DISMISS_MS, dismissTo, openOnce } from "@/lib/nav";
import { readPhoto, usePhotoReading } from "@/lib/photoText";
import { noteWithReceipt, receiptNote } from "@/lib/receiptFill";
import type { PhotoSplit } from "@/app/photo/view";
import { errorText } from "@/lib/errors";
import { addressCoords, ensureLocationPermission, placeName, quickLocation, type Coords } from "@/lib/location";
import { getCurrentAccount, getLocationEnabled, getShowBalance, setLocationEnabled, waitDefaultDays } from "@/lib/settings";
import { takePhoto } from "@/lib/camera";
import { closePhotoViewer } from "@/lib/photoShown";
import { markSheetPainted } from "@/lib/boot";
import { dismissSettledPaymentNotices } from "@/lib/notifications";
import { deletePhoto, keepPhoto, photoUri } from "@/lib/photos";
import type { ReceiptParse } from "@/lib/bridge";
import type { SplitResult } from "./split";
import { t } from "@/i18n";
import { catName, acctName } from "@/lib/names";

type Kind = "expense" | "income" | "transfer";
type Params = { id: string; account?: string; category?: string; amount?: string; kind?: Kind; note?: string; tags?: string;
  // Carried by Duplicate below, so a copy opens as the same entry whether or not the sheet remounts.
  date?: string; payee?: string; place?: string; lat?: string; lon?: string; pending?: string;
  // From the Log button's long press: a receipt already photographed (a temporary file).
  shot?: string;
  // From the icon's "Scan receipt" quick action (`kopiyka://log?scan=1`): the camera opens first.
  scan?: string };

/**
 * Entry sheet: amount hero, a left-aligned details column (date, note, place, tags), the
 * account pill (icon + name) with the balance before → after beside it, hidden behind dots so
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
  const [defaultMode, setDefaultMode] = useState<"expense" | "income">(existing ? (rowIsIncome(existing) ? "income" : "expense") : p.kind === "income" ? "income" : "expense");
  const [expr, setExpr] = useState(() => {
    // A zero still waiting for its amount (DATA.md rule 6) starts empty, so what is typed takes the row's direction.
    if (existing) return existing.amount_minor === 0 ? "" : trimNumber(fromMinor(existing.amount_minor, getRow(db, "accounts", existing.account_id)?.currency ?? "EUR"));
    if (!p.amount) return "";
    return defaultMode === "expense" ? `−${p.amount}` : p.amount; // prefilled amount is a magnitude
  });
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? p.category ?? null);
  // The debt this pays off or settles, picked as "Debt" in place of a category (pick/category.tsx).
  // The two are one answer: choosing either clears the other.
  const [debtId, setDebtId] = useState<string | null>(existing?.debt_id ?? null);
  const debt = useQuery((d) => (debtId ? getRow(d, "debts", debtId) ?? null : null), [debtId]);
  const [suggested, setSuggested] = useState(false);
  // Travel mode: new entries start with the trip tag (removable like any other).
  const [tagIds, setTagIds] = useState<string[]>(() => existing ? jsonIds(existing.tag_ids) : withTripTag(db, p.tags ? p.tags.split(",").filter(Boolean) : []));
  const [date, setDate] = useState(existing?.date ?? p.date ?? localIso());
  // The note is yours alone. What the bank's notification said is `bank_note` (v23), shown under it
  // and never edited here, so a note can be added to a logged payment without typing around the
  // bank's text, and nothing typed can lose it. The shop is the payee, which titles the row.
  const [note, setNote] = useState(existing?.notes ?? p.note ?? "");
  const bankNote = existing?.bank_note?.trim() || null;
  const [noteOpen, setNoteOpen] = useState(false);
  // iOS drops the caret at the end of the text when a field takes focus, which opens a long note
  // scrolled past its first words. So the first time the note opens, the caret is moved to its start
  // once, imperatively, and from then on the field is left alone: a reopened note keeps the caret
  // wherever iOS puts it. It is deliberately not the `selection` prop — a controlled selection is
  // re-applied on every keystroke until it is released, and a release that lost the race with the
  // first letter pinned the caret at 0, so each new letter landed before the last and the note came
  // out backwards.
  const noteOpened = useRef(false);
  const openNote = () => setNoteOpen(true);
  const noteFocused = () => {
    if (noteOpened.current) return;
    noteOpened.current = true;
    requestAnimationFrame(() => noteRef.current?.setSelection(0, 0));
  };
  // The shop a Shortcut or a receipt filed this under. No field of its own — it is carried so that
  // saving keeps it and Duplicate copies it.
  const [payee, setPayee] = useState<string | null>(existing?.payee ?? p.payee ?? null);
  // Opening the sheet on a pending row *is* the review, so the chip starts off and saving approves it:
  // the state here is what will be stored, not what is stored now. Turning the chip back on keeps the
  // row in the Pending queue — the only way an edited row stays pending.
  const [pending, setPending] = useState(existing ? false : p.pending === "1");
  // Marked to be split later (core/people.ts): it waits in the To split queue until it is.
  const [toSplit, setToSplit] = useState(existing?.to_split === 1);
  const [coords, setCoords] = useState<Coords | null>(
    existing && existing.lat != null && existing.lon != null ? { lat: existing.lat, lon: existing.lon }
      : !existing && p.lat && p.lon ? { lat: Number(p.lat), lon: Number(p.lon) } : null);
  const [place, setPlace] = useState<string | null>(existing?.place ?? p.place ?? null);
  // Attached photo: `photo` is the stored file name, `shot` a freshly captured temporary file (kept on save).
  const [photo, setPhoto] = useState<string | null>(existing?.photo ?? null);
  const [shot, setShot] = useState<string | null>(isNew && p.shot ? p.shot : null);
  // The parts carved off this entry. The entry itself is the first part and keeps what is left, so
  // the amount on the keypad stays the receipt total; these are only the *other* ones. They are
  // written as their own transactions on save and nothing links them afterwards (core/split.ts).
  const [parts, setParts] = useState<SplitPart[]>([]);
  const noteRef = useRef<TextInput>(null);
  // Unwrapped from the start when the preference says so (Settings → Preferences → Show balance
  // when logging); the chevron still folds it back for this one entry without changing the setting.
  const [done, setDoneState] = useState(false);  // saved or discarded: no prompt on close
  // The same, readable in the tick it is set: a save that closes the sheet at once is not "unsaved".
  const doneRef = useRef(false);
  const setDone = useCallback((v: boolean) => { doneRef.current = v; setDoneState(v); }, []);
  const [stacked, setStacked] = useState(false); // transfer sheet on top: its save closes both

  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const currency = account?.currency ?? "EUR";
  const balance = useQuery((d) => (account ? accountBalanceMinor(d, account.id) : 0), [account?.id]);
  const category = useQuery((d) => {
    if (!categoryId) return null;
    const c = getRow(d, "categories", categoryId);
    const parent = c?.parent_id ? getRow(d, "categories", c.parent_id) : null;
    return c ? { ...c, parentName: parent ? catName(parent) : null } : null;
  }, [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((tag) => tagIds.includes(tag.id)), [tagIds.join(",")]);

  // ---- "What was it this time?" ------------------------------------------------------------------
  // A petrol station sells fuel, a hot dog and a bottle of something, and history can only ever
  // repeat whichever of them came last. The category picker lists every way this name was filed
  // before at its top ("Filed here before"); picking one of them here brings that way's tags along,
  // because the category and its tags together are the past decision. (They were chips on this sheet
  // until build 126; a tester found a row of them too many buttons.)
  const catNames = useQuery((d) => new Map(listRows(d, "categories", "deleted=0").map((c) => [c.id, catName(c)])), []);
  const tagNames = useQuery((d) => new Map(listRows(d, "tags", "deleted=0").map((x) => [x.id, x.name])), []);
  // A pending entry asks too: the automation fills in whichever way came last and leaves the row in
  // the queue because that is not a decision — so this row is the question, not one of its answers.
  const asking = isNew || !!existing?.pending;
  // A pending row's amount tells apart two things paid to one name (the rent and the service
  // charges, both to the landlord), so the way it points to is offered first (core `pickByAmount`).
  const paid = existing?.pending ? { amount_minor: existing.amount_minor, account_id: existing.account_id } : null;
  const filed = useQuery((d) => (asking ? payeeOptions(d, payee, note.trim() || bankNote, 6, existing?.id, paid) : []), [asking, payee, note.trim(), bankNote, existing?.id, paid?.amount_minor, paid?.account_id]);
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
  // The trip's tag travel mode put on this entry is not part of any option (`uncarriedTagIds`): picking
  // one keeps it, and it does not stop the option reading as the one that is chosen.
  const tripTags = useQuery((d) => uncarriedTagIds(d), []);
  // Read by the category picker's result, which is registered once.
  const optionsRef = useRef(options);
  useEffect(() => { optionsRef.current = asking ? options : []; }, [asking, options]);

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

  const keys = useMemo(() => ({ cat: newPickKey("cat"), acc: newPickKey("acc"), tags: newPickKey("tags"), date: newPickKey("date"), time: newPickKey("time"), loc: newPickKey("loc"), shot: newPickKey("shot"), photo: newPickKey("photo"), photoSplit: newPickKey("photoSplit"), ret: newPickKey("ret"), split: newPickKey("split") }), []);
  usePickResult<string>(keys.shot, useCallback((uri: string) => { setShot(uri); }, []));
  usePickResult<boolean>(keys.photo, useCallback(() => { setShot(null); setPhoto(null); }, []));
  const photoSrc = shot ?? (photo ? photoUri(photo) : null);
  // Its text is read in the background the moment there is a photo (lib/photoText.ts, cached), so
  // opening it shows the text, and a receipt's items, without a wait.
  useEffect(() => { readPhoto(photoSrc); }, [photoSrc]);
  // Whatever photo there is opens over the sheet with what it says (photo/view); an expense's receipt
  // is sorted into categories there, and Continue comes back as a split, saved at once (below).
  const showPhoto = (uri: string) => router.push({ pathname: "/photo/view", params: {
    uri, key: keys.photo, replace: keys.shot, date: date.slice(0, 10), ...(accountId ? { account: accountId } : {}),
    ...(kind === "expense" && !debtId && !sharedReceipt ? { split: keys.photoSplit, total: value !== null && value > 0 ? String(toMinor(value, currency)) : "", currency, category: categoryId ?? "" } : {}),
  } });
  // With no photo yet the camera opens, and the photo it takes is shown the same way as one already
  // there: one flow, whichever way in.
  const openPhoto = () => {
    if (photoSrc) { showPhoto(photoSrc); return; }
    void takePhoto().then((uri) => {
      if (!uri) return;
      setShot(uri);
      setTimeout(() => showPhoto(uri), DISMISS_MS);
    });
  };
  // Long-pressed Log with the receipt already photographed: the photo opens over the sheet, so what was
  // read — the shop, the items, its categories — is what is watched while it is read, not a keypad.
  useEffect(() => {
    if (!isNew || !p.shot) return;
    const shot = p.shot;
    const id = setTimeout(() => openOnce(`photo:${shot}`, openPhoto), 250);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // The icon's Scan receipt: the camera straight away, then the same flow as the photo chip. Taking
  // nothing leaves the empty sheet, to log by hand.
  useEffect(() => {
    if (!isNew || p.shot || p.scan !== "1") return;
    const id = setTimeout(() => openOnce("scan", openPhoto), 350);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- What the photo says -------------------------------------------------------------------------
  // The photo is read the moment it is there (lib/photoText.ts). A receipt found on it is offered as
  // one tap — "Update from receipt" — listing what it would change: the amount (converted when the
  // receipt is in another currency), the day, the shop and a category where there is none, and the
  // receipt's lines under the note (never over what was written). A new entry with nothing typed yet
  // is simply filled in. Either way Undo puts every field back as it was.
  const reading = usePhotoReading(photoSrc);
  const [gpsPlace, setGpsPlace] = useState<string | null>(null);   // the place name the phone's location filled in, if it did
  const receipt = reading.parse && reading.parse.total > 0 ? reading.parse : null;
  const busyReading = reading.status === "reading" || reading.status === "text";
  // A place the phone's location filled in gives way to the receipt's printed address; one picked by hand never does.
  const placeFromPhone = !!place && place === gpsPlace;
  // Filled in from *this* photo: a replaced photo is a different receipt, and fills in again.
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const filled = !!photoSrc && filledFrom === photoSrc;
  // A part of a split shares the receipt with the other parts (DATA.md rule 4): the whole receipt's
  // total is not this row's, so there is nothing to update it from.
  const [sharedReceipt] = useState(() => !!existing?.photo && photoInUse(db, existing.photo, existing.id));
  // What filling in decides is core's (receiptEntry.ts, tested there); this sheet only applies it.
  const entryNow: EntryNow = { amount_minor: value !== null ? toMinor(value, currency) : null, expense: kind === "expense", currency, category_id: categoryId, suggested, debt_id: debtId, payee, place, placeFromPhone, note, day: date.slice(0, 10) };
  const changes = receipt && !sharedReceipt ? receiptChanges(entryNow, receipt, receiptNote(receipt, currency)) : [];
  // `quiet` when it fills itself in behind the photo: an alert would land on top of the receipt, so
  // it only remembers, and Continue says it instead of saving a number in the wrong currency.
  // Resolves false when no rate was known.
  const [unconverted, setUnconverted] = useState<string | null>(null);
  // What a receipt in another currency said it cost, kept so the saved row carries the original and
  // the rate it was converted at (DATA.md rule 6) instead of only the converted number.
  const [foreign, setForeign] = useState<{ minor: number; currency: string } | null>(null);
  const noRateAlert = (cur: string) => Alert.alert(t("transaction.entry.receiptCurrency.title", { currency: cur }), t("transaction.entry.receiptCurrency.body"));
  /** `to` is the currency of the account it lands on: the receipt sheet may have just chosen another one. */
  const fillFromReceipt = async (r: ReceiptParse, quiet = false, to = currency): Promise<boolean> => {
    setFilledFrom(photoSrc);
    const cross = !!r.currency && r.currency !== to;
    const rate = cross ? await rateOrFallback(db, r.currency!, to).then((x) => x?.rate ?? null).catch(() => null) : null;
    const f = receiptFill({ ...entryNow, currency: to }, r, rate, receiptNote(r, to));
    // A receipt is always an expense. With no rate the amount is left for you to type (rule 6: never
    // the foreign number as if it were the account's).
    setExpr(f.unconverted ? "" : `−${f.amount}`);
    setForeign(cross && rate ? { minor: toMinor(r.total, r.currency!), currency: r.currency! } : null);
    setDefaultMode("expense");
    setUnconverted(f.unconverted);
    if (f.category_id) { setCategoryId(f.category_id); setSuggested(false); }
    if (f.payee) setPayee(f.payee);
    if (f.place) {
      setPlace(f.place);
      setGpsPlace(null);
      // Pinned where the printed address is, when it can be found.
      if (r.address) void addressCoords(r.address).then((c) => setCoords(c));
    }
    if (f.note) setNote(f.note);
    if (f.day) setDate(dayWithNow(f.day));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (f.unconverted && !quiet) noRateAlert(f.unconverted);
    return !f.unconverted;
  };
  // A new entry with no amount yet takes the receipt as soon as it is read: that is why it was photographed.
  const autoFilled = useRef<string | null>(null);
  useEffect(() => {
    if (!receipt || !isNew || expr || !photoSrc || autoFilled.current === photoSrc) return;
    autoFilled.current = photoSrc;
    void fillFromReceipt(receipt, true);
  }, [receipt]); // eslint-disable-line react-hooks/exhaustive-deps
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => {
    if (v?.startsWith("debt:")) { setDebtId(v.slice(5)); setCategoryId(null); } else { setCategoryId(v); setDebtId(null); }
    setSuggested(false);
    // One of the shop's past ways: its tags come with it, and the trip's tag stays.
    const way = v ? optionsRef.current.find((o) => o.category_id === v) : undefined;
    if (way) setTagIds((ids) => [...way.tag_ids, ...ids.filter((x) => tripTags.has(x) && !way.tag_ids.includes(x))]);
  }, [tripTags]));
  usePickResult<string>(keys.acc, (v: string) => {
    const next = accounts.find((a) => a.id === v), prev = account;
    setAccountId(v);
    // The receipt's original was converted into the old account's currency; it no longer describes this amount.
    if (next && prev && next.currency !== prev.currency) setForeign(null);
    if (!next || !prev || next.currency === prev.currency || value === null) return;
    Alert.alert(t("transaction.entry.convert.title", { currency: next.currency }),
      t("transaction.entry.convert.body", { amount: formatMinor(toMinor(value, prev.currency), prev.currency), from: prev.currency, account: next.name, to: next.currency }), [
        { text: t("transaction.entry.convert.keep"), style: "cancel" },
        { text: t("transaction.entry.convert.action", { currency: next.currency }), onPress: () => { void rateOrFallback(db, prev.currency, next.currency).then((r) => { if (!r) { Alert.alert(t("transaction.entry.noRate")); return; } const converted = Math.round(value * r.rate * 100) / 100; setExpr(kind === "expense" ? `−${converted}` : String(converted)); }).catch(() => Alert.alert(t("transaction.entry.noRate"))); } },
      ]);
  });
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  // Splitting needs a total to share out, so the amount comes first — and the editor is given the
  // entry's own category and tags as the first part, because that part is this entry.
  const openSplit = (with_?: { category_id: string | null; parts: SplitPart[]; note?: string; tag_ids?: string[] }) => {
    if (value === null || value <= 0) { Alert.alert(t("transaction.entry.splitNeedsTotal.title"), t("transaction.entry.splitNeedsTotal.body")); return; }
    router.push({ pathname: "/transaction/split", params: {
      key: keys.split, currency, kind, total: String(toMinor(value, currency)),
      main: JSON.stringify({ category_id: with_ ? with_.category_id : categoryId, tag_ids: with_?.tag_ids ?? tagIds, note: with_?.note ?? note }), parts: JSON.stringify(with_ ? with_.parts : parts),
      ...(photoSrc ? { photo: photoSrc } : {}),
      // A tip changes what the entry is for. Not on a payment the bank charged in another currency:
      // its original is shared out in proportion, and nothing says what the tip was in that currency.
      ...(existing?.entered_amount_minor ? {} : { tips: "1" }),
    } });
  };
  // Continue on the photo: the receipt is the entry. What it says is filled in (unless it already
  // was), the day picked there wins, the category each item was given makes the split — the entry
  // keeps the biggest share, each other category becomes a part (friends already in it stay) — and
  // the photo closes on this sheet, filled in, to be checked and saved here (the amount and the
  // account are the user's to confirm). With no exchange rate it says so once the photo has gone.
  // The split as it came back, kept until the save: its parts are scaled to the entry's total then,
  // once a converted amount has landed.
  const [saveSoon, setSaveSoon] = useState<PhotoSplit | null>(null);
  const continueFromPhoto = async (r: PhotoSplit) => {
    // The account the receipt sheet confirmed: switching to it re-converts the amount into its currency.
    const payWith = r.account_id && r.account_id !== accountId ? accounts.find((a) => a.id === r.account_id) : undefined;
    if (payWith) setAccountId(payWith.id);
    const to = payWith?.currency ?? currency;
    const fill = !!receipt && ((!filled && changes.length > 0) || to !== currency);
    const sure = fill && receipt ? await fillFromReceipt(receipt, true, to) : !unconverted;
    // The category the entry has once filled in: what stays with it and was given none keeps it.
    const now = fill && receipt ? receiptFill(entryNow, receipt, null, "").category_id ?? categoryId : categoryId;
    const mainCat = r.category_id ?? now;
    if (mainCat !== categoryId) { setCategoryId(mainCat); setDebtId(null); setSuggested(false); }
    // Tags given to the items that stay with the entry join the entry's own.
    setTagIds([...new Set([...tagIds, ...(r.tag_ids ?? [])])]);
    if (r.date && r.date !== date.slice(0, 10)) setDate(r.date === todayLocal() ? localIso() : dayWithNow(r.date));
    if (r.parts.length) {
      // Each part's note is what it bought. The entry keeps its own note, except that the whole
      // receipt written into it becomes just the lines that stayed with it.
      setParts([...parts.filter((x) => x.person_id), ...r.parts.map((x) => ({ amount_minor: x.amount_minor, category_id: x.category_id, tag_ids: [...new Set([...withTripTag(db, []), ...(x.tag_ids ?? [])])], note: x.note ?? null }))]);
      const whole = receipt ? receiptNote(receipt, currency) : "";
      const noteNow = fill && receipt ? noteWithReceipt(note, receipt, currency) : note;
      setNote(whole && noteNow.includes(whole) ? noteNow.replace(whole, r.note ?? "").trim() : noteNow);
    }
    if (sure) { setSaveSoon({ ...r, category_id: mainCat }); return; }
    closePhotoViewer();
    const cur = receipt?.currency ?? unconverted;
    if (cur) setTimeout(() => noRateAlert(cur), DISMISS_MS);
  };
  usePickResult<PhotoSplit>(keys.photoSplit, (r: PhotoSplit) => { void continueFromPhoto(r); });
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
    router.push({ pathname: "/pick/transaction", params: {
      key: keys.ret, title: t("transaction.entry.returnPickTitle"),
      desc: t("transaction.entry.returnPickDesc", { amount: formatMinor(returnMinor, currency), currency }),
      returnMinor: String(returnMinor), currency,
    } });
  };
  usePickResult<string>(keys.ret, (id: string) => {
    const target = getRow(db, "transactions", id);
    if (!target) return;
    // Towards zero, whichever way the chosen row points: money back on an expense, money returned on income.
    const delta = target.amount_minor < 0 ? returnMinor : -returnMinor;
    const check = checkReturn(db, id, delta);
    if (!check.ok) { Alert.alert(t("transaction.entry.returnCannot"), returnReason(check.reason)); return; }
    const name = target.payee || target.notes?.split("\n")[0] || target.bank_note?.split("\n")[0] || t("transaction.entry.returnThatEntry");
    const cur = getRow(db, "accounts", target.account_id)?.currency ?? currency;
    Alert.alert(t("transaction.entry.returnConfirmTitle", { amount: formatMinor(returnMinor, currency), currency }),
      `${name}: ${formatMinor(target.amount_minor, cur)} → ${formatMinor(check.amount_minor, cur)} ${cur}`, [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("transaction.entry.returnBook"), onPress: () => {
          try { mutate((d) => applyReturn(d, id, delta)); } catch (e) {
            const err = kopiykaError(e);
            Alert.alert(t("transaction.entry.returnFailed"), err?.code === "return_not_possible" ? returnReason(err.detail as ReturnReason) : errorText(e));
            return;
          }
          setDone(true);
          router.back();
        } },
      ]);
  });
  // On an entry that already has returns: the amount it was paid at, and a way back out of a mistype.
  const refunded = existing?.refunded_minor ?? 0;
  const undoReturns = () => existing && Alert.alert(t("transaction.entry.forgetReturns.title"),
    t("transaction.entry.forgetReturns.body", { amount: formatMinor(paidAmountMinor(existing), currency), currency }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("transaction.entry.forgetReturns.action"), style: "destructive", onPress: () => { mutate((d) => clearReturns(d, existing.id)); setDone(true); router.back(); } },
    ]);

  // Tapping the amount copies it, plain, unsigned and ungrouped so it pastes into anything.
  const [copied, setCopied] = useState(false);
  // The Return pill's width, so the amount keeps the same room on both sides of it and stays centred.
  const copyAmount = () => {
    if (value === null) return;
    // The magnitude only: the sign is the entry's kind, not part of the number being copied.
    const text = formatMinor(toMinor(value, currency), currency, { grouping: "", decimal: "." });
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
  // The amount is the keypad's and every other field is a sheet of its own, so the only keyboard this
  // sheet ever shows is the note's. One left up by a sheet closed while it was typing (the place
  // search) is put away the moment this sheet is back in front.
  useFocusEffect(useCallback(() => { if (!noteOpen) Keyboard.dismiss(); }, [noteOpen]));
  // Opening the entry is dealing with it: the automation's notification about it has done its job.
  useEffect(() => { if (!isNew) void dismissSettledPaymentNotices(p.id); }, [isNew, p.id]);
  /** The caret's restart counter and where it stands: after the last digit, or before the decimals. */
  const [caret, setCaret] = useState({ pulse: 0, whole: false });
  const onEdit = useCallback((whole: boolean) => setCaret((c) => ({ pulse: c.pulse + 1, whole })), []);

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
      setGpsPlace((g) => g ?? name);
      const here = suggestCategoryAt(db, { lat: c.lat, lon: c.lon, place: name });
      if (here?.by === "place") { offer(here.category_id); return; }
      // Nothing filed at this shop yet, but it is one everybody knows (core shops.ts): Biedronka is
      // groceries in whatever category of yours has that type. Still only offered, marked suggested.
      const shop = categoryForShop(db, name);
      if (shop) offer(shop);
    });
    return () => { alive = false; };
  }, [isNew]);

  // `split` is what the split editor just handed back, saved before the state it also sets has landed.
  const persist = (split?: { categoryId: string | null; tagIds: string[]; parts: SplitPart[]; note?: string; toSplit?: boolean; total?: number }) => {
    const cat = split ? split.categoryId : categoryId;
    const tagList = split ? split.tagIds : tagIds;
    const partList = split ? split.parts : parts;
    // The split's total, tip included, when one was added there; otherwise the amount on the sheet.
    const whole = split?.total ?? (value !== null ? toMinor(value, currency) : null);
    const minors = split ? (whole !== null && partList.length ? splitAmounts(whole, partList.map((x) => x.amount_minor)) : null) : splitMinors;
    if (whole === null || whole <= 0 || !account || (partList.length && !minors)) return false;
    const minor = whole * (kind === "expense" ? -1 : 1);
    // A receipt converted from another currency keeps its original and the rate (rule 6), unless the
    // row already had one of its own (the bank's).
    const kept = foreign && foreign.currency !== currency && foreign.minor > 0 && !existing?.entered_amount_minor ? {
      entered_amount_minor: foreign.minor * (kind === "expense" ? -1 : 1), entered_currency: foreign.currency,
      exchange_rate: Math.round((fromMinor(whole, currency) / fromMinor(foreign.minor, foreign.currency)) * 1e6) / 1e6,
    } : null;
    // A new shot replaces the stored file; clearing the photo removes it.
    let photoName = photo;
    if (shot) { try { photoName = keepPhoto(shot); if (existing?.photo) releasePhoto(existing.photo, existing.id); } catch { photoName = photo; } }
    else if (existing?.photo && !photo) releasePhoto(existing.photo, existing.id);
    mutate((d) => {
      const marked = split?.toSplit ?? toSplit;
      const base = { account_id: account.id, date, amount_minor: minor, category_id: cat, debt_id: debtId, payee, notes: (split?.note ?? note).trim() || null, tag_ids: JSON.stringify(tagList), pending: pending ? 1 : 0, lat: coords?.lat ?? null, lon: coords?.lon ?? null, place, photo: photoName, to_split: marked ? 1 as const : 0 as const, ...(kept ?? {}) } as const;
      if (!partList.length || !minors) {
        if (existing) {
          const saved = save(d, "transactions", { ...existing, ...base } as Transaction);
          // Approving a notification-logged row teaches its account the digits the bank printed for it.
          if (existing.pending && !saved.pending) learnFromRow(d, saved);
          if (debtId) settleIfPaid(d, debtId, todayLocal());
          return;
        }
        // A payment typed in by hand can be the charge a recurring rule is waiting for just as much
        // as one the automation logged — the rule takes it and stops expecting a second.
        claimRecurring(d, createTransaction(d, base), { today: todayLocal(), waitDefault: waitDefaultDays() });
        // The payment that finishes paying a debt off settles it.
        if (debtId) settleIfPaid(d, debtId, todayLocal());
        return;
      }
      // A split is several ordinary entries: the one being edited keeps its id and what the parts
      // leave it (rule 1 — renaming a row is not the same as replacing it), and each part becomes a
      // new row that differs from it only in amount, category and tags. A foreign original is shared
      // out in the same proportions, so a part still shows what the bank actually charged for it.
      const sign = kind === "expense" ? -1 : 1;
      const original = existing?.entered_amount_minor ? existing : kept;
      const entered = original?.entered_amount_minor ? shareEntered(original.entered_amount_minor, minors) : null;
      const shared = { account_id: base.account_id, date, payee, notes: base.notes, bank_note: existing?.bank_note ?? null, pending: base.pending, lat: base.lat, lon: base.lon, place, photo: photoName, source: existing?.source ?? null } as const;
      // A friend's part is their share, not yours (core/people.ts, DATA.md rule 23): no category and
      // no tags — a trip tag would count it against the trip — and the purchase it was carved from,
      // so their page can say what it was. Splitting is what the "to split" mark was waiting for.
      let mainId = existing?.id ?? "";
      minors.forEach((magnitude, i) => {
        const money = { amount_minor: magnitude * sign, ...(entered ? { entered_amount_minor: entered[i]!, entered_currency: original!.entered_currency, exchange_rate: original!.exchange_rate } : {}) };
        if (i === 0) {
          const first = { ...shared, ...money, category_id: cat, debt_id: debtId, tag_ids: JSON.stringify(tagList), to_split: 0 as const };
          if (existing) save(d, "transactions", { ...existing, ...first } as Transaction);
          else mainId = createTransaction(d, first).id;
          return;
        }
        const part = partList[i - 1]!;
        if (part.person_id) {
          // A share has nothing to file, so it never waits in Pending however the purchase arrived.
          createTransaction(d, { ...shared, ...money, pending: 0, category_id: null, tag_ids: "[]", person_id: part.person_id, share_of: mainId, items: itemsToStore(part.items) });
          return;
        }
        createTransaction(d, { ...shared, ...money, category_id: part.category_id, tag_ids: JSON.stringify(part.tag_ids), ...(part.note?.trim() ? { notes: part.note.trim() } : {}) });
      });
      if (debtId) settleIfPaid(d, debtId, todayLocal());
    });
    setDone(true);
    return true;
  };
  const commit = () => { if (persist()) router.back(); };
  // Split held: the split screen's "Later" without opening it — the dinner paid in a hurry is saved
  // as it stands, marked for the To split queue, and the sheet closes.
  const splitLater = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setToSplit(true);
    if (persist({ categoryId, tagIds, parts: [], toSplit: true })) router.back();
  };
  // Keeping the split is saving the entry: the parts were the last thing left to decide, so the
  // entries are written there and then and the list opens on them — coming back to this sheet only
  // to press Add a second time was a step with nothing in it.
  const [leave, setLeave] = useState(false);
  usePickResult<SplitResult>(keys.split, (r: SplitResult) => {
    // "Later" saves the entry as it stands, marked; nothing is split yet.
    if (r.later) {
      setToSplit(true);
      if (persist({ categoryId, tagIds, parts: [], toSplit: true })) setLeave(true);
      else router.back();
      return;
    }
    // Who owes what goes on a line of its own under whatever the note already says — the note as
    // the split screen left it, where it can be edited too.
    const base = r.main.note ?? note;
    const nextNote = r.noteLine ? (base.trim() ? `${base.trim()}\n${r.noteLine}` : r.noteLine) : base;
    setCategoryId(r.main.category_id);
    setSuggested(false);
    setTagIds(r.main.tag_ids);
    setParts(r.parts);
    setNote(nextNote);
    if (r.total) { const v = trimNumber(fromMinor(r.total, currency)); setExpr(kind === "expense" ? `−${v}` : String(v)); }
    if (persist({ categoryId: r.main.category_id, tagIds: r.main.tag_ids, parts: r.parts, note: nextNote, toSplit: false, total: r.total })) setLeave(true);
    else router.back();
  });
  // After the render that sets `done`, so the unsaved-entry prompt below is already switched off.
  useEffect(() => { if (leave) dismissTo({ pathname: "/transactions" }); }, [leave]);
  // In the render after Continue's answers have landed: the split is scaled to the entry's total and
  // the photo closes onto this sheet, filled in, for the amount, account and the rest to be checked
  // and saved here. Nothing is written until then.
  useEffect(() => {
    if (!saveSoon) return;
    const r = saveSoon;
    setSaveSoon(null); // eslint-disable-line react-hooks/set-state-in-effect -- a one-shot trigger
    // The parts were worked out against `basis`; the entry's total is what they are shares of.
    const filledIn = receiptSave(r, parts, value !== null ? toMinor(value, currency) : 0, categoryId);
    if (filledIn.category_id !== categoryId) setCategoryId(filledIn.category_id);
    setParts(filledIn.parts);
    closePhotoViewer();
  }, [saveSoon]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing with an amount typed (swipe, tap outside, back) asks first; the sheet stays until answered.
  usePreventRemove(isNew && !done && !stacked && !!expr, ({ data }) => {
    Alert.alert(t("transaction.entry.unsaved.title"), valid ? `${formatMinor(toMinor(value!, currency), currency)} ${currency}${category ? ` · ${catName(category)}` : ""}` : t("transaction.entry.unsaved.incomplete"), [
      { text: t("transaction.entry.unsaved.discard"), style: "destructive", onPress: () => { setDone(true); navigation.dispatch(data.action); } },
      { text: t("transaction.entry.unsaved.keep"), style: "cancel" },
      ...(valid ? [{ text: t("common.add"), onPress: () => { if (persist()) navigation.dispatch(data.action); } }] : []),
    ]);
  });
  // A photo added to (or taken off) an entry that already exists lives only in this sheet until Save:
  // closing it any other way used to drop the photo without a word. So that, too, asks first.
  const photoChanged = !isNew && (!!shot || (existing?.photo ?? null) !== photo);
  usePreventRemove(photoChanged && !done && !stacked, ({ data }) => {
    if (doneRef.current) { navigation.dispatch(data.action); return; }
    Alert.alert(photo || shot ? t("transaction.entry.unsavedPhoto.added") : t("transaction.entry.unsavedPhoto.removed"), t("transaction.entry.unsavedPhoto.body"), [
      { text: t("transaction.entry.unsaved.discard"), style: "destructive", onPress: () => { setDone(true); navigation.dispatch(data.action); } },
      { text: t("transaction.entry.unsaved.keep"), style: "cancel" },
      ...(valid ? [{ text: t("common.save"), onPress: () => { if (persist()) navigation.dispatch(data.action); } }] : []),
    ]);
  });
  // The same entry again, ready to edit before it is added: a second coffee, the fare back. The sheet is
  // replaced rather than stacked, so the original closes as the copy opens, and every field travels in
  // the params — the photo excepted, because one photo file belongs to the one row that stored it.
  const duplicate = () => existing && Alert.alert(t("transaction.entry.duplicate.title"),
    t("transaction.entry.duplicate.body", { summary: `${signChar}${formatMinor(toMinor(value ?? 0, currency), currency)} ${currency}${category ? ` · ${catName(category)}` : ""}` }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("transaction.entry.duplicate.action"), onPress: () => {
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
  // A purchase friends' shares were carved from asks about them too: left behind, they would still
  // owe you for something that is no longer there (DATA.md rule 23).
  const del = () => {
    if (!existing) return;
    const shares = sharesOf(db, existing.id);
    // Nothing is asked before a delete; the toast offers the way back instead (lib/undo.ts). The
    // photo goes from disk only once that chance has passed — Undo puts back a row, not a file.
    const gone = (withShares: boolean) => {
      setDone(true);
      const rows = [existing, ...(withShares ? shares : [])];
      mutate((d) => { for (const r of rows) remove(d, "transactions", r.id); });
      offerUndo({
        label: t("misc.deleted", { count: rows.length }),
        undo: () => mutate((d) => { for (const r of rows) save(d, "transactions", { ...r, deleted: 0 }); }),
        commit: () => releasePhoto(existing.photo, existing.id),
      });
      router.back();
    };
    // The one question left is a real choice, not a confirmation: whether the friends still owe it.
    if (!shares.length) { gone(false); return; }
    Alert.alert(t("people.event.deleteShares", { count: shares.length }), t("people.event.deleteSharesBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("people.event.keepShares"), onPress: () => gone(false) },
      { text: t("people.event.deleteAll"), style: "destructive", onPress: () => gone(true) },
    ]);
  };
  // ± and the segmented control both negate the signed expression; on an empty expression
  // there's nothing to negate, so they just switch the default mode instead.
  const negate = () => {
    if (!expr) { setDefaultMode((m) => (m === "expense" ? "income" : "expense")); return; }
    setExpr(negateExpr(expr));
  };
  const changeKind = (k: Kind) => {
    if (k === "transfer") {
      // A saved entry becomes one leg of the transfer — the side its sign says, on its own account —
      // and keeps its id (createTransfer's `keep`); it brings along everything typed here so far.
      // Nothing is written until the transfer sheet saves, and Back returns here unchanged.
      const params = existing
        ? { convert: existing.id, [kind === "income" ? "to" : "from"]: accountId, date, ...(note.trim() ? { note: note.trim() } : {}), ...(categoryId ? { category: categoryId } : {}), ...(tagIds.length ? { tags: tagIds.join(",") } : {}) }
        // A new entry names no side: the account it was being typed on is a default, not a choice
        // about where the money left, so the transfer sheet asks for both accounts.
        : { date, ...(note.trim() ? { note: note.trim() } : {}) };
      const go = () => { setStacked(true); router.push({ pathname: "/transfer/[id]", params: { id: "new", ...params, amount: value !== null ? String(value) : "", stacked: "1" } }); };
      Alert.alert(t("transaction.entry.makeTransfer.title"), existing ? t("transaction.entry.makeTransfer.convert") : value !== null ? t("transaction.entry.makeTransfer.moved", { amount: formatMinor(toMinor(value, currency), currency), currency }) : t("transaction.entry.makeTransfer.empty"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("transaction.entry.makeTransfer.action"), onPress: go },
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
  // The field always prints the decimals, so a number typed without a point ("20", shown 20,00) is
  // still being typed in its whole units: the next digit makes it 200,00, and the caret says so.
  const typingWhole = caret.whole || !(expr.split(/[+−×÷]/).pop() ?? "").includes(".");
  const decimalAt = typingWhole ? shown.lastIndexOf(numberFormat().decimal) : -1;
  const caretMark = <Caret pulse={caret.pulse} color={C.tint as unknown as string} />;
  // A split is several entries with a category each, so Debt is only offered for a single one.
  const openCategory = () => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: kind === "income" ? "income" : "expense", selected: debtId ? `debt:${debtId}` : categoryId ?? "", ...(parts.length ? {} : { debts: "1" }), ...shopParams(payee, note.trim() || bankNote, existing?.id) } });
  const catIcon = category ? iconFor(category.name, { icon: category.icon, color: category.color }) : null;

  const oneAccount = accounts.length <= 1 && !!account;
  // Transfer needs two accounts to be a transfer at all, so with one it is not offered; nor while
  // parts are carved off, since a split is several entries and a transfer is one movement.
  const kinds: Kind[] = ["expense", "income", ...(accounts.length > 1 && !existing?.transfer_id && !parts.length ? ["transfer" as const] : [])];
  const kindLabel = (k: Kind) => t(`transaction.entry.kind.${k}`);
  const openKind = () => ActionSheetIOS.showActionSheetWithOptions(
    { options: [...kinds.map(kindLabel), t("common.cancel")], cancelButtonIndex: kinds.length },
    (i) => { if (i < kinds.length && kinds[i] !== kind) changeKind(kinds[i]!); });
  // The sheet is as tall as what it holds, and the Save bar at its foot has to be on screen whatever
  // the screen: the folded iPhone Duo's outer one is 678 pt. So the sheet measures itself and, when
  // it runs past the room a sheet gets, gives up the difference (`squeeze`): first the chip grid puts
  // its icons beside the labels (28 pt), then the keypad's 4.72 rows shrink, down to 32 pt a key.
  // The room is the window less its own top inset (inside a sheet the inset reads 0), the gap iOS
  // leaves above a sheet, and a cushion for the display's rounded foot. With room again (unfolded)
  // it gives the height back.
  const { height: windowHeight } = useWindowDimensions();
  const { top: sheetTop } = useSafeAreaInsets();
  const windowTop = Math.max(sheetTop, initialWindowMetrics?.insets.top ?? 0);
  const [squeeze, setSqueeze] = useState(0);
  const flatChips = squeeze > 0;
  const keyHeight = Math.max(KEY_MIN, KEY_HEIGHT - Math.ceil(Math.max(0, squeeze - FLAT_SAVES) / 4.72));
  const fitSheet = (e: LayoutChangeEvent) => {
    if (noteOpen) return;
    const over = e.nativeEvent.layout.height - (windowHeight - windowTop - SHEET_GAP - SHEET_CUSHION);
    const next = Math.min(MAX_SQUEEZE, Math.max(0, squeeze + over));
    // Shrinking at once; growing back only for a real gain, or the two would take turns.
    if (over > 0 ? next > squeeze : next < squeeze - 8) setSqueeze(next);
  };
  const balanceToggle = (start?: boolean) => (
    <BalanceToggle start={start} balance={balance} after={valid && after !== balance ? after : null} currency={currency}
      afterColor={(after < 0 ? C.red : kind === "income" ? C.green : C.label) as unknown as string} />
  );
  return (
    <SheetFrame onLayout={fitSheet}
      top={
        <View style={styles.top}>
          {/* Return and Duplicate used to sit in this corner as a lone round arrow, where a back or an undo
              button is expected — so they live in the chip grid below now (its last cell), and the corner
              holds only Delete, on the right, on a saved entry. */}
          {existing ? <Tap onPress={del} hitSlop={10} style={styles.trash} accessibilityRole="button" accessibilityLabel={t("transaction.entry.deleteA11y")}><SymbolView name="trash" size={16} tintColor={C.red} /></Tap> : null}
          <Tap onPress={copyAmount} disabled={value === null} style={styles.amountRow} accessibilityRole="button"
            accessibilityLabel={t("transaction.entry.amountA11y", { amount: `${expr ? signChar : ""}${shown}`, currency })}>
            <Text style={[styles.amount, { color: expr ? signColor : C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{expr ? signChar : ""}{decimalAt > 0 ? <>{shown.slice(0, decimalAt)}{caretMark}{shown.slice(decimalAt)}</> : <>{shown}{caretMark}</>}</Text>
            <Text style={styles.currency}>{currency}</Text>
          </Tap>
          {/* Only while there is a sum to show: kept as an empty line, it pushed the amount off the middle. */}
          {copied ? <Text style={[styles.result, { color: C.tint }]}>{t("transaction.entry.copied")}</Text> : /[+−×÷]/.test(expr.replace(/^−/, "")) ? <CalcLine expr={expr} style={styles.result} /> : null}
          <View style={styles.details}>
            {/* The note is the entry's title, so the line shows it whole where it fits and ends in an
                ellipsis where it does not — four lines is as much as the sheet can spare. With no note
                there is no line: an "Add a note" placeholder did exactly what the Note chip does, at the
                cost of a row a small phone takes out of the keypad. */}
            {note ? (
              <Tap onPress={openNote} style={[styles.line, styles.noteLine]} accessibilityRole="button" accessibilityLabel={t("transaction.entry.noteA11y", { note })}>
                <SymbolView name="text.alignleft" size={14} tintColor={C.secondary} /><Text style={styles.lineText} numberOfLines={2}>{note}</Text>
              </Tap>
            ) : null}
            {toSplit ? (
              <Tap onPress={() => setToSplit(false)} style={styles.line} accessibilityRole="button" accessibilityLabel={t("people.toSplit.markedA11y")}>
                <SymbolView name="square.split.2x1" size={14} tintColor={C.tint} /><Text style={[styles.lineText, { color: C.tint }]}>{t("people.toSplit.mark")}</Text>
              </Tap>
            ) : null}
            {/* What the bank said, under your note and apart from it: read here, never edited. */}
            {bankNote ? (
              <View style={[styles.line, styles.noteLine]} accessible accessibilityLabel={t("transaction.entry.bankNoteA11y", { note: bankNote })}>
                <SymbolView name="building.columns" size={14} tintColor={C.secondary} /><Text style={[styles.lineText, styles.bankText]} numberOfLines={2} selectable>{bankNote}</Text>
              </View>
            ) : null}
            {/* A place name without coordinates is a location too: a Shortcut automation, a filled-in
                payment or a scanned receipt names the shop without ever pinning it on the map. */}
            {/* Only once there is a place: an "Add a place" line did what the Place key does, in a row the
                keypad needs. */}
            {coords || place ? (
              <View style={styles.line}>
                <Tap onPress={openLocation} style={[styles.line, { flex: 1 }]} accessibilityRole="button" accessibilityLabel={place ?? t("transaction.entry.locationPinned")}>
                  <SymbolView name="mappin.and.ellipse" size={14} tintColor={C.secondary} /><Text style={styles.lineText}>{(() => {
                    const where = place ?? (coords ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : "");
                    return suggested ? t("transaction.entry.placeSuggested", { place: where }) : where;
                  })()}</Text>
                </Tap>
              </View>
            ) : null}
            {parts.length && splitMinors ? (
              <Tap onPress={() => openSplit()} style={styles.line} accessibilityRole="button"
                accessibilityLabel={t("transaction.entry.splitA11y", { count: parts.length + 1 })}>
                <SymbolView name="square.split.2x1" size={14} tintColor={C.secondary} />
                <Text style={styles.lineText}>
                  {splitMinors.map((minor, i) => `${formatMinor(minor, currency)} ${i === 0 ? (category ? catName(category) : t("transaction.entry.splitThisEntry")) : (catNames.get(parts[i - 1]!.category_id ?? "") ?? t("transaction.entry.splitNoCategory"))}`).join(" · ")}
                </Text>
              </Tap>
            ) : null}
            {refunded ? (
              <Tap onPress={undoReturns} style={styles.line} accessibilityRole="button"
                accessibilityLabel={t("transaction.entry.returnedA11y", { back: formatMinor(Math.abs(refunded), currency), currency, paid: formatMinor(Math.abs(paidAmountMinor(existing!)), currency) })}>
                <SymbolView name="arrow.uturn.backward" size={14} tintColor={C.green as unknown as string} />
                <Text style={styles.lineText}>{t("transaction.entry.returnedLine", { back: formatMinor(Math.abs(refunded), currency), paid: formatMinor(Math.abs(paidAmountMinor(existing!)), currency) })}</Text>
              </Tap>
            ) : null}
            {/* The photo, and what it says, on one line: the total once read (the shop is the payee already), a spinner
                until then, and Update when the receipt says something the entry does not. */}
            {photoSrc ? (
              <Animated.View layout={LinearTransition} style={styles.photoLine}>
                <Tap onPress={openPhoto} style={styles.photoMain} accessibilityRole="button" accessibilityLabel={t("transaction.entry.photoA11y")}>
                  <Image source={{ uri: photoSrc }} style={styles.thumb} contentFit="cover" />
                  <Text style={[styles.lineText, { flex: 1 }]}>
                    {receipt ? `${formatMinor(toMinor(receipt.total, receipt.currency ?? currency), receipt.currency ?? currency)} ${receipt.currency ?? currency}` : t("transaction.entry.photo")}
                  </Text>
                </Tap>
                {!filled && receipt && changes.length ? (
                  <Tap onPress={() => void fillFromReceipt(receipt)} style={styles.receiptBtn} accessibilityRole="button" accessibilityLabel={t("transaction.entry.fromReceipt.update")}>
                    <SymbolView name="wand.and.sparkles" size={13} tintColor={C.onTint} />
                    <ButtonText style={styles.receiptBtnText}>{t("transaction.entry.fromReceipt.update")}</ButtonText>
                  </Tap>
                ) : busyReading ? <ActivityIndicator size="small" /> : null}
              </Animated.View>
            ) : null}
            {tags.length ? (
              <View style={[styles.line, { flexWrap: "wrap" }]}>
                <SymbolView name="number" size={14} tintColor={C.secondary} />
                {tags.map((tag) => <TagPill key={tag.id} name={tag.name} color={tag.color} onPress={() => setTagIds((ids) => ids.filter((x) => x !== tag.id))} />)}
              </View>
            ) : null}
          </View>
          {/* The balance first, a size up, so it reads apart from the place and the note above it; then
              one row of pills: the account (gone with one account, there is nothing to choose) and what
              kind of entry this is, which used to take a row of its own over the keypad. */}
          <View style={styles.accountRow}>
            {balanceToggle(true)}
            <View style={styles.pillRow}>
              {!oneAccount ? (
                <Tap onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.acc, selected: accountId } })} style={[styles.accountPill, { flexShrink: 1 }]} accessibilityRole="button" accessibilityLabel={t("transaction.entry.accountA11y", { name: acctName(account) ?? t("transaction.entry.accountNone") })}>
                <View style={[styles.accountIcon, { backgroundColor: account?.color ?? (C.tint as unknown as string) }]}><SymbolView name={accountIcon(account?.type ?? "bank")} size={14} tintColor={account?.color ? "white" : C.onTint} /></View>
                {/* One line that shrinks to fit: unclipped, a long name ran under the balance. */}
                <ButtonText fit={1} style={styles.accountText} maxFontSizeMultiplier={1.3}>{acctName(account) ?? t("transaction.entry.chooseAccount")}</ButtonText>
                <SymbolView name="chevron.down" size={12} tintColor={C.tertiary} />
              </Tap>
              ) : null}
              <Tap onPress={openKind} disabled={kinds.length < 2} style={styles.accountPill} accessibilityRole="button" accessibilityLabel={t("transaction.entry.kindA11y", { kind: kindLabel(kind) })}>
                <SymbolView name={kind === "income" ? "arrow.down.left" : "arrow.up.right"} size={14}
                  tintColor={(kind === "income" ? C.green : C.red) as unknown as string} />
                <ButtonText fit={1} style={[styles.accountText, kind === "income" && { color: C.green }]} maxFontSizeMultiplier={1.3}>{kindLabel(kind)}</ButtonText>
                {kinds.length > 1 ? <SymbolView name="chevron.down" size={12} tintColor={C.tertiary} /> : null}
              </Tap>
            </View>
          </View>
        </View>
      }
      bottom={noteOpen ? (
        <View style={styles.noteBox}>
          {/* Multiline, so Return writes a line instead of closing the field: Done closes it. The box
              grows with the note up to eight lines or so and scrolls beyond that, with the line that
              does not fit left half-shown so it is plain there is more. */}
          <TextInput ref={noteRef} autoFocus multiline value={note} onChangeText={setNote} placeholder={t("transaction.entry.notePlaceholder")} placeholderTextColor={C.tertiary} style={styles.noteInput}
            onFocus={noteFocused}
            onBlur={() => setNoteOpen(false)} accessibilityLabel={t("transaction.entry.notePlaceholder")} />
          <Tap onPress={() => setNoteOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.done")}><ButtonText style={styles.noteDone} maxFontSizeMultiplier={1.3}>{t("common.done")}</ButtonText></Tap>
        </View>
      ) : (
        <>
          {/* Two rows, always, and every chip in its own fixed place (ChipGrid): the third row a long
              language or a big text size used to wrap onto pushed the keypad down, and a chip that moved
              with every label could not be found by feel. The last cell is the one action on the amount
              rather than an attribute of it: Return on a new entry (the amount came back on an earlier
              expense, packages/core/returns.ts), Duplicate on a saved one. */}
          <ChipGrid flat={flatChips}>
            <Chip cell icon="calendar" label={dayChipLabel(date)} active={date.slice(0, 10) !== todayLocal()} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: date.slice(0, 10) } })} />
            <Chip cell icon="clock" label={timeLabel(date)} onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: timeLabel(date) } })} />
            <Chip cell icon="text.alignleft" label={t("transaction.entry.chip.note")} active={!!note} onPress={openNote} />
            <Chip cell icon="mappin.and.ellipse" label={t("transaction.entry.chip.place")} active={!!coords || !!place} onPress={openLocation} />
            <Chip cell icon="camera" label={t("transaction.entry.chip.photo")} active={!!photoSrc} onPress={openPhoto} />
            <Chip cell icon="hourglass" label={t("transaction.entry.chip.pending")} active={pending} onPress={() => setPending((v) => !v)} />
            <Chip cell icon="square.split.2x1" label={t("transaction.entry.chip.split")} active={parts.length > 0} disabled={!valid} onPress={() => openSplit()}
              onLongPress={splitLater} a11yHint={t("transaction.entry.splitLaterHint")} />
            {isNew
              ? <Chip cell icon="arrow.uturn.backward" label={t("transaction.entry.chip.return")} disabled={!valid} onPress={askForReturn} />
              : <Chip cell icon="plus.square.on.square" label={t("transaction.entry.chip.duplicate")} onPress={duplicate} />}
          </ChipGrid>
          <Keypad value={expr} onChange={onKeypadChange} onEdit={onEdit} onToggleSign={negate} keyHeight={keyHeight}
            extra={debt
              ? { label: t("transaction.entry.debtKey", { person: debt.person }), a11y: t("transaction.entry.debtKeyA11y", { person: debt.person }), icon: "creditcard.and.123", active: true, onPress: openCategory }
              : { label: category ? catName(category) : t("keypad.category"), a11y: category ? t("keypad.categoryA11y", { name: catName(category) }) : t("keypad.categoryNone"), icon: catIcon ? (catIcon.icon as SFSymbol) : "folder.badge.plus", color: catIcon?.color, active: !!category, onPress: openCategory }}
            extra2={{ a11y: tags.length ? t("keypad.tagsA11y", { names: tags.map((tag) => tag.name).join(", ") }) : t("keypad.tags"), icon: "number", badge: tags.length || undefined, active: tags.length > 0, onPress: () => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } }) }} />
          <ConfirmBar amount={`${value !== null ? signChar + formatMinor(toMinor(value, currency), currency) : formatMinor(0, currency)} ${currency}`}
            label={valid ? (existing ? t("transaction.entry.tapToSave") : t("transaction.entry.tapToAdd")) : t("transaction.entry.enterAmount")} onPress={commit} disabled={!valid} color={pending ? (C.orange as unknown as string) : kind === "income" ? (C.green as unknown as string) : undefined} />
        </>
      )}
    />
  );
}

/**
 * The balance as plain text, on the right of the account pill (or of the place line, with one
 * account) — before → after, the currency once. Tapping the balance hides it behind dots (an eye says it can come back), so a
 * screenshot shows no numbers unless Settings → Show balance when logging says otherwise. It used to
 * be a second pill that unwrapped a third line, which was a lot of furniture for one number.
 *
 * The switch keeps its own state, so showing it re-renders this row and not the whole sheet. The
 * numbers shrink to fit the line rather than wrap. `start` lines them up on the left, under the account pill.
 */
function BalanceToggle({ start, balance, after, afterColor, currency }: { start?: boolean; balance: number; after: number | null; afterColor: string; currency: string }) {
  const [shown, setShown] = useState(getShowBalance);
  return (
      <Tap onPress={() => setShown((v) => !v)} hitSlop={10} style={[styles.balance, start && styles.balanceStart]} accessibilityRole="button"
        accessibilityHint={shown ? t("transaction.entry.hideBalance") : t("transaction.entry.showBalance")}
        accessibilityLabel={!shown ? t("transaction.entry.balance") : after !== null ? t("transaction.entry.balanceAfterA11y", { balance: formatMinor(balance, currency), after: formatMinor(after, currency), currency }) : t("transaction.entry.balanceA11y", { balance: formatMinor(balance, currency), currency })}>
        <SymbolView name={shown ? "eye" : "eye.slash"} size={14} tintColor={C.tertiary} />
        {/* Shrinks rather than ending in "…": an ellipsis in an amount hides digits. */}
        <ButtonText fit={1} style={styles.accountBal}>
          {shown ? formatMinor(balance, currency) : "•••••"}
          {shown && after !== null ? <>{" → "}<Text style={{ fontWeight: "600", color: afterColor }}>{formatMinor(after, currency)}</Text></> : null}
          {` ${currency}`}
        </ButtonText>
      </Tap>
  );
}

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.md, paddingTop: S.lg, paddingBottom: S.xs, gap: 4 },
  amountRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8, maxWidth: "100%" },
  amount: { fontSize: 54, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  currency: { fontSize: 22, color: C.secondary, fontWeight: "600" },
  result: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"], minHeight: 20, textAlign: "center" },
  details: { alignSelf: "stretch", gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 24 },
  noteLine: { alignItems: "flex-start", paddingVertical: 4 },
  bankText: { color: C.secondary },
  lineText: { color: C.label, fontSize: 15, flexShrink: 1 },
  placeholder: { color: C.tertiary },
  photoLine: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34 },
  photoMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  receiptBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, minHeight: 34, borderRadius: R.pill, backgroundColor: C.tint },
  receiptBtnText: { color: C.onTint, fontSize: 15, fontWeight: "600" },
  thumb: { width: 28, height: 28, borderRadius: 6, backgroundColor: C.fill },
  accountRow: { alignItems: "flex-start", gap: S.sm, alignSelf: "stretch", marginTop: S.sm },
  pillRow: { flexDirection: "row", alignItems: "center", gap: S.sm, alignSelf: "stretch" },
  accountPill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 22, paddingHorizontal: 12, minHeight: 40, paddingVertical: 6, maxWidth: "100%" },
  accountIcon: { width: 26, height: 26, borderRadius: R.sm, alignItems: "center", justifyContent: "center" },
  accountText: { fontSize: 15, color: C.label, flexShrink: 1 },
  accountBal: { ...Type.body, color: C.secondary, fontVariant: ["tabular-nums"], flexShrink: 1 },
  balance: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 6, minHeight: 24, minWidth: 90 },
  balanceStart: { flex: 0, alignSelf: "stretch", justifyContent: "flex-start" },
  trash: { position: "absolute", top: 8, right: S.md, width: 34, height: 34, borderRadius: R.pill, backgroundColor: C.fill, alignItems: "center", justifyContent: "center", zIndex: 1 },
  noteBox: { flexDirection: "row", alignItems: "flex-end", gap: S.md, marginHorizontal: S.md, backgroundColor: C.card, borderRadius: R.card, paddingHorizontal: S.md, paddingVertical: 8, minHeight: 50 },
  noteInput: { flex: 1, fontSize: 17, color: C.label, minHeight: 34, maxHeight: 176, paddingTop: 7, paddingBottom: 7 },
  noteDone: { color: C.tint, fontSize: 17, fontWeight: "700", paddingVertical: 7 },
}));

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
type ReturnReason = Exclude<ReturnType<typeof checkReturn>, { ok: true }>["reason"];
function returnReason(reason: ReturnReason): string {
  switch (reason) {
    case "transfer": return t("transaction.entry.returnReason.transfer");
    case "too-much": return t("transaction.entry.returnReason.tooMuch");
    case "wrong-direction": return t("transaction.entry.returnReason.wrongDirection");
    default: return t("transaction.entry.returnReason.gone");
  }
}

/** What the entry sheet may give up to keep Save on screen (see `fitSheet`). */
const KEY_MIN = 32;
const FLAT_SAVES = 28;
const MAX_SQUEEZE = FLAT_SAVES + Math.ceil((KEY_HEIGHT - KEY_MIN) * 4.72);
const SHEET_GAP = 12;
const SHEET_CUSHION = 16;
