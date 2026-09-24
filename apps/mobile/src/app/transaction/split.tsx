import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatMinor, iconFor, listRows, splitAmounts, type SplitPart } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { ConfirmBar } from "@/components/Keypad";
import type { AmountPick } from "@/app/pick/amount";
import { ModalHeader, TagPill } from "@/components/ui";
import { C, S } from "@/constants/theme";

/** A part as the editor holds it: the payload plus a key React and the pickers can address it by. */
type Row = SplitPart & { key: string };

export interface SplitResult {
  main: { category_id: string | null; tag_ids: string[] };
  parts: SplitPart[];
}

/**
 * Splitting one entry into several, for the shop that sold you dinner and a lamp.
 *
 * The entry itself is the first row and is not editable here except for its category and tags: its
 * amount is whatever the other rows leave, so the total on the keypad stays the receipt total and
 * every part carved off makes the first row smaller (`splitAmounts`). Nothing is written from this
 * screen — it hands the parts back to the entry sheet, which creates them all when the entry is
 * saved, each with the same date, note, place, photo and account. Cancelling leaves the entry as
 * it was.
 *
 * One card, one row per part, the amounts in a column of their own down the right so they can be
 * read against each other. A part's row opens its calculator, which carries Category and Tags too;
 * the entry's own row has no amount to type, so it opens the two pickers directly.
 */
export default function SplitEditor() {
  const insets = useSafeAreaInsets();
  const p = useLocalSearchParams<{ key: string; currency: string; total: string; kind: string; main: string; parts: string }>();
  const currency = p.currency ?? "EUR";
  const total = Math.abs(Number(p.total) || 0);
  const kindIsIncome = p.kind === "income";

  const [main, setMain] = useState<{ category_id: string | null; tag_ids: string[] }>(() => {
    try { return JSON.parse(p.main) as { category_id: string | null; tag_ids: string[] }; } catch { return { category_id: null, tag_ids: [] }; }
  });
  const [rows, setRows] = useState<Row[]>(() => {
    try { return (JSON.parse(p.parts) as SplitPart[]).map((x) => ({ ...x, key: newPickKey("part") })); } catch { return []; }
  });

  // One handler per field rather than per row: rows come and go, and a hook cannot.
  const keys = useMemo(() => ({ cat: newPickKey("scat"), tags: newPickKey("stags"), amt: newPickKey("samt") }), []);
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

  const amounts = splitAmounts(total, rows.map((r) => r.amount_minor));
  const rest = amounts?.[0] ?? total - rows.reduce((a, r) => a + r.amount_minor, 0);
  const uncategorised = !main.category_id || rows.some((r) => !r.category_id);
  const ready = !!amounts && !uncategorised;
  const hint = !rows.length ? "Add a part to split this entry"
    : !amounts ? (rows.some((r) => !r.amount_minor) ? "Every part needs an amount" : "The parts come to more than the entry")
      : "Every part needs a category";
  const done = () => { resolvePick(p.key, { main, parts: rows.map(({ key: _k, ...part }) => part) } satisfies SplitResult); router.back(); };

  // A part can only ever be worth what the entry still has: the rest of it, plus whatever this part
  // is already holding, since editing it hands that back first. The ceiling is a minor unit under
  // that, because the entry has to keep something to still be an entry — but what is printed is the
  // round figure it is a unit under, not the ceiling itself.
  const openAmount = (row: Row) => {
    editing.current = row.key;
    const available = Math.max(rest + row.amount_minor, 0);
    router.push({ pathname: "/pick/amount", params: {
      key: keys.amt, title: "How much of it?", currency, value: String(row.amount_minor),
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
    <Text style={[styles.amount, missing && styles.missing, red && { color: C.red }]} numberOfLines={1}>
      {formatMinor(minor, currency)} <Text style={styles.cur}>{currency}</Text>
    </Text>
  );
  const mainIcon = catIcon(main.category_id);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title="Split the entry" left={{ label: "Cancel", onPress: () => router.back() }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          One shop, several things. Give each part its own category — what is left stays on the entry itself.
        </Text>

        <View style={styles.card}>
          <View style={styles.row}>
            {mainIcon.view}
            <View style={styles.middle}>
              <Pressable onPress={() => openCat(null, main.category_id)} hitSlop={4} accessibilityRole="button"
                accessibilityLabel={mainIcon.cat ? `Category of the rest: ${mainIcon.cat.name}` : "Choose a category for the rest"}>
                <Text style={[styles.catText, !mainIcon.cat && styles.missing]} numberOfLines={1}>{mainIcon.cat?.name ?? "Choose a category"}</Text>
              </Pressable>
              <Pressable onPress={() => openTags(null, main.tag_ids, main.category_id)} hitSlop={4} accessibilityRole="button"
                accessibilityLabel={main.tag_ids.length ? `Tags of the rest: ${main.tag_ids.map((x) => tagRows.get(x)?.name ?? "").filter(Boolean).join(", ")}` : "Add tags to the rest"}>
                {tagLine(main.tag_ids) ?? <Text style={styles.tagHint}>Add tags</Text>}
              </Pressable>
            </View>
            <View style={styles.right}>
              {money(rest, false, rest <= 0)}
              <Text style={styles.caption}>the rest</Text>
            </View>
            <View style={styles.remove} />
          </View>

          {rows.map((r, i) => {
            const icon = catIcon(r.category_id);
            return (
              <Pressable key={r.key} onPress={() => openAmount(r)} style={({ pressed }) => [styles.row, styles.divider, pressed && { opacity: 0.6 }]}
                accessibilityRole="button" accessibilityLabel={`Part ${i + 2}: ${formatMinor(r.amount_minor, currency)} ${currency}, ${icon.cat?.name ?? "no category"}. Tap to edit.`}>
                {icon.view}
                <View style={styles.middle}>
                  <Text style={[styles.catText, !icon.cat && styles.missing]} numberOfLines={1}>{icon.cat?.name ?? "Choose a category"}</Text>
                  {tagLine(r.tag_ids)}
                </View>
                <View style={styles.right}>{money(r.amount_minor, !r.amount_minor)}</View>
                <Pressable onPress={() => setRows((list) => list.filter((x) => x.key !== r.key))} hitSlop={10}
                  accessibilityRole="button" accessibilityLabel={`Remove part ${i + 2}`} style={styles.remove}>
                  <SymbolView name="minus.circle.fill" size={20} tintColor={C.tertiary} />
                </Pressable>
              </Pressable>
            );
          })}

          <Pressable onPress={add} style={({ pressed }) => [styles.add, styles.divider, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel="Add a part">
            <SymbolView name="plus.circle.fill" size={20} tintColor={C.tint} />
            <Text style={styles.addText}>Add a part</Text>
          </Pressable>
        </View>

        <Text style={styles.foot}>
          {ready ? `${rows.length + 1} entries will be added, all with the same date, note, place and photo.` : hint}
        </Text>
      </ScrollView>
      <View style={{ paddingBottom: Math.max(insets.bottom, S.md), paddingTop: S.sm, backgroundColor: C.bgGrouped }}>
        <ConfirmBar
          amount={amounts ? `${amounts.length} entries` : "Not a split yet"}
          label={ready ? "Tap to keep the split" : hint}
          disabled={!ready} onPress={done} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  foot: { fontSize: 13, lineHeight: 18, color: C.secondary, textAlign: "center", paddingHorizontal: S.md },
});
