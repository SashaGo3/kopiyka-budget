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
import { useT } from "@/i18n";

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
 */
export default function SplitEditor() {
  const t = useT();
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
  const hint = !rows.length ? t("Add a part to split this entry")
    : !amounts ? (rows.some((r) => !r.amount_minor) ? t("Every part needs an amount") : t("The parts come to more than the entry"))
      : t("Every part needs a category");
  const done = () => { resolvePick(p.key, { main, parts: rows.map(({ key: _k, ...part }) => part) } satisfies SplitResult); router.back(); };

  // A part can only ever be worth what the entry still has: the rest of it, plus whatever this part
  // is already holding, since editing it hands that back first. The ceiling is a minor unit under
  // that, because the entry has to keep something to still be an entry — but what is printed is the
  // round figure it is a unit under, not the ceiling itself.
  const openAmount = (row: Row) => {
    editing.current = row.key;
    const available = Math.max(rest + row.amount_minor, 0);
    router.push({ pathname: "/pick/amount", params: {
      key: keys.amt, title: t("How much of it?"), currency, value: String(row.amount_minor),
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

  const line = (categoryId: string | null, tagIds: string[], key: string | null) => {
    const cat = categoryId ? catNames.get(categoryId) : null;
    const icon = cat ? iconFor(cat.name, { icon: cat.icon, color: cat.color }) : null;
    return (
      <>
        <Pressable onPress={() => openCat(key, categoryId)} style={styles.catRow} accessibilityRole="button"
          accessibilityLabel={cat ? t("Category: {name}", { name: cat.name }) : t("Choose a category")}>
          <View style={[styles.catIcon, { backgroundColor: icon?.color ?? (C.fill as unknown as string) }]}>
            <SymbolView name={(icon?.icon as SFSymbol) ?? "folder.badge.plus"} size={14} tintColor={icon ? "white" : C.secondary} />
          </View>
          <Text style={[styles.catText, !cat && styles.missing]} numberOfLines={1}>{cat?.name ?? t("Choose a category")}</Text>
          <SymbolView name="chevron.right" size={11} tintColor={C.tertiary} />
        </Pressable>
        <Pressable onPress={() => openTags(key, tagIds, categoryId)} style={styles.tagRow} accessibilityRole="button"
          accessibilityLabel={tagIds.length ? t("Tags: {names}", { names: tagIds.map((x) => tagRows.get(x)?.name ?? "").filter(Boolean).join(", ") }) : t("Tags")}>
          <SymbolView name="number" size={12} tintColor={C.tertiary} />
          {tagIds.length
            ? tagIds.map((x) => { const tag = tagRows.get(x); return tag ? <TagPill key={x} name={tag.name} color={tag.color} /> : null; })
            : <Text style={styles.tagHint}>{t("Add tags")}</Text>}
        </Pressable>
      </>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("Split the entry")} left={{ label: t("Cancel"), onPress: () => router.back() }}
        right={{ label: t("Done"), onPress: done, disabled: !ready }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>
          {t("One shop, several things. Give each part its own category — what is left stays on the entry itself.")}
        </Text>

        <View style={styles.card}>
          <View style={styles.head}>
            <Text style={styles.headLabel}>{t("The rest of it")}</Text>
            <Text style={[styles.amount, rest <= 0 && { color: C.red }]}>{formatMinor(rest, currency)} <Text style={styles.cur}>{currency}</Text></Text>
          </View>
          {line(main.category_id, main.tag_ids, null)}
        </View>

        {rows.map((r, i) => (
          <View key={r.key} style={styles.card}>
            <View style={styles.head}>
              <Pressable onPress={() => openAmount(r)} hitSlop={6} accessibilityRole="button" accessibilityLabel={t("Amount of part {n}", { n: i + 2 })}>
                <Text style={styles.headLabel}>{t("Part {n}", { n: i + 2 })}</Text>
                <Text style={[styles.amount, !r.amount_minor && styles.missing]}>
                  {formatMinor(r.amount_minor, currency)} <Text style={styles.cur}>{currency}</Text>
                </Text>
              </Pressable>
              <Pressable onPress={() => setRows((list) => list.filter((x) => x.key !== r.key))} hitSlop={10}
                accessibilityRole="button" accessibilityLabel={t("Remove part {n}", { n: i + 2 })} style={styles.remove}>
                <SymbolView name="minus.circle.fill" size={20} tintColor={C.tertiary} />
              </Pressable>
            </View>
            {line(r.category_id, r.tag_ids, r.key)}
          </View>
        ))}

        <Pressable onPress={add} style={({ pressed }) => [styles.add, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t("Add a part")}>
          <SymbolView name="plus.circle" size={16} tintColor={C.tint} />
          <Text style={styles.addText}>{t("Add a part")}</Text>
        </Pressable>

        <Text style={styles.foot}>
          {ready ? t("{n} entries will be added, all with the same date, note, place and photo.", { n: rows.length + 1 }) : hint}
        </Text>
      </ScrollView>
      <View style={{ paddingBottom: Math.max(insets.bottom, S.md), paddingTop: S.sm, backgroundColor: C.bgGrouped }}>
        <ConfirmBar
          amount={amounts ? t("{n} entries", { n: amounts.length }) : t("Not a split yet")}
          label={ready ? t("Tap to keep the split") : hint}
          disabled={!ready} onPress={done} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: S.md, gap: S.md },
  intro: { fontSize: 14, lineHeight: 19, color: C.secondary, paddingHorizontal: S.xs },
  card: { backgroundColor: C.card, borderRadius: 16, padding: S.md, gap: S.sm },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: S.md },
  headLabel: { fontSize: 13, color: C.secondary },
  amount: { fontSize: 26, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"], marginTop: 1 },
  cur: { fontSize: 15, fontWeight: "600", color: C.secondary },
  remove: { paddingTop: 4 },
  catRow: { flexDirection: "row", alignItems: "center", gap: S.sm, minHeight: 36, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator, paddingTop: S.sm },
  catIcon: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  catText: { flex: 1, fontSize: 16, color: C.label },
  missing: { color: C.tertiary },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", minHeight: 28 },
  tagHint: { fontSize: 14, color: C.tertiary },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44 },
  addText: { fontSize: 16, fontWeight: "600", color: C.tint },
  foot: { fontSize: 13, lineHeight: 18, color: C.secondary, textAlign: "center", paddingHorizontal: S.md },
});
