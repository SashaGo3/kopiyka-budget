import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { File, Paths } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import { Card, Empty, Row, SectionHeader } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { clearParseLog, parseLogCsv, readParseLog, type ParseEntry, type ParseOutcome } from "@/lib/parselog";

/** Why nothing was written, in words and in a colour. Red is a purchase that may have been lost. */
const OUTCOME: Record<ParseOutcome, { label: string; color: string; why: string }> = {
  unreadable: { label: "Unreadable", color: "#FF453A", why: "Money is named and no amount could be read out of it. This is the one worth working on." },
  failed: { label: "Failed", color: "#FF453A", why: "Understood, but nothing was written — no account to put it on, or the app refused." },
  ignored: { label: "Not money", color: "#8E8E93", why: "No amount in it, or money the bank is not charging: a balance, a code, a declined card. Usually right." },
};

/**
 * The notifications the automation could not turn into a transaction.
 *
 * It is deliberately silent — it runs with the app closed and must not interrupt a payment to say it
 * worked. The cost of that silence is that a bank whose wording the reader does not know yet loses
 * purchases without anyone noticing, so the ones it could not use are written down instead
 * (`native/KPParseLog.swift`). The ones it could are not: a transaction is its own record.
 *
 * The CSV is for working through a batch of them properly.
 */
export default function ParseLogScreen() {
  const [entries, setEntries] = useState<ParseEntry[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  // Re-read on every visit: the automation appends to the file while this screen is not on screen.
  useFocusEffect(useCallback(() => { setEntries(readParseLog()); }, []));
  const missed = useMemo(() => entries.filter((e) => e.outcome !== "ignored").length, [entries]);

  const exportCsv = async () => {
    if (!entries.length) return;
    try {
      const name = `Kopiyka-notifications-${todayLocal()}.csv`;
      const f = new File(Paths.cache, name);
      f.write(parseLogCsv(entries));
      const Sharing = require("expo-sharing") as typeof import("expo-sharing"); // eslint-disable-line @typescript-eslint/no-require-imports
      await Sharing.shareAsync(f.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: name });
    } catch (e) { Alert.alert("Export failed", (e as Error).message); }
  };
  const clear = () => Alert.alert("Clear the log?", "The transactions it already wrote are not touched — only this record of what was read.", [
    { text: "Cancel", style: "cancel" },
    { text: "Clear", style: "destructive", onPress: () => { clearParseLog(); setEntries([]); } },
  ]);

  return (
    <>
      <Stack.Screen options={{ title: "Notification log" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={styles.intro}>
          Notifications the automation could not turn into a transaction, newest first. The ones it could are not here — the transaction is the record of those. Nothing here left the phone.
          {missed ? ` ${missed} may be a purchase that was missed.` : ""}
        </Text>

        {entries.length ? <SectionHeader>Nothing was written for these</SectionHeader> : null}
        {entries.map((e, i) => {
          const o = OUTCOME[e.outcome] ?? OUTCOME.ignored;
          const id = `${e.at}-${i}`;
          const expanded = open === id;
          return (
            <View key={id} style={[styles.entry, i ? styles.divider : undefined]}>
              <Pressable onPress={() => setOpen(expanded ? null : id)} accessibilityRole="button"
                accessibilityLabel={`${o.label}, ${when(e.at)}. ${expanded ? "Hide" : "Show"} the whole notification.`}>
                <View style={styles.head}>
                  <View style={[styles.badge, { backgroundColor: o.color + "26" }]}><Text style={[styles.badgeText, { color: o.color }]}>{o.label}</Text></View>
                  <Text style={styles.when}>{when(e.at)}</Text>
                  {e.amount ? <Text style={styles.amount}>{e.amount.toFixed(2)} {e.currency ?? ""}</Text> : null}
                  <SymbolView name={expanded ? "chevron.up" : "chevron.down"} size={11} tintColor={C.tertiary} />
                </View>
                <Text style={styles.text} numberOfLines={expanded ? undefined : 2}>{e.text || "(empty)"}</Text>
              </Pressable>
              {expanded ? (
                <View style={styles.detail}>
                  <Text style={styles.why}>{o.why}</Text>
                  {[["Shop", e.merchant], ["Card", e.card], ["Account", e.account], ["Note", e.note]].map(([k, v]) =>
                    v ? <Text key={k} style={styles.field}><Text style={styles.fieldKey}>{k}: </Text>{v}</Text> : null)}
                </View>
              ) : null}
            </View>
          );
        })}
        {!entries.length ? (
          <Empty title="Nothing was missed" hint="Every notification the automation was handed became a transaction, or was not about money." />
        ) : null}

        <Card style={{ marginTop: S.lg }}>
          <Row icon="square.and.arrow.up" iconColor="#0A84FF" title="Export all as CSV" subtitle={`One row per notification, the whole text included${entries.length ? ` · ${entries.length} rows` : ""}`} onPress={exportCsv} />
          <Row icon="trash" iconColor="#FF453A" title="Clear the log" subtitle="Transactions it already wrote are not touched" onPress={clear} style={styles.divider} destructive />
        </Card>
      </ScrollView>
    </>
  );
}

/** "14:32 · 15 Sep", or the raw stamp if the automation ever writes one this cannot read. */
function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} · ${d.getDate()} ${d.toLocaleString(undefined, { month: "short" })}`;
}

const styles = StyleSheet.create({
  intro: { color: C.secondary, fontSize: 14, lineHeight: 20, paddingHorizontal: S.xl, paddingTop: S.sm, paddingBottom: S.md },
  entry: { marginHorizontal: S.lg, backgroundColor: C.card, paddingHorizontal: S.md, paddingVertical: 10, gap: 4 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.sm },
  badgeText: { fontSize: 12, fontWeight: "700" },
  when: { flex: 1, color: C.secondary, fontSize: 13 },
  amount: { color: C.label, fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"] },
  text: { color: C.label, fontSize: 14, lineHeight: 19 },
  detail: { gap: 3, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  why: { color: C.secondary, fontSize: 13, fontStyle: "italic" },
  field: { color: C.label, fontSize: 13 },
  fieldKey: { color: C.secondary },
});
