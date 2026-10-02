import { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { budgetCategoryIds, createBudget, formatMinor, getRow, listRows, remove, save, scopedBudget, suggestBudget, toMinor, fromMinor, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { Chip, SheetFrame, Subtle, Title, ChipRow, DeleteRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
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
  usePickResult<string>(tagKey, (v: string) => { setTagId(v); setCategoryIds([]); });
  const pickTag = () => {
    const tags = listRows(db, "tags", "deleted=0", [], "name");
    if (!tags.length) { Alert.alert(t("budgets.edit.noTagsTitle"), t("budgets.edit.noTagsBody")); return; }
    router.push({ pathname: "/pick/option", params: { key: tagKey, title: t("budgets.edit.tagPickerTitle"), selected: tagId ?? "", options: JSON.stringify(tags.map((x) => ({ value: x.id, label: x.name, subtitle: t("budgets.edit.tagPickerSubtitle") }))) } });
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
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title numberOfLines={2}>{name.trim() || covers}</Title>
          <Subtle>{[
            name.trim() ? covers : null,
            t("budgets.edit.monthlyLimit", { currency }),
            startDay > 1 ? t("budgets.edit.periodStart", { day: startDay }) : null,
            accountName ? t("budgets.edit.onlyFor", { account: accountName }) : null,
            counted ? null : t("budgets.edit.notCounted"),
          ].filter(Boolean).join(" · ")}</Subtle>
          {suggestion ? (
            <View style={styles.suggest}>
              <Subtle>{t("budgets.edit.suggested")}</Subtle>
              {/* The averages first, shortest window to longest, then the two extremes. Each chip
                  names the number of months it covers rather than claiming "a year" or "all time"
                  over whatever history happens to exist; the longer ones are dropped when they would
                  only repeat a shorter one. */}
              <ChipRow>
                {pick(t("budgets.edit.avg", { count: suggestion.periods }), suggestion.average_minor)}
                {suggestion.year_minor !== null ? pick(t("budgets.edit.avg", { count: suggestion.year_periods }), suggestion.year_minor) : null}
                {suggestion.all_periods > Math.max(suggestion.year_periods, suggestion.periods) ? pick(t("budgets.edit.avgAll", { count: suggestion.all_periods }), suggestion.all_minor) : null}
                {pick(t("budgets.edit.lastMonth"), suggestion.last_minor)}
                {pick(t("budgets.edit.highest"), suggestion.max_minor)}
                {suggestion.min_minor !== suggestion.max_minor ? pick(t("budgets.edit.lowest"), suggestion.min_minor) : null}
              </ChipRow>
            </View>
          ) : null}
          <Title style={[styles.amount, !expr && { color: C.tertiary }]}>{shown} <Subtle style={{ fontSize: 18 }}>{currency}</Subtle></Title>
          <CalcLine expr={expr} style={{ textAlign: "left" }} />
        </View>
      }
      bottom={
        <>
          <ChipRow>
            {/* The multi-picker resolves a fully ticked folder back to the folder's own id, which is
                exactly what a budget wants: "this folder, including categories added later". */}
            <Chip icon="folder" label={scopeLabel ?? t("budgets.edit.categories")} active={categoryIds.length > 0}
              onPress={() => router.push({ pathname: "/pick/categories", params: { key, selected: categoryIds.join(","), title: t("budgets.edit.categoryPickerTitle") } })} />
            <Chip icon="number" label={tag?.name ?? t("budgets.edit.tag")} active={!!tag} onPress={pickTag} />
            <Chip icon="asterisk" label={t("budgets.edit.allSpending")} active={!categoryIds.length && !tag} onPress={() => { setCategoryIds([]); setTagId(null); }} />
          </ChipRow>
          <ChipRow>
            <Chip icon="textformat" label={name.trim() || t("budgets.edit.name")} active={!!name.trim()}
              onPress={() => router.push({ pathname: "/pick/text", params: { key: nameKey, title: t("budgets.edit.nameTitle"), value: name } })} />
            {/* A limit you keep as a yardstick still shows its own bar; it just stays out of the two
                numbers at the top, where it would otherwise read as money set aside. */}
            <Chip icon={counted ? "sum" : "eye.slash"} label={counted ? t("budgets.edit.inPlanned") : t("budgets.edit.notInPlanned")} active={counted} onPress={() => setCounted((v) => !v)} />
          </ChipRow>
          <Keypad value={expr} onChange={setExpr} allowSign={false} />
          <ConfirmBar amount={`${shown} ${currency}`} label={existing ? t("budgets.edit.tapToSave") : t("budgets.edit.tapToAdd")} onPress={commit} disabled={!valid} />
          {existing ? <DeleteRow label={t("budgets.edit.delete")} onPress={del} /> : null}
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
