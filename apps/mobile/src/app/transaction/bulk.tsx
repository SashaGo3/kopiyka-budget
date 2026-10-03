import { useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { applyBulk, bulkAffected, formatMinor, jsonIds, listRows, type BulkChange, type Transaction } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { BigButton, Card, ModalHeader, Segmented } from "@/components/ui";
import { humanDayTime } from "@/lib/dates";
import { C, R, S } from "@/constants/theme";
import { t } from "@/i18n";
import { catName as shownName } from "@/lib/names";

/**
 * What a multi-edit is about to do, before it does it.
 *
 * Twelve rows changing at once is the one edit in the app with no undo and no obvious trace — you
 * find out what it did by going and looking. So the change is spelled out first, row by row, with
 * what each one says now and what it would say after. Rows the change would not touch are left out
 * entirely rather than listed as unchanged: "12 selected, 9 will change" is the useful sentence.
 *
 * The list is built by `bulkAffected` and written by `applyBulk` — the same function twice, so the
 * preview cannot describe one edit while the save performs another.
 */
export default function BulkPreview() {
  const p = useLocalSearchParams<{ key: string; ids: string; change: string }>();
  const ids = useMemo(() => p.ids.split(",").filter(Boolean), [p.ids]);
  const base = useMemo(() => JSON.parse(p.change) as BulkChange, [p.change]);
  // Replace or append is asked here rather than before the preview, so the answer can be seen.
  const [mode, setMode] = useState<"replace" | "append">("replace");
  const change: BulkChange = base.kind === "note" ? { ...base, mode } : base;

  const cats = useQuery((d) => new Map(listRows(d, "categories", "1=1").map((c) => [c.id, shownName(c)])));
  const tags = useQuery((d) => new Map(listRows(d, "tags", "1=1").map((x) => [x.id, x.name])));
  const accounts = useQuery((d) => new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a])));
  const affected = useQuery(() => bulkAffected(db, ids, change), [p.ids, JSON.stringify(change)]);
  const transfers = useMemo(() => new Set(affected.map((a) => a.row.transfer_id).filter(Boolean)).size, [affected]);

  const catName = (id: string | null | undefined) => (id ? cats.get(id) ?? t("transaction.bulk.deletedCategory") : t("common.noCategory"));
  const tagList = (ids2: string[]) => ids2.map((x) => `#${tags.get(x) ?? "?"}`).join(" ");
  const tagLine = (ids2: string[]) => (ids2.length ? tagList(ids2) : t("transaction.bulk.noTags"));
  /** What the row says now, and what it would say — of the one thing this change is about. */
  const sides = (row: Transaction, patch: Partial<Transaction>): { before: string; after: string } => {
    switch (change.kind) {
      case "category": return { before: catName(row.category_id), after: catName(patch.category_id) };
      case "tags": return { before: tagLine(jsonIds(row.tag_ids)), after: tagLine(jsonIds(patch.tag_ids ?? "[]")) };
      case "date": return { before: humanDayTime(row.date), after: humanDayTime(patch.date ?? row.date) };
      case "note": return { before: row.notes || t("transaction.bulk.noNote"), after: patch.notes || t("transaction.bulk.noNote") };
      case "confirm": return { before: t("transaction.bulk.pending"), after: t("transaction.bulk.confirmed") };
    }
  };
  const title = (() => {
    switch (change.kind) {
      case "category": return t("transaction.bulk.what.category", { name: catName(change.category_id) });
      case "tags": return [change.add.length ? t("transaction.bulk.what.addTags", { tags: tagList(change.add) }) : "", change.drop.length ? t("transaction.bulk.what.removeTags", { tags: tagList(change.drop) }) : ""].filter(Boolean).join(" · ");
      case "date": return t("transaction.bulk.what.date", { day: humanDayTime(change.day) });
      case "note": return mode === "replace" ? t("transaction.bulk.what.noteReplace") : t("transaction.bulk.what.noteAppend");
      case "confirm": return t("transaction.bulk.what.confirm");
    }
  })();

  const commit = () => {
    const n = mutate((d) => applyBulk(d, ids, change));
    resolvePick(p.key, n);
    router.back();
  };

  const skipped = ids.length - affected.length;
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("transaction.bulk.title")} left={{ label: t("common.cancel"), onPress: () => router.back() }} />
      <FlatList
        data={affected}
        keyExtractor={(a) => a.row.id}
        contentContainerStyle={{ paddingBottom: 140 }}
        ListHeaderComponent={
          <View>
            <Text style={styles.what}>{title}</Text>
            <Text style={styles.count}>
              {[
                t("transaction.bulk.count", { count: affected.length }),
                skipped > 0 ? (change.kind === "confirm" ? t("transaction.bulk.skippedConfirmed", { count: skipped }) : t("transaction.bulk.skippedSame", { count: skipped })) : "",
                transfers > 0 ? t("transaction.bulk.transfers", { count: transfers }) : "",
              ].filter(Boolean).join(" · ")}
            </Text>
            {change.kind === "note" ? (
              <View style={{ paddingHorizontal: S.md, paddingBottom: S.sm }}>
                <Segmented<"replace" | "append"> value={mode} onChange={setMode}
                  options={[{ value: "replace", label: t("transaction.bulk.modeReplace") }, { value: "append", label: t("transaction.bulk.modeAppend") }]} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Text style={styles.none}>{t("transaction.bulk.empty")}</Text>}
        renderItem={({ item }) => {
          const { before, after } = sides(item.row, item.patch);
          const acc = accounts.get(item.row.account_id);
          return (
            <Card style={styles.row}>
              <View style={styles.head}>
                <Text style={styles.name} numberOfLines={1}>{item.row.payee || item.row.notes?.split("\n")[0] || catName(item.row.category_id)}</Text>
                <Text style={styles.amount}>{acc ? `${formatMinor(item.row.amount_minor, acc.currency)} ${acc.currency}` : ""}</Text>
              </View>
              <View style={styles.change}>
                <Text style={styles.before} numberOfLines={1}>{before}</Text>
                <SymbolView name="arrow.right" size={11} tintColor={C.tertiary} />
                <Text style={styles.after} numberOfLines={1}>{after}</Text>
              </View>
            </Card>
          );
        }}
      />
      <View style={styles.foot}>
        <BigButton label={affected.length ? t("transaction.bulk.apply", { count: affected.length }) : t("transaction.bulk.nothing")}
          onPress={commit} disabled={!affected.length} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  what: { fontSize: 20, fontWeight: "700", color: C.label, paddingHorizontal: S.xl, paddingTop: S.md },
  count: { fontSize: 14, color: C.secondary, paddingHorizontal: S.xl, paddingTop: 2, paddingBottom: S.md },
  row: { marginHorizontal: S.lg, marginBottom: S.sm, padding: S.md, borderRadius: R.card, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm },
  name: { flex: 1, fontSize: 15, color: C.label, fontWeight: "600" },
  amount: { fontSize: 15, color: C.secondary, fontVariant: ["tabular-nums"] },
  change: { flexDirection: "row", alignItems: "center", gap: S.sm },
  before: { flexShrink: 1, fontSize: 14, color: C.tertiary, textDecorationLine: "line-through" },
  after: { flex: 1, fontSize: 14, color: C.label, fontWeight: "600" },
  none: { color: C.tertiary, fontSize: 15, textAlign: "center", paddingHorizontal: S.xl, paddingVertical: S.xxl },
  foot: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: S.xxl, paddingTop: S.sm, backgroundColor: C.bgGrouped },
});
