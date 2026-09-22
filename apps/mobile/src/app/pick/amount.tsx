import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { type SFSymbol } from "expo-symbols";
import { formatMinor, getRow, iconFor, listRows, toMinor } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { C, S } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** What comes back when the screen was opened with `kind`, i.e. with the Category and Tags keys on. */
export interface AmountPick { minor: number; category_id: string | null; tag_ids: string[] }

/**
 * Amount entry with the app keypad. Resolves minor units (a number).
 *
 * `max` (minor units) is the largest answer this will hand back — a part of a split cannot be worth
 * more than the entry has left to give it. Going over is shown and refused here rather than silently
 * clamped, so the number the caller gets back is always the number that was typed.
 *
 * `available` is what that limit is *about*, and is only shown: a split leaves the entry itself a
 * minor unit, so the ceiling is a kopiyka under the amount on the entry and printing the ceiling
 * would put an odd 99.99 under a round 100.00. The round number is the one that means something.
 *
 * With `kind` the keypad grows the two keys the Log sheet has — Category and Tags, in the same
 * corner — and the answer becomes an `AmountPick` instead of a number. A part of a split is a whole
 * small entry, and asking "how much" and "what of" on one screen is one screen instead of three.
 */
export default function PickAmount() {
  const p = useLocalSearchParams<{ key: string; title?: string; currency?: string; value?: string; max?: string; available?: string; kind?: string; category?: string; tags?: string }>();
  const cur = p.currency ?? "EUR";
  const [expr, setExpr] = useState(p.value && Number(p.value) ? String(Number(p.value) / 100) : "");
  const [categoryId, setCategoryId] = useState<string | null>(p.category || null);
  const [tagIds, setTagIds] = useState<string[]>(p.tags ? p.tags.split(",").filter(Boolean) : []);
  const insets = useSafeAreaInsets();

  const keys = useMemo(() => ({ cat: newPickKey("amtcat"), tags: newPickKey("amttags") }), []);
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => setCategoryId(v), []));
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  const category = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) : null), [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((tag) => tagIds.includes(tag.id)), [tagIds.join(",")]);
  const catIcon = category ? iconFor(category.name, { icon: category.icon, color: category.color }) : null;

  const v = evalExpr(expr);
  const abs = v !== null ? Math.abs(v) : null;
  const ceiling = p.max ? Math.abs(Number(p.max)) : null;
  const shown = p.available ? Math.abs(Number(p.available)) : ceiling;
  const minor = abs !== null ? toMinor(abs, cur) : null;
  const tooMuch = ceiling !== null && minor !== null && minor > ceiling;
  const use = () => {
    resolvePick(p.key, p.kind ? ({ minor: minor!, category_id: categoryId, tag_ids: tagIds } satisfies AmountPick) : minor!);
    router.back();
  };

  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.xl, paddingBottom: Math.max(insets.bottom, S.md), gap: S.md }}>
      <Text style={styles.title}>{p.title ?? "Amount"}</Text>
      <Text style={[styles.amount, tooMuch && { color: C.red }]}>{abs !== null ? formatMinor(toMinor(abs, cur), cur) : expr || "0"} <Text style={styles.cur}>{cur}</Text></Text>
      {shown !== null ? <Text style={[styles.limit, tooMuch && { color: C.red }]}>{tooMuch ? "That is more than there is to give" : `${formatMinor(shown, cur)} ${cur} available`}</Text> : null}
      <Keypad value={expr} onChange={setExpr} allowSign={false}
        extra={p.kind ? { label: category ? category.name : "Category", a11y: `Category: ${category ? category.name : "none"}`, icon: catIcon ? (catIcon.icon as SFSymbol) : "folder.badge.plus", color: catIcon?.color, active: !!category, onPress: () => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: p.kind === "income" ? "income" : "expense", selected: categoryId ?? "" } }) } : undefined}
        extra2={p.kind ? { a11y: tags.length ? `Tags: ${tags.map((tag) => tag.name).join(", ")}` : "Tags", icon: "number", badge: tags.length || undefined, active: tags.length > 0, onPress: () => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } }) } : undefined} />
      <ConfirmBar amount={`${abs !== null ? formatMinor(toMinor(abs, cur), cur) : "0"} ${cur}`} label="Use this amount"
        disabled={abs === null || abs === 0 || tooMuch} onPress={use} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: { textAlign: "center", fontSize: 15, color: C.secondary },
  amount: { textAlign: "center", fontSize: 40, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  cur: { fontSize: 18, color: C.secondary },
  limit: { textAlign: "center", fontSize: 13, color: C.secondary, marginTop: -S.sm },
});
