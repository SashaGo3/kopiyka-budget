import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { File, Paths } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import { Card, Chip, ChipRow, Empty, Row, SectionHeader } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { clearParseLog, parseLogCsv, readParseLog, UNLOGGED, type ParseEntry, type ParseOutcome } from "@/lib/parselog";

/** Colour and words per outcome. The three that wrote nothing are the ones worth looking at. */
const OUTCOME: Record<ParseOutcome, { label: string; color: string; why: string }> = {
  logged: { label: "Logged", color: "#30D158", why: "Read and saved; history already knew the shop." },
  pending: { label: "Pending", color: "#FF9F0A", why: "Read and saved, waiting to be checked." },
  duplicate: { label: "Duplicate", color: "#8E8E93", why: "The same charge was already logged." },
  unreadable: { label: "Unreadable", color: "#FF453A", why: "Money is named and no amount could be read." },
  ignored: { label: "Ignored", color: "#8E8E93", why: "No amount, or money the bank is not charging." },
  failed: { label: "Failed", color: "#FF453A", why: "Understood, but nothing was written." },
};

/**
 * What the notification automation made of every notification it was handed.
 *
 * The automation is deliberately silent — it runs with the app closed and must not interrupt a
 * payment to say it worked. The cost of that silence is that a bank whose wording the reader does
 * not know yet loses purchases without anyone noticing, so it writes down what it saw instead
 * (`native/KPParseLog.swift`). This screen is where that gets read, and the CSV is for working
 * through a batch of them properly.
 *
 * "Not logged" is the default view, because it is the only one that needs anything doing.
 */
export default function ParseLogScreen() {
  const [entries, setEntries] = useState<ParseEntry[]>([]);
  const [onlyUnlogged, setOnlyUnlogged] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  // Re-read on every visit: the automation appends to the file while this screen is not on screen.
  useFocusEffect(useCallback(() => { setEntries(readParseLog()); }, []));
  const shown = useMemo(() => (onlyUnlogged ? entries.filter((e) => UNLOGGED.includes(e.outcome)) : entries), [entries, onlyUnlogged]);
  const unlogged = useMemo(() => entries.filter((e) => UNLOGGED.includes(e.outcome)).length, [entries]);

  const exportCsv = async () => {
    if (!entries.length) return;
    try {
      const name = `Kopiyka-notifications-${todayLocal()}.csv`;
      const f = new File(Paths.cache, name);
      f.write(parseLogCsv(entries));   // always the whole log, whatever this screen is filtered to
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
          Every notification the automation was handed, newest first, and what it made of it. Nothing here left the phone.
          {entries.length ? ` ${entries.length} kept, ${unlogged} of them not logged.` : ""}
        </Text>
        <ChipRow>
          <Chip icon="exclamationmark.triangle" label={`Not logged${unlogged ? ` (${unlogged})` : ""}`} active={onlyUnlogged} onPress={() => setOnlyUnlogged(true)} />
          <Chip icon="list.bullet" label={`All${entries.length ? ` (${entries.length})` : ""}`} active={!onlyUnlogged} onPress={() => setOnlyUnlogged(false)} />
        </ChipRow>

        {shown.length ? <SectionHeader>{onlyUnlogged ? "Nothing was written for these" : "Everything it saw"}</SectionHeader> : null}
        {shown.map((e, i) => {
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
        {!shown.length ? (
          <Empty title={entries.length ? "Nothing went wrong" : "Nothing logged yet"}
            hint={entries.length ? "Every notification it saw was read or was not about money." : "It fills up as your bank's notifications arrive."} />
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
