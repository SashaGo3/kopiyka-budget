import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router, useLocalSearchParams } from "expo-router";
import { budgetCategoryIds, createBudget, formatMinor, getRow, listRows, remove, save, scopedBudget, suggestBudget, toMinor, fromMinor, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { Chip, ChipGrid, SheetFrame } from "@/components/ui";
import { SideScroll } from "@/components/SideScroll";
import { C, S, themed } from "@/constants/theme";
import { monthBounds, todayLocal } from "@/lib/dates";
import { getBaseCurrency } from "@/lib/rates";
import { getPeriodStartDay } from "@/lib/period";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";
import { catName, acctName } from "@/lib/names";

export default function BudgetEdit() {
  const { id, account } = useLocalSearchParams<{ id: string; account?: string }>();
  const existing = id === "new" ? null : getRow(db, "budgets", id) ?? null;
  const accountId = existing ? existing.account_id : account || null;
  const accountName = useQuery((d) => (accountId ? acctName(getRow(d, "accounts", accountId)) ?? null : null), [accountId]);
  const [categoryIds, setCategoryIds] = useState<string[]>(() => (existing ? budgetCategoryIds(existing) : []));
  const [tagId, setTagId] = useState<string | null>(existing?.tag_id ?? null);
  // A name of its own, for the budget whose categories do not explain it. Empty falls back to the
  // scope, which is what every budget was called before this existed.
  const [name, setName] = useState(existing?.name ?? "");
  const [counted, setCounted] = useState(existing ? existing.in_planned !== 0 : true);
  const tag = useQuery((d) => (tagId ? getRow(d, "tags", tagId) : null), [tagId]);
  const currency = existing?.currency ?? getBaseCurrency();
  const [expr, setExpr] = useState(existing ? String(fromMinor(existing.amount_minor, existing.currency)) : "");
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([categoryIds, tagId, name, counted, expr]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
  const startDay = getPeriodStartDay();
  // One name reads better than a count, so the names are spelled out until there are too many of them.
  const catNames = useQuery((d) => {
    const cats = new Map(listRows(d, "categories", "deleted=0").map((c) => [c.id, catName(c)]));
    return categoryIds.map((cid) => (cid === "none" ? t("budgets.title.uncategorized") : cats.get(cid) ?? "?"));
  }, [categoryIds.join(",")]);
  const scopeLabel = catNames.length === 0 ? null : catNames.length <= 2 ? catNames.join(", ") : t("budgets.edit.categoriesCount", { count: catNames.length });
  const suggestion = useQuery((d) => suggestBudget(d, { categoryIds, tagId, currency, accountIds: accountId ? [accountId] : undefined, startDay }), [categoryIds.join(","), tagId, currency, accountId, startDay]);
  const covers = tag ? `#${tag.name}` : scopeLabel ?? t("budgets.title.everything");
  const roundToWhole = (m: number) => Math.round(fromMinor(m, currency));
  const pick = (label: string, minor: number) => (
    <Chip key={label} compact label={`${label} · ${group(roundToWhole(minor))}`} onPress={() => setExpr(String(roundToWhole(minor)))} />
  );
  const key = useMemo(() => newPickKey("bcat"), []);
  const tagKey = useMemo(() => newPickKey("btag"), []);
  const nameKey = useMemo(() => newPickKey("bname"), []);
  usePickResult<string>(nameKey, (v: string) => setName(v.trim()));
  usePickResult<string[]>(key, (v: string[]) => { setCategoryIds(v); if (v.length) setTagId(null); });
  usePickResult<string>(tagKey, (v: string) => { setTagId(v || null); setCategoryIds([]); });
  const pickTag = () => {
    const tags = listRows(db, "tags", "deleted=0", [], "name");
    if (!tags.length) { Alert.alert(t("budgets.edit.noTagsTitle"), t("budgets.edit.noTagsBody")); return; }
    // "No tag" first, so a tag budget can go back to categories without a separate button for it.
    router.push({ pathname: "/pick/option", params: { key: tagKey, title: t("budgets.edit.tagPickerTitle"), selected: tagId ?? "", options: JSON.stringify([
      ...(tagId ? [{ value: "", label: t("budgets.edit.noTag"), subtitle: t("budgets.edit.noTagSubtitle") }] : []),
      ...tags.map((x) => ({ value: x.id, label: x.name, subtitle: t("budgets.edit.tagPickerSubtitle") })),
    ]) } });
  };
  // `evalPartial`, as on the Log sheet: "900−" already means 900, and the field shows what is saved.
  const value = evalPartial(expr);
  const shown = value !== null ? formatMinor(toMinor(value, currency), currency) : "0";
  const valid = value !== null && value > 0;
  const commit = () => {
    if (!valid) return;
    mutate((d) => {
      const base = { category_ids: JSON.stringify(categoryIds), tag_id: tagId, currency, amount_minor: toMinor(value!, currency), starts: monthBounds(todayLocal()).start, start_day: startDay, account_id: accountId, name: name.trim() || null, in_planned: counted ? 1 : 0 } as const;
      // `scopedBudget` keeps `category_id` in step with the set; `createBudget` does it itself.
      if (existing) save(d, "budgets", scopedBudget({ ...existing, ...base }) as Budget); else createBudget(d, base);
    });
    leave();
  };
  const del = () => existing && Alert.alert(t("budgets.edit.deleteTitle"), undefined, [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => remove(d, "budgets", existing.id)); leave(); } },
  ]);
  // Laid out like the entry sheet: what it covers and the amount large at the top; then, in the thumb
  // zone, what it could be — the averages, a line that scrolls sideways right above the buttons — the
  // settings as a row of fixed cells, the keypad and the bar that saves.
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          {existing ? <Pressable onPress={del} hitSlop={10} style={styles.trash} accessibilityRole="button" accessibilityLabel={t("budgets.edit.delete")}><SymbolView name="trash" size={16} tintColor={C.red} /></Pressable> : null}
          <Text style={styles.covers} numberOfLines={2}>{name.trim() || covers}</Text>
          <Text style={styles.meta}>{[
            name.trim() ? covers : null,
            t("budgets.edit.monthlyLimit", { currency }),
            startDay > 1 ? t("budgets.edit.periodStart", { day: startDay }) : null,
            accountName ? t("budgets.edit.onlyFor", { account: accountName }) : null,
            counted ? null : t("budgets.edit.notCounted"),
          ].filter(Boolean).join(" · ")}</Text>
          <View style={styles.amountRow} accessible accessibilityLabel={`${shown} ${currency}`}>
            <Text style={[styles.amount, { color: expr ? C.label : C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{shown}</Text>
            <Text style={styles.currency}>{currency}</Text>
          </View>
          <CalcLine expr={expr} style={styles.calc} />
        </View>
      }
      bottom={
        <>
          {suggestion ? (
            // Not a ScrollView: a form sheet takes any ScrollView in it for its own and moves it to the top (SideScroll).
            <SideScroll style={styles.suggest} contentStyle={styles.suggestRow} accessibilityLabel={t("budgets.edit.suggested")}>
              {/* The averages first, shortest window to longest, then the two extremes. Each chip names
                  the number of months it covers rather than claiming "a year" or "all time" over
                  whatever history happens to exist; the longer ones are dropped when they would only
                  repeat a shorter one. */}
              {pick(t("budgets.edit.avg", { count: suggestion.periods }), suggestion.average_minor)}
              {suggestion.year_minor !== null ? pick(t("budgets.edit.avg", { count: suggestion.year_periods }), suggestion.year_minor) : null}
              {suggestion.all_periods > Math.max(suggestion.year_periods, suggestion.periods) ? pick(t("budgets.edit.avgAll", { count: suggestion.all_periods }), suggestion.all_minor) : null}
              {pick(t("budgets.edit.lastMonth"), suggestion.last_minor)}
              {pick(t("budgets.edit.highest"), suggestion.max_minor)}
              {suggestion.min_minor !== suggestion.max_minor ? pick(t("budgets.edit.lowest"), suggestion.min_minor) : null}
            </SideScroll>
          ) : null}
          {/* What it covers is one choice: categories (none ticked is everything) or a tag. The
              multi-picker resolves a fully ticked folder back to the folder's own id, which is
              exactly what a budget wants: "this folder, including categories added later". */}
          <ChipGrid rows={1}>
            <Chip cell icon="folder" label={scopeLabel ?? (tag ? t("budgets.edit.categories") : t("budgets.title.everything"))} active={categoryIds.length > 0}
              onPress={() => router.push({ pathname: "/pick/categories", params: { key, selected: categoryIds.join(","), title: t("budgets.edit.categoryPickerTitle") } })} />
            <Chip cell icon="number" label={tag?.name ?? t("budgets.edit.tag")} active={!!tag} onPress={pickTag} />
            <Chip cell icon="textformat" label={name.trim() || t("budgets.edit.name")} active={!!name.trim()}
              onPress={() => router.push({ pathname: "/pick/text", params: { key: nameKey, title: t("budgets.edit.nameTitle"), value: name } })} />
            {/* A limit you keep as a yardstick still shows its own bar; it just stays out of the two
                numbers at the top, where it would otherwise read as money set aside. */}
            <Chip cell icon={counted ? "sum" : "eye.slash"} label={counted ? t("budgets.edit.inPlanned") : t("budgets.edit.notInPlanned")} active={counted} onPress={() => setCounted((v) => !v)} />
          </ChipGrid>
          <Keypad value={expr} onChange={setExpr} allowSign={false} />
          <ConfirmBar amount={`${shown} ${currency}`} label={existing ? t("budgets.edit.tapToSave") : t("budgets.edit.tapToAdd")} onPress={commit} disabled={!valid} />
        </>
      }
    />
  );
}

function group(n: number): string { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs, gap: 4, alignItems: "center" },
  covers: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingHorizontal: 40 },
  meta: { fontSize: 13, color: C.secondary, textAlign: "center" },
  amountRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", gap: 8, maxWidth: "100%", marginTop: S.xs },
  amount: { fontSize: 54, fontWeight: "700", fontVariant: ["tabular-nums"], flexShrink: 1 },
  currency: { fontSize: 22, color: C.secondary, fontWeight: "600" },
  calc: { textAlign: "center" },
  // Spans the sheet's width so a chip scrolls off the side instead of stopping short of it.
  suggest: { alignSelf: "stretch" },
  suggestRow: { paddingHorizontal: S.xl, gap: S.sm },
  trash: { position: "absolute", top: 8, right: S.md, width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill, alignItems: "center", justifyContent: "center", zIndex: 1 },
}));
