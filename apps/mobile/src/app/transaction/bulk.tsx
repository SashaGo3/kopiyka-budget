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

  const cats = useQuery((d) => new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c.name])));
  const tags = useQuery((d) => new Map(listRows(d, "tags", "1=1").map((t) => [t.id, t.name])));
  const accounts = useQuery((d) => new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a])));
  const affected = useQuery(() => bulkAffected(db, ids, change), [p.ids, JSON.stringify(change)]);
  const transfers = useMemo(() => new Set(affected.map((a) => a.row.transfer_id).filter(Boolean)).size, [affected]);

  const catName = (id: string | null | undefined) => (id ? cats.get(id) ?? "a deleted category" : "No category");
  const tagLine = (ids2: string[]) => (ids2.length ? ids2.map((t) => `#${tags.get(t) ?? "?"}`).join(" ") : "No tags");
  /** What the row says now, and what it would say — of the one thing this change is about. */
  const sides = (row: Transaction, patch: Partial<Transaction>): { before: string; after: string } => {
    switch (change.kind) {
      case "category": return { before: catName(row.category_id), after: catName(patch.category_id) };
      case "tags": return { before: tagLine(jsonIds(row.tag_ids)), after: tagLine(jsonIds(patch.tag_ids ?? "[]")) };
      case "date": return { before: humanDayTime(row.date), after: humanDayTime(patch.date ?? row.date) };
      case "note": return { before: row.notes || "No note", after: patch.notes || "No note" };
      case "confirm": return { before: "Pending", after: "Confirmed" };
    }
  };
  const title = (() => {
    switch (change.kind) {
      case "category": return `Category → ${catName(change.category_id)}`;
      case "tags": return [change.add.length ? `Add ${change.add.map((t) => `#${tags.get(t) ?? "?"}`).join(" ")}` : "", change.drop.length ? `Remove ${change.drop.map((t) => `#${tags.get(t) ?? "?"}`).join(" ")}` : ""].filter(Boolean).join(" · ");
      case "date": return `Move to ${humanDayTime(change.day)}`;
      case "note": return mode === "replace" ? "Replace the note" : "Add to the note";
      case "confirm": return "Approve pending entries";
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
      <ModalHeader title="Review changes" left={{ label: "Cancel", onPress: () => router.back() }} />
      <FlatList
        data={affected}
        keyExtractor={(a) => a.row.id}
        contentContainerStyle={{ paddingBottom: 140 }}
        ListHeaderComponent={
          <View>
            <Text style={styles.what}>{title}</Text>
            <Text style={styles.count}>
              {affected.length === 1 ? "1 transaction changes" : `${affected.length} transactions change`}
              {skipped > 0 ? ` · ${skipped} already ${change.kind === "confirm" ? "confirmed" : "like that"}` : ""}
              {transfers > 0 ? ` · both sides of ${transfers === 1 ? "a transfer" : `${transfers} transfers`}` : ""}
            </Text>
            {change.kind === "note" ? (
              <View style={{ paddingHorizontal: S.md, paddingBottom: S.sm }}>
                <Segmented<"replace" | "append"> value={mode} onChange={setMode}
                  options={[{ value: "replace", label: "Replace note" }, { value: "append", label: "Add a line" }]} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Text style={styles.none}>Nothing to change: every one of them already says that.</Text>}
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
        <BigButton label={affected.length ? (affected.length === 1 ? "Change 1 transaction" : `Change ${affected.length} transactions`) : "Nothing to change"}
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
