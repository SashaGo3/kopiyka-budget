import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { formatMinor, getRow, iconFor, listRows, toMinor } from "@kopiyka/core";
import { useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { SheetFrame, TagPill } from "@/components/ui";
import { C, S } from "@/constants/theme";

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
 *
 * It is the Log sheet's calculator with everything that belongs to the entry rather than to the
 * number taken away: the same hero amount with the sum written out under it (`CalcLine`), so what is
 * being typed is always on screen, and the same keypad with ± greyed out — the sign is the
 * caller's, never the answer's.
 */
export default function PickAmount() {
  const p = useLocalSearchParams<{ key: string; title?: string; currency?: string; value?: string; max?: string; available?: string; kind?: string; category?: string; tags?: string }>();
  const cur = p.currency ?? "EUR";
  const [expr, setExpr] = useState(p.value && Number(p.value) ? String(Math.abs(Number(p.value)) / 100) : "");
  const [categoryId, setCategoryId] = useState<string | null>(p.category || null);
  const [tagIds, setTagIds] = useState<string[]>(p.tags ? p.tags.split(",").filter(Boolean) : []);

  const keys = useMemo(() => ({ cat: newPickKey("amtcat"), tags: newPickKey("amttags") }), []);
  usePickResult<string | null>(keys.cat, useCallback((v: string | null) => setCategoryId(v), []));
  usePickResult<string[]>(keys.tags, useCallback((v: string[]) => setTagIds(v), []));
  const category = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) : null), [categoryId]);
  const tags = useQuery((d) => listRows(d, "tags", "deleted=0").filter((tag) => tagIds.includes(tag.id)), [tagIds.join(",")]);
  const catIcon = category ? iconFor(category.name, { icon: category.icon, color: category.color }) : null;

  // `evalPartial`, as on the Log sheet: "90−" already means 90, and what the field shows is what Use takes.
  const v = evalPartial(expr);
  const abs = v !== null ? Math.abs(v) : null;
  const ceiling = p.max ? Math.abs(Number(p.max)) : null;
  const shown = p.available ? Math.abs(Number(p.available)) : ceiling;
  const minor = abs !== null ? toMinor(abs, cur) : null;
  const tooMuch = ceiling !== null && minor !== null && minor > ceiling;
  const use = () => {
    resolvePick(p.key, p.kind ? ({ minor: minor!, category_id: categoryId, tag_ids: tagIds } satisfies AmountPick) : minor!);
    router.back();
  };
  const amountText = abs !== null ? formatMinor(toMinor(abs, cur), cur) : "0";

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Text style={styles.title}>{p.title ?? "Amount"}</Text>
          <View style={styles.amountRow}>
            <Text style={[styles.amount, { color: tooMuch ? C.red : expr ? C.label : C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{amountText}</Text>
            <Text style={styles.cur}>{cur}</Text>
          </View>
          <CalcLine expr={expr} />
          {shown !== null ? <Text style={[styles.limit, tooMuch && { color: C.red }]}>{tooMuch ? "That is more than there is to give" : `${formatMinor(shown, cur)} ${cur} available`}</Text> : null}
          {tags.length ? (
            <View style={styles.tagLine}>
              <SymbolView name="number" size={14} tintColor={C.secondary} />
              {tags.map((tag) => <TagPill key={tag.id} name={tag.name} color={tag.color} onPress={() => setTagIds((ids) => ids.filter((x) => x !== tag.id))} />)}
            </View>
          ) : null}
        </View>
      }
      bottom={
        <>
          <Keypad value={expr} onChange={setExpr} allowSign={false}
            extra={p.kind ? { label: category ? category.name : "Category", a11y: `Category: ${category ? category.name : "none"}`, icon: catIcon ? (catIcon.icon as SFSymbol) : "folder.badge.plus", color: catIcon?.color, active: !!category, onPress: () => router.push({ pathname: "/pick/category", params: { key: keys.cat, kind: p.kind === "income" ? "income" : "expense", selected: categoryId ?? "" } }) } : undefined}
            extra2={p.kind ? { a11y: tags.length ? `Tags: ${tags.map((tag) => tag.name).join(", ")}` : "Tags", icon: "number", badge: tags.length || undefined, active: tags.length > 0, onPress: () => router.push({ pathname: "/pick/tags", params: { key: keys.tags, selected: tagIds.join(","), category: categoryId ?? "" } }) } : undefined} />
          <ConfirmBar amount={`${amountText} ${cur}`} label={tooMuch ? "More than there is to give" : "Use this amount"}
            disabled={abs === null || abs === 0 || tooMuch} onPress={use} />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs, gap: 4 },
  title: { textAlign: "center", fontSize: 15, color: C.secondary },
  amountRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8, maxWidth: "100%" },
  amount: { fontSize: 54, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  cur: { fontSize: 22, color: C.secondary, fontWeight: "600" },
  limit: { textAlign: "center", fontSize: 13, color: C.secondary },
  tagLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: S.xs },
});
