import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, LayoutAnimation, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/build/react-navigation/core/usePreventRemove";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { accountBalanceMinor, createTransaction, getRow, listRows, rateOrFallback, remove, save, suggestCategoryNear, toMinor, fromMinor, formatMinor, iconFor, jsonIds, trimNumber, withTripTag, type Transaction } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, applyKeySigned, evalExpr, exprSign, hasOperator, negateExpr } from "@/components/Keypad";
import { Chip, ChipRow, Segmented, SheetFrame, TagPill, accountIcon } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { dayLabel, dayWithNow, localIso, timeLabel, todayLocal, withTime } from "@/lib/dates";
import { ensureLocationPermission, placeName, quickLocation, type Coords } from "@/lib/location";
import { getCurrentAccount, getLocationEnabled, getShowBalance, setLocationEnabled } from "@/lib/settings";
import { RECEIPT_SCANNER_ENABLED } from "@/constants/features";
import { markSheetPainted } from "@/lib/boot";
import { deletePhoto, keepPhoto, photoUri } from "@/lib/photos";
import type { ReceiptParse } from "@/lib/bridge";

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
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((t) => tagIds.includes(t.id)), [tagIds.join(",")]);

  // The expression is the signed amount; `kind` follows its sign, falling back to the
  // stored default while empty or not evaluable (e.g. still ending in an operator).
  const raw = evalExpr(expr);
  const value = raw !== null ? Math.abs(raw) : null;
  const valid = value !== null && value > 0 && !!account;
  const pendingOp = hasOperator(expr);
  const sign = exprSign(expr);
  const kind: "expense" | "income" = sign === 1 ? "income" : sign === -1 ? "expense" : defaultMode;
  const signChar = kind === "expense" ? "−" : "+";
  const signed = value !== null ? toMinor(value, currency) * (kind === "expense" ? -1 : 1) : 0;
  const after = balance + signed - (existing && existing.account_id === account?.id ? existing.amount_minor : 0);

  const keys = useMemo(() => ({ cat: newPickKey("cat"), acc: newPickKey("acc"), tags: newPickKey("tags"), date: newPickKey("date"), time: newPickKey("time"), loc: newPickKey("loc"), receipt: newPickKey("receipt"), shot: newPickKey("shot"), photo: newPickKey("photo") }), []);
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
      void rateOrFallback(db, r.currency, currency).then((x) => { if (x) apply(r.total * x.rate); else { apply(r.total); Alert.alert(`Receipt is in ${r.currency}`, "No exchange rate available offline; the number was kept as is."); } }).catch(() => apply(r.total));
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
    Alert.alert(`Convert to ${next.currency}?`, `The amount is ${formatMinor(toMinor(value, prev.currency), prev.currency)} ${prev.currency}. ${next.name} is in ${next.currency}.`, [
      { text: "Keep the number", style: "cancel" },
      { text: `Convert to ${next.currency}`, onPress: () => { void rateOrFallback(db, prev.currency, next.currency).then((r) => { if (!r) { Alert.alert("No exchange rate available offline"); return; } const converted = Math.round(value * r.rate * 100) / 100; setExpr(kind === "expense" ? `−${converted}` : String(converted)); }).catch(() => Alert.alert("No exchange rate available offline")); } },
    ]);
  });
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  usePickResult<string>(keys.date, useCallback((day: string) => setDate((d) => (day === d.slice(0, 10) ? d : day === todayLocal() ? localIso() : dayWithNow(day))), []));
  usePickResult<string>(keys.time, useCallback((hhmm: string) => setDate((d) => withTime(d, hhmm)), []));
  usePickResult<(Coords & { place: string | null }) | null>(keys.loc, useCallback((v: (Coords & { place: string | null }) | null) => { setCoords(v ? { lat: v.lat, lon: v.lon } : null); setPlace(v?.place ?? null); }, []));
  // Boot trace: the frame after this sheet first commits (a cold `kopiyka://log` launch's target). See lib/boot.ts's `bootTrace`.
  useEffect(() => {
    const id = requestAnimationFrame(markSheetPainted);
    return () => cancelAnimationFrame(id);
  }, []);
  useFocusEffect(useCallback(() => { setStacked(false); }, []));
  const unwrap = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpanded((v) => !v); };

  // Coarse location for new entries: attach it, and suggest the category used here before.
  useEffect(() => {
    if (!isNew) return;
    let alive = true;
    void quickLocation().then(async (c) => {
      if (!c || !alive) return;
      setCoords((cur) => cur ?? c);
      const s = suggestCategoryNear(db, c.lat, c.lon);
      if (s && alive) setCategoryId((cur) => { if (cur) return cur; setSuggested(true); return s.category_id; });
      const name = s?.place ?? (await placeName(c));
      if (alive && name) setPlace((cur) => cur ?? name);
    });
    return () => { alive = false; };
  }, [isNew]);

  const persist = () => {
    if (!valid || !account) return false;
    const minor = toMinor(value!, currency) * (kind === "expense" ? -1 : 1);
    // A new shot replaces the stored file; clearing the photo removes it.
    let photoName = photo;
    if (shot) { try { photoName = keepPhoto(shot); if (existing?.photo) deletePhoto(existing.photo); } catch { photoName = photo; } }
    else if (existing?.photo && !photo) deletePhoto(existing.photo);
    mutate((d) => {
      const base = { account_id: account.id, date, amount_minor: minor, category_id: categoryId, payee, notes: note.trim() || null, tag_ids: JSON.stringify(tagIds), pending: pending ? 1 : 0, lat: coords?.lat ?? null, lon: coords?.lon ?? null, place, photo: photoName } as const;
      if (existing) save(d, "transactions", { ...existing, ...base } as Transaction);
      else createTransaction(d, base);
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
    { text: "Delete", style: "destructive", onPress: () => { setDone(true); deletePhoto(existing.photo); mutate((d) => remove(d, "transactions", existing.id)); router.back(); } },
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
  // Location stays off until the user says so: the first tap on Place asks, then requests the iOS permission.
  const openLocation = () => {
    if (locationOn || coords || place) { pickLocation(); return; }
    Alert.alert("Remember where you spend?", "Kopiyka attaches a coarse location to what you log and suggests the category you used at the same place. You can turn this off in Settings.", [
      { text: "Not now", style: "cancel" },
      { text: "Turn on", onPress: () => { void ensureLocationPermission().then((ok) => { if (!ok) return; setLocationEnabled(true); pickLocation(); }); } },
    ]);
  };

  const signColor = kind === "expense" ? C.label : C.green;
  const shown = expr ? (pendingOp ? expr : value !== null ? formatMinor(toMinor(value, currency), currency) : expr) : "0";
  const catIcon = category ? iconFor(category.name, { icon: category.icon, color: category.color }) : null;

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          {existing ? <Pressable onPress={duplicate} hitSlop={10} style={styles.corner} accessibilityRole="button" accessibilityLabel="Duplicate transaction"><SymbolView name="plus.square.on.square" size={16} tintColor={C.tint} /></Pressable> : null}
          {existing ? <Pressable onPress={del} hitSlop={10} style={styles.trash} accessibilityRole="button" accessibilityLabel="Delete transaction"><SymbolView name="trash" size={16} tintColor={C.red} /></Pressable> : null}
          <View style={styles.amountRow}>
            <Text style={[styles.amount, { color: expr ? signColor : C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{expr && !pendingOp ? signChar : ""}{shown}</Text>
            <Text style={styles.currency}>{currency}</Text>
          </View>
          <Text style={styles.result}>{pendingOp ? `= ${value !== null ? signChar + formatMinor(toMinor(value, currency), currency) : "…"}` : " "}</Text>
          <View style={styles.details}>
            <Pressable onPress={() => setNoteOpen(true)} style={styles.line} accessibilityRole="button" accessibilityLabel={note ? `Note: ${note}` : "Add a note"}>
              <SymbolView name="text.alignleft" size={14} tintColor={C.secondary} /><Text style={[styles.lineText, !note && styles.placeholder]} numberOfLines={2}>{note || "Add a note"}</Text>
            </Pressable>
            {/* A place name without coordinates is a location too: a Shortcut automation, a filled-in
                payment or a scanned receipt names the shop without ever pinning it on the map. */}
            {coords || place || locationOn ? (
              <Pressable onPress={openLocation} style={styles.line} accessibilityRole="button" accessibilityLabel={place ?? (coords ? "Location: pinned" : "Add location")}>
                <SymbolView name="mappin.and.ellipse" size={14} tintColor={C.secondary} /><Text style={[styles.lineText, !coords && !place && styles.placeholder]} numberOfLines={1}>{place ?? (coords ? `${coords.lat.toFixed(4)}, ${coords.lon.toFixed(4)}` : "Add location")}{suggested ? " · category suggested" : ""}</Text>
              </Pressable>
            ) : null}
            {photoSrc ? (
              <Pressable onPress={openPhoto} style={styles.line} accessibilityRole="button" accessibilityLabel="Photo attached">
                <Image source={{ uri: photoSrc }} style={styles.thumb} contentFit="cover" /><Text style={styles.lineText}>Photo{shot ? " · not saved yet" : ""}</Text>
              </Pressable>
            ) : null}
            {tags.length ? (
              <View style={[styles.line, { flexWrap: "wrap" }]}>
                <SymbolView name="number" size={14} tintColor={C.secondary} />
                {tags.map((t) => <TagPill key={t.id} name={t.name} color={t.color} onPress={() => setTagIds((ids) => ids.filter((x) => x !== t.id))} />)}
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
            <View style={styles.balanceLine} accessibilityLabel={`Balance ${formatMinor(balance, currency)} ${currency}${valid && after !== balance ? `, after ${formatMinor(after, currency)} ${currency}` : ""}`}>
              <Text style={styles.accountBal}>{formatMinor(balance, currency)}</Text>
              {valid && after !== balance ? <><SymbolView name="arrow.right" size={11} tintColor={C.tertiary} /><Text style={[styles.accountBal, { fontWeight: "600", color: after < 0 ? C.red : kind === "income" ? C.green : C.label }]}>{formatMinor(after, currency)}</Text></> : null}
              <Text style={styles.accountBal}>{currency}</Text>
            </View>
          ) : null}
        </View>
      }
      bottom={noteOpen ? (
        <View style={styles.noteBox}>
          <TextInput ref={noteRef} autoFocus value={note} onChangeText={setNote} placeholder="Note" placeholderTextColor={C.tertiary} style={styles.noteInput}
            returnKeyType="done" blurOnSubmit onSubmitEditing={() => setNoteOpen(false)} onBlur={() => setNoteOpen(false)} accessibilityLabel="Note" />
          <Pressable onPress={() => setNoteOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done"><Text style={styles.noteDone}>Done</Text></Pressable>
        </View>
      ) : (
        <>
          <View style={{ paddingHorizontal: S.md }}>
            {/* Transfer needs two accounts to be a transfer at all, so with one it is not offered. */}
            <Segmented value={kind} onChange={changeKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income", color: C.green as unknown as string }, ...(isNew && accounts.length > 1 ? [{ value: "transfer" as Kind, label: "Transfer" }] : [])]} />
          </View>
          <ChipRow>
            <Chip icon="calendar" label={dayLabel(date)} active={date.slice(0, 10) !== todayLocal()} onPress={() => router.push({ pathname: "/pick/date", params: { key: keys.date, selected: date.slice(0, 10) } })} />
            <Chip icon="clock" label={timeLabel(date)} compact onPress={() => router.push({ pathname: "/pick/time", params: { key: keys.time, selected: timeLabel(date) } })} />
            <Chip icon="text.alignleft" label="Note" active={!!note} onPress={() => setNoteOpen(true)} />
            <Chip icon="mappin.and.ellipse" label="Place" active={!!coords || !!place} onPress={openLocation} />
            <Chip icon="hourglass" label="Pending" active={pending} compact onPress={() => setPending((v) => !v)} />
            <Chip icon="camera" label="Photo" active={!!photoSrc} compact onPress={openPhoto} />
            {isNew && RECEIPT_SCANNER_ENABLED ? <Chip icon="doc.text.viewfinder" label="Receipt" compact onPress={() => router.push({ pathname: "/receipt/scan", params: { key: keys.receipt } })} /> : null}
          </ChipRow>
          <Keypad value={expr} onChange={onKeypadChange} onToggleSign={negate}
            extra={{ label: category ? category.name : "Category", a11y: `Category: ${category ? category.name : "none"}`, icon: catIcon ? (catIcon.icon as SFSymbol) : "folder.badge.plus", color: catIcon?.color, active: !!category, onPress: () => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: kind === "income" ? "income" : "expense", selected: categoryId ?? "" } }) }}
            extra2={{ a11y: tags.length ? `Tags: ${tags.map((t) => t.name).join(", ")}` : "Tags", icon: "number", badge: tags.length || undefined, active: tags.length > 0, onPress: () => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } }) }} />
          <ConfirmBar amount={`${value !== null ? signChar + formatMinor(toMinor(value, currency), currency) : "0.00"} ${currency}`}
            label={valid ? (existing ? "Tap to save" : "Tap to add") : "Enter an amount"} onPress={commit} disabled={!valid} color={pending ? (C.orange as unknown as string) : kind === "income" ? (C.green as unknown as string) : undefined} />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xs, gap: 6 },
  amountRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8, maxWidth: "100%" },
  amount: { fontSize: 54, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  currency: { fontSize: 22, color: C.secondary, fontWeight: "600" },
  result: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"], minHeight: 20, textAlign: "center" },
  details: { alignSelf: "stretch", gap: 4, paddingHorizontal: S.xs },
  line: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 },
  lineText: { color: C.label, fontSize: 15, flexShrink: 1 },
  placeholder: { color: C.tertiary },
  thumb: { width: 28, height: 28, borderRadius: 6, backgroundColor: C.fill },
  accountRow: { flexDirection: "row", alignItems: "center", gap: S.sm, alignSelf: "stretch", marginTop: 4 },
  accountPill: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.fill, borderRadius: 22, paddingHorizontal: 12, minHeight: 40, paddingVertical: 6, flexShrink: 1 },
  accountIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  accountText: { fontSize: 15, color: C.label, flexShrink: 1 },
  accountBal: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"] },
  balanceLine: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: S.xs, marginTop: 2 },
  unwrap: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, backgroundColor: C.fill, flexShrink: 1 },
  corner: { position: "absolute", top: 8, left: S.md, width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill, alignItems: "center", justifyContent: "center", zIndex: 1 },
  trash: { position: "absolute", top: 8, right: S.md, width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill, alignItems: "center", justifyContent: "center", zIndex: 1 },
  noteBox: { flexDirection: "row", alignItems: "center", gap: S.md, marginHorizontal: S.md, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: S.md, minHeight: 50 },
  noteInput: { flex: 1, fontSize: 17, color: C.label, height: 50 },
  noteDone: { color: C.tint, fontSize: 17, fontWeight: "700" },
});
