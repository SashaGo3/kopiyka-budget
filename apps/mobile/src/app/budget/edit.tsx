import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { budgetCategoryIds, createBudget, getRow, listRows, remove, save, scopedBudget, suggestBudget, toMinor, fromMinor, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, SheetFrame, Subtle, Title, ChipRow, DeleteRow } from "@/components/ui";
import { S } from "@/constants/theme";
import { monthBounds, todayLocal } from "@/lib/dates";
import { getBaseCurrency } from "@/lib/rates";
import { getPeriodStartDay } from "@/lib/period";

export default function BudgetEdit() {
  const { id, account } = useLocalSearchParams<{ id: string; account?: string }>();
  const existing = id === "new" ? null : getRow(db, "budgets", id) ?? null;
  const accountId = existing ? existing.account_id : account || null;
  const accountName = useQuery((d) => (accountId ? getRow(d, "accounts", accountId)?.name ?? null : null), [accountId]);
  const [categoryIds, setCategoryIds] = useState<string[]>(() => (existing ? budgetCategoryIds(existing) : []));
  const [tagId, setTagId] = useState<string | null>(existing?.tag_id ?? null);
  // A name of its own, for the budget whose categories do not explain it. Empty falls back to the
  // scope, which is what every budget was called before this existed.
  const [name, setName] = useState(existing?.name ?? "");
  const [counted, setCounted] = useState(existing ? existing.in_planned !== 0 : true);
  const tag = useQuery((d) => (tagId ? getRow(d, "tags", tagId) : null), [tagId]);
  const currency = existing?.currency ?? getBaseCurrency();
  const [expr, setExpr] = useState(existing ? String(fromMinor(existing.amount_minor, existing.currency)) : "");
  const startDay = getPeriodStartDay();
  // One name reads better than a count, so the names are spelled out until there are too many of them.
  const catNames = useQuery((d) => {
    const cats = new Map(listRows(d, "categories", "deleted=0").map((c) => [c.id, c.name]));
    return categoryIds.map((cid) => (cid === "none" ? "Uncategorized" : cats.get(cid) ?? "?"));
  }, [categoryIds.join(",")]);
  const scopeLabel = catNames.length === 0 ? null : catNames.length <= 2 ? catNames.join(", ") : `${catNames.length} categories`;
  const suggestion = useQuery((d) => suggestBudget(d, { categoryIds, tagId, currency, accountIds: accountId ? [accountId] : undefined, startDay }), [categoryIds.join(","), tagId, currency, accountId, startDay]);
  const roundToWhole = (m: number) => Math.round(fromMinor(m, currency));
  const pick = (label: string, minor: number) => (
    <Chip key={label} compact label={`${label} · ${group(roundToWhole(minor))}`} onPress={() => setExpr(String(roundToWhole(minor)))} />
  );
  const key = useMemo(() => newPickKey("bcat"), []);
  const tagKey = useMemo(() => newPickKey("btag"), []);
  const nameKey = useMemo(() => newPickKey("bname"), []);
  usePickResult<string>(nameKey, (v: string) => setName(v.trim()));
  usePickResult<string[]>(key, (v: string[]) => { setCategoryIds(v); if (v.length) setTagId(null); });
  usePickResult<string>(tagKey, (v: string) => { setTagId(v); setCategoryIds([]); });
  const pickTag = () => {
    const tags = listRows(db, "tags", "deleted=0", [], "name");
    if (!tags.length) { Alert.alert("No tags yet", "Create a tag in Settings → Tags first."); return; }
    router.push({ pathname: "/pick/option", params: { key: tagKey, title: "Budget for a tag", selected: tagId ?? "", options: JSON.stringify(tags.map((t) => ({ value: t.id, label: t.name, subtitle: "Every expense with this tag counts" }))) } });
  };
  const value = evalExpr(expr);
  const valid = value !== null && value > 0;
  const commit = () => {
    if (!valid) return;
    mutate((d) => {
      const base = { category_ids: JSON.stringify(categoryIds), tag_id: tagId, currency, amount_minor: toMinor(value!, currency), starts: monthBounds(todayLocal()).start, start_day: startDay, account_id: accountId, name: name.trim() || null, in_planned: counted ? 1 : 0 } as const;
      // `scopedBudget` keeps `category_id` in step with the set; `createBudget` does it itself.
      if (existing) save(d, "budgets", scopedBudget({ ...existing, ...base }) as Budget); else createBudget(d, base);
    });
    router.back();
  };
  const del = () => existing && Alert.alert("Delete budget?", undefined, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => remove(d, "budgets", existing.id)); router.back(); } },
  ]);
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title numberOfLines={2}>{name.trim() || (tag ? `#${tag.name}` : scopeLabel ?? "Everything")}</Title>
          <Subtle>{name.trim() ? `${tag ? `#${tag.name}` : scopeLabel ?? "Everything"} · ` : ""}Monthly limit in {currency}{startDay > 1 ? ` · periods start on the ${startDay}th` : ""}{accountName ? ` · only for ${accountName}` : ""}{counted ? "" : " · not counted in Planned"}</Subtle>
          {suggestion ? (
            <View style={styles.suggest}>
              <Subtle>Suggested</Subtle>
              {/* The averages first, shortest window to longest, then the two extremes. Each chip
                  names the number of months it covers rather than claiming "a year" or "all time"
                  over whatever history happens to exist; the longer ones are dropped when they would
                  only repeat a shorter one. */}
              <ChipRow>
                {pick(`Avg ${months(suggestion.periods)}`, suggestion.average_minor)}
                {suggestion.year_minor !== null ? pick(`Avg ${months(suggestion.year_periods)}`, suggestion.year_minor) : null}
                {suggestion.all_periods > Math.max(suggestion.year_periods, suggestion.periods) ? pick(`Avg all ${months(suggestion.all_periods)}`, suggestion.all_minor) : null}
                {pick("Last month", suggestion.last_minor)}
                {pick("Highest", suggestion.max_minor)}
                {suggestion.min_minor !== suggestion.max_minor ? pick("Lowest", suggestion.min_minor) : null}
              </ChipRow>
            </View>
          ) : null}
          <Title style={styles.amount}>{expr || "0"} <Subtle style={{ fontSize: 18 }}>{currency}</Subtle></Title>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            {/* The multi-picker resolves a fully ticked folder back to the folder's own id, which is
                exactly what a budget wants: "this folder, including categories added later". */}
            <Chip icon="folder" label={scopeLabel ?? "Categories"} active={categoryIds.length > 0}
              onPress={() => router.push({ pathname: "/pick/categories", params: { key, selected: categoryIds.join(","), title: "Budget for" } })} />
            <Chip icon="number" label={tag?.name ?? "Tag"} active={!!tag} onPress={pickTag} />
            <Chip icon="asterisk" label="All spending" active={!categoryIds.length && !tag} onPress={() => { setCategoryIds([]); setTagId(null); }} />
          </ChipRow>
          <ChipRow>
            <Chip icon="textformat" label={name.trim() || "Name"} active={!!name.trim()}
              onPress={() => router.push({ pathname: "/pick/text", params: { key: nameKey, title: "Budget name", value: name } })} />
            {/* A limit you keep as a yardstick still shows its own bar; it just stays out of the two
                numbers at the top, where it would otherwise read as money set aside. */}
            <Chip icon={counted ? "sum" : "eye.slash"} label={counted ? "In Planned" : "Not in Planned"} active={counted} onPress={() => setCounted((v) => !v)} />
          </ChipRow>
          <Keypad value={expr} onChange={setExpr} allowSign={false} />
          <ConfirmBar amount={`${expr || "0"} ${currency}`} label={existing ? "Tap to save" : "Tap to add budget"} onPress={commit} disabled={!valid} />
          {existing ? <DeleteRow label="Delete budget" onPress={del} /> : null}
        </>
      }
    />
  );
}

function group(n: number): string { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function months(n: number): string { return `${n} month${n === 1 ? "" : "s"}`; }

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: 4 },
  amount: { fontSize: 44, marginTop: S.sm },
  suggest: { marginTop: S.sm, gap: 4 },
});
