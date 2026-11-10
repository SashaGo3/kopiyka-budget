import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activeTrip, budgetPeople, divideShares, formatMinor, iconFor, listPeople, listRows, splitAmounts, type ShareItem, type SplitPart } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { ConfirmBar } from "@/components/Keypad";
import type { AmountPick } from "@/app/pick/amount";
import { ButtonText, ModalHeader, TagPill, Tap, ToggleRow } from "@/components/ui";
import { PersonAvatar } from "@/components/PersonAvatar";
import { C, S, themed } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";
import { catName } from "@/lib/names";

/** A part as the editor holds it: the payload plus a key React and the pickers can address it by. */
type Row = SplitPart & { key: string };

/**
 * A friend in the split. Their share is an equal part of whatever nobody claimed, plus their own
 * items — unless an amount was typed for them (`fixed`), which is then the whole of it.
 */
type Friend = { key: string; person_id: string; items: ShareItem[]; fixed: number | null };

export interface SplitResult {
  main: { category_id: string | null; tag_ids: string[] };
  /** Own parts first, then one per friend (with `person_id`): what the entry sheet writes. */
  parts: SplitPart[];
  /** A line for the entry's note saying who owes what, when that was asked for. */
  noteLine?: string | null;
  /** The new total when a tip was added: what the entry is for now, tip included. */
  total?: number;
  /** "Later": nothing is split; the entry is saved marked to be split later (the To split queue). */
  later?: boolean;
}

/**
 * What each friend owes: the pool — the total less your own parts, the typed shares and everybody's
 * items — divided equally between you and the friends on an equal share (you first, so the odd
 * cent is yours: `divideShares`), plus each one's items. `null` when the claims come to more than
 * the total.
 */
export function friendAmounts(total: number, ownParts: number, friends: Friend[]): number[] | null {
  const auto = friends.filter((f) => f.fixed === null);
  const items = (f: Friend) => f.items.reduce((a, it) => a + it.amount_minor, 0);
  const pool = total - ownParts - friends.reduce((a, f) => a + (f.fixed ?? items(f)), 0);
  if (pool < 0) return null;
  const shares = divideShares(pool, [1, ...auto.map(() => 1)]).slice(1);
  let n = 0;
  return friends.map((f) => (f.fixed !== null ? f.fixed : shares[n++]! + items(f)));
}

/**
 * Splitting one entry into several, for the shop that sold you dinner and a lamp.
 *
 * The entry itself is the first row and is not editable here except for its category and tags: its
 * amount is whatever the other rows leave, so the total on the keypad stays the receipt total and
 * every part carved off makes the first row smaller (`splitAmounts`). Nothing is written from this
 * screen — it hands the parts back to the entry sheet, which saves the entry and creates them all
 * there and then, each with the same date, note, place, photo and account, and opens the list on
 * them. Cancelling leaves the entry as it was.
 *
 * Friends join the same card ("Split with friends"): each owes an equal share of what nobody
 * claimed, plus what was only theirs ("What they had"), or exactly what was typed for them. Their
 * rows are written as their shares (core/people.ts, DATA.md rule 23) — not your spending.
 *
 * With a receipt photographed, it fills the top of the screen, zoomable, and the calculator opens
 * without dimming it (`pick/split-amount`), so a line can be read and typed side by side. While a
 * picker is open over this screen its rows take no taps — the answer coming back is for the row
 * that opened it.
 *
 * One card, one row per part, the amounts in a column of their own down the right so they can be
 * read against each other. A part's row opens its calculator, which carries Category and Tags too;
 * the entry's own row has no amount to type, so it opens the two pickers directly.
 */
