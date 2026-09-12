import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { createBudget, getRow, listRows, remove, save, suggestBudget, toMinor, fromMinor, type Budget } from "@kopiyka/core";
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
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? null);
  const [tagId, setTagId] = useState<string | null>(existing?.tag_id ?? null);
  const tag = useQuery((d) => (tagId ? getRow(d, "tags", tagId) : null), [tagId]);
  const currency = existing?.currency ?? getBaseCurrency();
  const [expr, setExpr] = useState(existing ? String(fromMinor(existing.amount_minor, existing.currency)) : "");
  const startDay = getPeriodStartDay();
  const cat = useQuery((d) => (categoryId ? getRow(d, "categories", categoryId) : null), [categoryId]);
  const suggestion = useQuery((d) => suggestBudget(d, { categoryId, tagId, currency, accountIds: accountId ? [accountId] : undefined, startDay }), [categoryId, tagId, currency, accountId, startDay]);
  const roundToWhole = (m: number) => Math.round(fromMinor(m, currency));
  const key = useMemo(() => newPickKey("bcat"), []);
  const tagKey = useMemo(() => newPickKey("btag"), []);
  usePickResult<string | null>(key, (v: string | null) => { setCategoryId(v); setTagId(null); });
  usePickResult<string>(tagKey, (v: string) => { setTagId(v); setCategoryId(null); });
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
      const base = { category_id: categoryId, tag_id: tagId, currency, amount_minor: toMinor(value!, currency), starts: monthBounds(todayLocal()).start, start_day: startDay, account_id: accountId } as const;
      if (existing) save(d, "budgets", { ...existing, ...base } as Budget); else createBudget(d, base);
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
          <Title>{tag ? `#${tag.name}` : cat ? cat.name : "Everything"}</Title>
          <Subtle>Monthly limit in {currency}{startDay > 1 ? ` · periods start on the ${startDay}th` : ""}{accountName ? ` · only for ${accountName}` : ""}</Subtle>
          {suggestion ? (
            <View style={styles.suggest}>
              <Subtle>Suggested</Subtle>
              <ChipRow>
                <Chip compact label={`Avg ${suggestion.periods} month${suggestion.periods === 1 ? "" : "s"} · ${group(roundToWhole(suggestion.average_minor))}`} onPress={() => setExpr(String(roundToWhole(suggestion.average_minor)))} />
                <Chip compact label={`Last month · ${group(roundToWhole(suggestion.last_minor))}`} onPress={() => setExpr(String(roundToWhole(suggestion.last_minor)))} />
                <Chip compact label={`Highest · ${group(roundToWhole(suggestion.max_minor))}`} onPress={() => setExpr(String(roundToWhole(suggestion.max_minor)))} />
              </ChipRow>
            </View>
          ) : null}
          <Title style={styles.amount}>{expr || "0"} <Subtle style={{ fontSize: 18 }}>{currency}</Subtle></Title>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="folder" label={cat?.name ?? "Category"} active={!!cat} onPress={() => router.push({ pathname: "/pick/category", params: { key, selected: categoryId ?? "", folders: "1" } })} />
            <Chip icon="number" label={tag?.name ?? "Tag"} active={!!tag} onPress={pickTag} />
            <Chip icon="asterisk" label="All spending" active={!cat && !tag} onPress={() => { setCategoryId(null); setTagId(null); }} />
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

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: 4 },
  amount: { fontSize: 44, marginTop: S.sm },
  suggest: { marginTop: S.sm, gap: 4 },
});
