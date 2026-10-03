import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, useFocusEffect } from "expo-router";
import { File, Paths } from "expo-file-system";
import { SymbolView } from "expo-symbols";
import { Card, Empty, Row, SectionHeader } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { dayMonth, todayLocal } from "@/lib/dates";
import { t } from "@/i18n";
import { clearParseLog, parseLogCsv, readParseLog, type ParseEntry, type ParseOutcome } from "@/lib/parselog";

/** Why nothing was written, in words and in a colour. Red is a purchase that may have been lost. */
const outcomes = (): Record<ParseOutcome, { label: string; color: string; why: string }> => ({
  unreadable: { label: t("automation.log.unreadable"), color: "#FF453A", why: t("automation.log.unreadableWhy") },
  failed: { label: t("automation.log.failed"), color: "#FF453A", why: t("automation.log.failedWhy") },
  ignored: { label: t("automation.log.ignored"), color: "#8E8E93", why: t("automation.log.ignoredWhy") },
});

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
  const OUTCOME = outcomes();
  const missed = useMemo(() => entries.filter((e) => e.outcome !== "ignored").length, [entries]);

  const exportCsv = async () => {
    if (!entries.length) return;
    try {
      const name = `Kopiyka-notifications-${todayLocal()}.csv`;
      const f = new File(Paths.cache, name);
      f.write(parseLogCsv(entries));
      const Sharing = require("expo-sharing") as typeof import("expo-sharing"); // eslint-disable-line @typescript-eslint/no-require-imports
      await Sharing.shareAsync(f.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: name });
    } catch (e) { Alert.alert(t("automation.log.exportFailed"), (e as Error).message); }
  };
  const clear = () => Alert.alert(t("automation.log.clearTitle"), t("automation.log.clearMessage"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("automation.log.clearButton"), style: "destructive", onPress: () => { clearParseLog(); setEntries([]); } },
  ]);

  return (
    <>
      <Stack.Screen options={{ title: t("automation.log.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <Text style={styles.intro}>{missed ? t("automation.log.introMissed", { count: missed }) : t("automation.log.intro")}</Text>

        {entries.length ? <SectionHeader>{t("automation.log.section")}</SectionHeader> : null}
        {entries.map((e, i) => {
          const o = OUTCOME[e.outcome] ?? OUTCOME.ignored;
          const id = `${e.at}-${i}`;
          const expanded = open === id;
          return (
            <View key={id} style={[styles.entry, i ? styles.divider : undefined]}>
              <Pressable onPress={() => setOpen(expanded ? null : id)} accessibilityRole="button"
                accessibilityLabel={expanded ? t("automation.log.a11yHide", { outcome: o.label, when: when(e.at) }) : t("automation.log.a11yShow", { outcome: o.label, when: when(e.at) })}>
                <View style={styles.head}>
                  <View style={[styles.badge, { backgroundColor: o.color + "26" }]}><Text style={[styles.badgeText, { color: o.color }]}>{o.label}</Text></View>
                  <Text style={styles.when}>{when(e.at)}</Text>
                  {e.amount ? <Text style={styles.amount}>{e.amount.toFixed(2)} {e.currency ?? ""}</Text> : null}
                  <SymbolView name={expanded ? "chevron.up" : "chevron.down"} size={11} tintColor={C.tertiary} />
                </View>
                <Text style={styles.text} numberOfLines={expanded ? undefined : 2}>{e.text || t("automation.log.empty")}</Text>
              </Pressable>
              {expanded ? (
                <View style={styles.detail}>
                  <Text style={styles.why}>{o.why}</Text>
                  {[[t("automation.log.fieldShop"), e.merchant], [t("automation.log.fieldCard"), e.card], [t("automation.log.fieldAccount"), e.account], [t("automation.log.fieldNote"), e.note]].map(([k, v]) =>
                    v ? <Text key={k} style={styles.field}><Text style={styles.fieldKey}>{t("automation.log.field", { name: k ?? "" })}</Text>{v}</Text> : null)}
                </View>
              ) : null}
            </View>
          );
        })}
        {!entries.length ? (
          <Empty title={t("automation.log.noneTitle")} hint={t("automation.log.noneHint")} />
        ) : null}

        <Card style={{ marginTop: S.lg }}>
          <Row icon="square.and.arrow.up" iconColor="#0A84FF" title={t("automation.log.export")} subtitle={entries.length ? t("automation.log.exportSubCount", { count: entries.length }) : t("automation.log.exportSub")} onPress={exportCsv} />
          <Row icon="trash" iconColor="#FF453A" title={t("automation.log.clear")} subtitle={t("automation.log.clearSub")} onPress={clear} style={styles.divider} destructive />
        </Card>
      </ScrollView>
    </>
  );
}

/** "14:32 · 15 Sep", or the raw stamp if the automation ever writes one this cannot read. */
function when(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} · ${dayMonth(d.getDate(), d.getMonth() + 1)}`;
}

const styles = themed(() => StyleSheet.create({
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
}));