export default function SplitEditor() {
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ key: string; currency: string; total: string; kind: string; main: string; parts: string; photo?: string; tips?: string }>();
  const focused = useIsFocused();
  const { height } = useWindowDimensions();
  const [receipt, setReceipt] = useState(!!p.photo);
  const currency = p.currency ?? "EUR";
  // A tip goes on top of what was typed on the entry and is shared like everything else: the equal
  // shares grow with it, a typed share stays what was typed, and the entry's amount becomes the sum.
  const [tip, setTip] = useState(0);
  const total = Math.abs(Number(p.total) || 0) + tip;
  const kindIsIncome = p.kind === "income";

  const [main, setMain] = useState<{ category_id: string | null; tag_ids: string[] }>(() => {
    try { return JSON.parse(p.main) as { category_id: string | null; tag_ids: string[] }; } catch { return { category_id: null, tag_ids: [] }; }
  });
  const [rows, setRows] = useState<Row[]>(() => {
    try { return (JSON.parse(p.parts) as SplitPart[]).filter((x) => !x.person_id).map((x) => ({ ...x, key: newPickKey("part") })); } catch { return []; }
  });
  const [friends, setFriends] = useState<Friend[]>(() => {
    try {
      return (JSON.parse(p.parts) as SplitPart[]).filter((x) => x.person_id)
        .map((x) => ({ key: newPickKey("friend"), person_id: x.person_id!, items: x.items ?? [], fixed: x.amount_minor }));
    } catch { return []; }
  });
  const [toNote, setToNote] = useState(true);

  // Closing with parts added or changed asks first (lib/discard.ts); keeping the split does not.
  const exit = useDiscardGuard(useDirty([tip, main, rows.map(({ key: _k, ...part }) => part), friends.map(({ key: _k, ...f }) => f)]));

  // One handler per field rather than per row: rows come and go, and a hook cannot.
  const keys = useMemo(() => ({ cat: newPickKey("scat"), tags: newPickKey("stags"), amt: newPickKey("samt"), people: newPickKey("speople"), famt: newPickKey("sfamt"), items: newPickKey("sitems"), tip: newPickKey("stip") }), []);
  usePickResult<number>(keys.tip, useCallback((v: number) => setTip(Math.abs(v)), []));
  const editingFriend = useRef<string | null>(null);
  const patchFriend = useCallback((change: (f: Friend) => Friend) => {
    const key = editingFriend.current;
    setFriends((list) => list.map((f) => (f.key === key ? change(f) : f)));
  }, []);
  usePickResult<number>(keys.famt, useCallback((v: number) => patchFriend((f) => ({ ...f, fixed: Math.abs(v) })), [patchFriend]));
  usePickResult<ShareItem[]>(keys.items, useCallback((v: ShareItem[]) => patchFriend((f) => ({ ...f, items: v })), [patchFriend]));
  // Picking again keeps who was already in (with their items and typed amounts) and adds the rest.
  const setPeople = useCallback((ids: string[]) => setFriends((list) => [
    ...list.filter((f) => ids.includes(f.person_id)),
    ...ids.filter((id) => !list.some((f) => f.person_id === id)).map((id) => ({ key: newPickKey("friend"), person_id: id, items: [], fixed: null })),
  ]), []);
  usePickResult<string[]>(keys.people, setPeople);
  const editing = useRef<string | null>(null);   // the row being edited, or null for the entry itself
  const patch = useCallback((change: (r: SplitPart) => SplitPart) => {
    const key = editing.current;
    if (key === null) {
      setMain((m) => { const next = change({ ...m, amount_minor: 0 }); return { category_id: next.category_id, tag_ids: next.tag_ids }; });
      return;
    }
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...change(r) } : r)));
  }, []);
  const openCat = (key: string | null, selected: string | null) => {
    editing.current = key;
    router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: kindIsIncome ? "income" : "expense", selected: selected ?? "" } });
  };
  const openTags = (key: string | null, selected: string[], category: string | null) => {
    editing.current = key;
    router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: selected.join(","), category: category ?? "" } });
  };
  usePickResult<string | null>(keys.cat, useCallback((v) => patch((r) => ({ ...r, category_id: v })), [patch]));
  usePickResult<string[]>(keys.tags, useCallback((v) => patch((r) => ({ ...r, tag_ids: v })), [patch]));
  // The keypad a part opens carries the Category and Tags keys itself, so one screen answers how
  // much and what of; the rows on the card stay tappable for changing either afterwards.
  usePickResult<AmountPick>(keys.amt, useCallback((v: AmountPick) =>
    patch((r) => ({ ...r, amount_minor: Math.abs(v.minor), category_id: v.category_id, tag_ids: v.tag_ids })), [patch]));

  const catNames = useQuery((d) => new Map(listRows(d, "categories", "deleted=0").map((c) => [c.id, c])), []);
  const tagRows = useQuery((d) => new Map(listRows(d, "tags", "deleted=0").map((x) => [x.id, x])), []);
  const people = useQuery((d) => new Map(listPeople(d, { archived: true }).map((x) => [x.id, x])), []);
  // A trip or an event with people on it: the friends are probably the same ones.
  const eventPeople = useQuery((d) => budgetPeople(activeTrip(d)?.people).filter((id) => people.has(id)), [people]);

  const owed = friendAmounts(total, rows.reduce((a, r) => a + r.amount_minor, 0), friends);
  const friendParts: SplitPart[] = owed ? friends.map((f, i) => ({ amount_minor: owed[i]!, category_id: null, tag_ids: [], person_id: f.person_id, items: f.items })) : [];
  const allParts = [...rows.map(({ key: _k, ...part }) => part), ...friendParts];
  const amounts = owed ? splitAmounts(total, allParts.map((r) => r.amount_minor)) : null;
  const rest = amounts?.[0] ?? total - allParts.reduce((a, r) => a + r.amount_minor, 0);
  const uncategorised = !main.category_id || rows.some((r) => !r.category_id);
  const ready = !!amounts && !uncategorised;
  const hint = !allParts.length ? t("transaction.split.hint.addPart")
    : !amounts ? (rows.some((r) => !r.amount_minor) || friendParts.some((f) => !f.amount_minor) ? t("transaction.split.hint.needAmount") : t("transaction.split.hint.tooMuch"))
      : t("transaction.split.hint.needCategory");
  const personName = (id: string) => people.get(id)?.name ?? "?";
  const noteLine = friends.length && owed
    ? t("people.split.noteLine", { list: friends.map((f, i) => `${personName(f.person_id)} ${formatMinor(owed[i]!, currency)} ${currency}`).join(", ") })
    : null;
  // The entry sheet saves and leaves from here, taking this screen with it.
  const done = () => exit(() => resolvePick(p.key, { main, parts: allParts, noteLine: toNote ? noteLine : null, ...(tip ? { total } : {}) } satisfies SplitResult));
  const openTip = () => router.push({ pathname: "/pick/split-amount", params: { key: keys.tip, title: t("transaction.split.tip"), currency, value: String(tip) } });
  const openPeople = () => router.push({ pathname: "/pick/people", params: { key: keys.people, selected: friends.map((f) => f.person_id).join(",") } });
  // Typing one friend's amount takes them out of the equal share and leaves everyone else on it: the
  // rest is divided again between you and the others (friendAmounts), so nobody else needs editing.
  // The keypad is told what there is to divide and between how many, and says what the others come
  // to while the number is typed.
  const openFriendAmount = (f: Friend, amount: number) => {
    editingFriend.current = f.key;
    const others = friends.filter((x) => x.key !== f.key);
    const pool = total - rows.reduce((a, r) => a + r.amount_minor, 0) - others.reduce((a, x) => a + (x.fixed ?? x.items.reduce((b, it) => b + it.amount_minor, 0)), 0);
    // The most it can be is the whole pool less a minor unit for each share still divided equally
    // (yours included): those shrink to make room, but none of them may reach zero.
    const ways = 1 + others.filter((x) => x.fixed === null).length;
    router.push({ pathname: "/pick/split-amount", params: {
      key: keys.famt, title: t("people.split.howMuch", { name: personName(f.person_id) }), currency, value: String(amount),
      available: String(Math.max(pool, 0)), max: String(Math.max(pool - ways, 0)),
      pool: String(pool), ways: String(ways),
    } });
  };
  const openItems = (f: Friend) => {
    editingFriend.current = f.key;
    router.push({ pathname: "/pick/items", params: { key: keys.items, name: personName(f.person_id), currency, items: JSON.stringify(f.items) } });
  };

  // A part can only ever be worth what the entry still has: the rest of it, plus whatever this part
  // is already holding, since editing it hands that back first. The ceiling is a minor unit under
  // that, because the entry has to keep something to still be an entry — but what is printed is the
  // round figure it is a unit under, not the ceiling itself.
  const openAmount = (row: Row) => {
    editing.current = row.key;
    const available = Math.max(rest + row.amount_minor, 0);
    router.push({ pathname: "/pick/split-amount", params: {
      key: keys.amt, title: t("transaction.split.howMuch"), currency, value: String(row.amount_minor),
      available: String(available), max: String(Math.max(available - 1, 0)),
      kind: kindIsIncome ? "income" : "expense", category: row.category_id ?? "", tags: row.tag_ids.join(","),
    } });
  };
  // A new part opens on its amount: that is the question being asked, and a row sitting at zero is
  // the one thing that stops the split being saved.
  const add = () => {
    const row: Row = { key: newPickKey("part"), amount_minor: 0, category_id: null, tag_ids: [] };
    setRows((list) => [...list, row]);
    openAmount(row);
  };

  const tagLine = (tagIds: string[]) => tagIds.length
    ? <View style={styles.tags}>{tagIds.map((x) => { const tag = tagRows.get(x); return tag ? <TagPill key={x} name={tag.name} color={tag.color} /> : null; })}</View>
    : null;
  const catIcon = (categoryId: string | null) => {
    const cat = categoryId ? catNames.get(categoryId) : null;
    const icon = cat ? iconFor(cat.name, { icon: cat.icon, color: cat.color }) : null;
    return { cat, view: (
      <View style={[styles.catIcon, { backgroundColor: icon?.color ?? (C.fill as unknown as string) }]}>
        <SymbolView name={(icon?.icon as SFSymbol) ?? "folder.badge.plus"} size={15} tintColor={icon ? "white" : C.secondary} />
      </View>
    ) };
  };
  const money = (minor: number, missing: boolean, red?: boolean) => (
    <ButtonText fit={1} style={[styles.amount, missing && styles.missing, red && { color: C.red }]}>
      {formatMinor(minor, currency)} <Text style={styles.cur}>{currency}</Text>
    </ButtonText>
  );
  const mainIcon = catIcon(main.category_id);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("transaction.split.title")} left={{ label: t("common.cancel"), onPress: () => router.back() }}
        right={{ label: t("people.toSplit.later"), onPress: () => exit(() => resolvePick(p.key, { main, parts: [], later: true } satisfies SplitResult)) }} />
      {p.photo && receipt ? (
        <ScrollView style={[styles.receipt, { height: Math.round(height * 0.38) }]} contentContainerStyle={{ flexGrow: 1 }}
          maximumZoomScale={5} minimumZoomScale={1} bouncesZoom centerContent showsVerticalScrollIndicator={false}
          accessible accessibilityLabel={t("people.split.receiptA11y")}>
          <Image source={{ uri: p.photo }} style={{ width: "100%", height: Math.round(height * 0.38) }} contentFit="contain" accessibilityIgnoresInvertColors />
        </ScrollView>
      ) : null}
      {p.photo ? (
        <Tap onPress={() => setReceipt((v) => !v)} style={styles.receiptToggle} accessibilityRole="button">
          <SymbolView name={receipt ? "chevron.up" : "doc.text.image"} size={13} tintColor={C.tint} />
          <Text style={styles.receiptToggleText}>{receipt ? t("people.split.hideReceipt") : t("people.split.showReceipt")}</Text>
        </Tap>
      ) : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" pointerEvents={focused ? "auto" : "none"}>
        {/* What is being divided: the receipt's total, which every row below adds up to. */}
        <View>
          <View style={styles.total} accessible accessibilityLabel={`${t("transaction.split.total")}: ${formatMinor(total, currency)} ${currency}`}>
            <Text style={styles.headerText}>{t("transaction.split.total")}</Text>
            <Text style={styles.totalAmount}>{formatMinor(total, currency)} <Text style={styles.cur}>{currency}</Text></Text>
          </View>
          {p.tips ? (
            <Tap onPress={openTip} hitSlop={8} style={styles.tip} accessibilityRole="button">
              <SymbolView name={tip ? "pencil" : "plus.circle"} size={13} tintColor={C.tint} />
              <Text style={styles.tipText}>{tip ? t("transaction.split.withTip", { amount: formatMinor(tip, currency), currency }) : t("transaction.split.addTip")}</Text>
            </Tap>
          ) : null}
        </View>

        {/* The explanation is for the empty screen; once there is something on it, the rows say it. */}
        {!rows.length && !friends.length ? <Text style={styles.intro}>{t("transaction.split.intro")}</Text> : null}

        <View>
          {friends.length ? <View style={styles.header} accessibilityRole="header"><Text style={styles.headerText}>{t("people.split.you")}</Text></View> : null}
          <View style={styles.card}>
            <View style={styles.row}>
              {mainIcon.view}
              <View style={styles.middle}>
                <Tap onPress={() => openCat(null, main.category_id)} hitSlop={4} accessibilityRole="button"
                  accessibilityLabel={mainIcon.cat ? t("transaction.split.restCategoryA11y", { name: catName(mainIcon.cat) }) : t("transaction.split.chooseRestCategory")}>
                  <Text style={[styles.catText, !mainIcon.cat && styles.missing]}>{mainIcon.cat ? catName(mainIcon.cat) : t("transaction.split.chooseCategory")}</Text>
                </Tap>
                <Tap onPress={() => openTags(null, main.tag_ids, main.category_id)} hitSlop={4} accessibilityRole="button"
                  accessibilityLabel={main.tag_ids.length ? t("transaction.split.restTagsA11y", { names: main.tag_ids.map((x) => tagRows.get(x)?.name ?? "").filter(Boolean).join(", ") }) : t("transaction.split.addRestTags")}>
                  {tagLine(main.tag_ids) ?? <Text style={styles.tagHint}>{t("transaction.split.addTags")}</Text>}
                </Tap>
              </View>
              <View style={styles.right}>
                {money(rest, false, rest <= 0)}
                {rows.length && !friends.length ? <Text style={styles.caption}>{t("transaction.split.rest")}</Text> : null}
              </View>
              <View style={styles.remove} />
            </View>

            {rows.map((r, i) => {
              const icon = catIcon(r.category_id);
              return (
                <Pressable key={r.key} onPress={() => openAmount(r)} style={({ pressed }) => [styles.row, styles.divider, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button" accessibilityLabel={t("transaction.split.partA11y", { n: i + 2, amount: formatMinor(r.amount_minor, currency), currency, category: icon.cat ? catName(icon.cat) : t("transaction.split.noCategory") })}>
                  {icon.view}
                  <View style={styles.middle}>
                    <Text style={[styles.catText, !icon.cat && styles.missing]}>{icon.cat ? catName(icon.cat) : t("transaction.split.chooseCategory")}</Text>
                    {tagLine(r.tag_ids)}
                  </View>
                  <View style={styles.right}>{money(r.amount_minor, !r.amount_minor)}</View>
                  <Tap onPress={() => setRows((list) => list.filter((x) => x.key !== r.key))} hitSlop={10}
                    accessibilityRole="button" accessibilityLabel={t("transaction.split.removePart", { n: i + 2 })} style={styles.remove}>
                    <SymbolView name="minus.circle.fill" size={20} tintColor={C.tertiary} />
                  </Tap>
                </Pressable>
              );
            })}

            {/* Split with friends, the bill is the friends' and yours: no parts of your own on top. */}
            {friends.length ? null : (
              <Pressable onPress={add} style={({ pressed }) => [styles.add, styles.divider, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t("transaction.split.addPart")}>
                <SymbolView name="plus.circle.fill" size={20} tintColor={C.tint} />
                <Text style={styles.addText}>{t("transaction.split.addPart")}</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* Two ways to split, and the first step picks one: parts of your own spending, or the bill
            shared with friends. Once a part of your own is added the split is about your spending,
            so the friends button goes, and once a friend is in, Add a part goes; it is its own
            button so the two are not read as one list. */}
        {!friends.length && !rows.length ? (
          <Pressable onPress={openPeople} style={({ pressed }) => [styles.friendsButton, pressed && { opacity: 0.6 }]} accessibilityRole="button">
            <SymbolView name="person.2.fill" size={18} tintColor={C.tint} />
            <Text style={styles.addText}>{t("people.split.withFriends")}</Text>
          </Pressable>
        ) : null}
        {!friends.length && !rows.length && eventPeople.length ? (
          <Tap onPress={() => setPeople(eventPeople)} style={styles.suggest} accessibilityRole="button">
            <SymbolView name="person.2.fill" size={15} tintColor={C.tint} />
            <Text style={styles.suggestText} numberOfLines={2}>{t("people.split.withEvent", { names: eventPeople.map(personName).join(", ") })}</Text>
          </Tap>
        ) : null}

        {/* Friends: a name and what they owe. What they had sits under the name only once there is
            some; the list button adds it. Adding or removing friends is the picker's job (Edit). */}
        {friends.length ? (
          <View>
            <View style={styles.header}>
              <Text style={styles.headerText} accessibilityRole="header">{t("people.split.owes")}</Text>
              <Tap onPress={openPeople} hitSlop={10} accessibilityRole="button"><Text style={styles.headerLink}>{t("people.split.edit")}</Text></Tap>
            </View>
            <View style={styles.card}>
              {friends.map((f, i) => {
                const person = people.get(f.person_id);
                const amount = owed?.[i] ?? 0;
                const name = personName(f.person_id);
                const remove = () => setFriends((list) => list.filter((x) => x.key !== f.key));
                return (
                  <Pressable key={f.key} onPress={() => openFriendAmount(f, amount)} style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button" accessibilityLabel={t("people.split.friendA11y", { name, amount: formatMinor(amount, currency), currency })}
                    accessibilityActions={[{ name: "items", label: t("people.split.addItems") }, { name: "remove", label: t("people.split.removeFriend", { name }) }]}
                    onAccessibilityAction={(e) => (e.nativeEvent.actionName === "remove" ? remove() : openItems(f))}>
                    {person ? <PersonAvatar person={person} /> : <View style={styles.catIcon} />}
                    <View style={styles.middle}>
                      <Text style={styles.catText} numberOfLines={1}>{name}</Text>
                      {f.items.length ? <Text style={styles.itemsText} numberOfLines={2}>{f.items.map((it) => it.name).join(", ")}</Text> : null}
                    </View>
                    <View style={styles.right}>
                      {money(amount, !amount)}
                      {f.fixed !== null ? (
                        <Tap onPress={() => setFriends((list) => list.map((x) => (x.key === f.key ? { ...x, fixed: null } : x)))} hitSlop={8}
                          accessibilityRole="button" accessibilityLabel={t("people.split.equalA11y")} style={styles.equal}>
                          <Text style={styles.caption}>{t("people.split.fixed")}</Text>
                          <SymbolView name="equal.circle" size={13} tintColor={C.tint} />
                        </Tap>
                      ) : null}
                    </View>
                    <Tap onPress={() => openItems(f)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("people.split.addItems")} style={styles.remove}>
                      <SymbolView name="list.bullet" size={17} tintColor={f.items.length ? C.tint : C.tertiary} />
                    </Tap>
                  </Pressable>
                );
              })}
              {noteLine ? <ToggleRow title={t("people.split.addToNote")} value={toNote} onChange={setToNote} style={[styles.divider, styles.toggle]} /> : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <View style={{ paddingBottom: Math.max(insets.bottom, S.md), paddingTop: S.sm, backgroundColor: C.bgGrouped }}>
        <ConfirmBar
          amount={amounts ? t("transaction.split.entries", { count: amounts.length }) : t("transaction.split.notYet")}
          label={ready ? t("transaction.split.save") : hint}
          disabled={!ready} onPress={done} />
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { padding: S.md, gap: S.md },
  intro: { fontSize: 14, lineHeight: 19, color: C.secondary, paddingHorizontal: S.xs },
  card: { backgroundColor: C.card, borderRadius: 16, paddingHorizontal: S.md },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 60, paddingVertical: S.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  catIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  middle: { flex: 1, gap: 4 },
  catText: { fontSize: 16, color: C.label },
  missing: { color: C.tertiary },
  tags: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  tagHint: { fontSize: 13, color: C.tint },
  // The amounts are one column: right-aligned, same width of figure, whatever sits beside them.
  right: { alignItems: "flex-end", flexShrink: 0 },
  amount: { fontSize: 17, fontWeight: "600", color: C.label, fontVariant: ["tabular-nums"], textAlign: "right" },
  cur: { fontSize: 13, fontWeight: "500", color: C.secondary },
  caption: { fontSize: 12, color: C.secondary },
  remove: { width: 22, alignItems: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 50, paddingLeft: 5 },
  addText: { fontSize: 16, fontWeight: "600", color: C.tint },
  receipt: { flexGrow: 0, backgroundColor: C.card },
  receiptToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 36 },
  receiptToggleText: { fontSize: 13, fontWeight: "600", color: C.tint },
  itemsText: { fontSize: 13, color: C.secondary },
  equal: { flexDirection: "row", alignItems: "center", gap: 3 },
  suggest: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.sm, minHeight: 44, paddingHorizontal: S.md, borderRadius: 22, backgroundColor: C.card, alignSelf: "center" },
  suggestText: { fontSize: 15, fontWeight: "600", color: C.tint, flexShrink: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", paddingHorizontal: S.xs, paddingBottom: 6 },
  headerText: { fontSize: 13, color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4 },
  friendsButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.sm, minHeight: 50, borderRadius: 16, backgroundColor: C.card },
  headerLink: { fontSize: 15, color: C.tint },
  total: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: S.xs, paddingLeft: S.xs, paddingRight: S.md + 22 + S.md },
  tip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-end", marginRight: S.md + 22 + S.md, minHeight: 28 },
  tipText: { fontSize: 14, color: C.tint },
  totalAmount: { fontSize: 22, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  toggle: { paddingHorizontal: 0, backgroundColor: "transparent", minHeight: 52 },
}));
