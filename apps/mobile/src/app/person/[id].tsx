import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { createTransaction, formatMinor, getRow, letItGo, listRows, personBalances, personHistory, remove, save, type PersonLine } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Empty, Money, SectionHeader, Tap } from "@/components/ui";
import { PersonAvatar } from "@/components/PersonAvatar";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, localIso } from "@/lib/dates";
import { t } from "@/i18n";

/**
 * A friend: what they owe, and every share and repayment that made it so (core/people.ts).
 *
 * The balance is per currency and never added across them. Paid back logs the money arriving, on
 * the account their shares were paid from — it is a row of theirs, so it is not your income.
 * Remind hands the share sheet a message listing what is still unpaid, newest first, which is what
 * a repayment has not reached yet. Let it go makes what is left your own spending.
 */
export default function PersonPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useQuery((db) => {
    const person = getRow(db, "people", id);
    return { person: person && !person.deleted ? person : null, balances: personBalances(db, id), history: personHistory(db, id).reverse() };
  }, [id]);
  const [currency, setCurrency] = useState<string | null>(null);
  const focus = data.balances.find((b) => b.currency === currency) ?? data.balances[0] ?? null;
  const keys = useMemo(() => ({ repaid: newPickKey("repaid"), name: newPickKey("pname") }), []);
  const name = data.person?.name ?? "";

  // The account their money goes back to: the one their latest share in that currency was paid from.
  const accountFor = useCallback((cur: string) => {
    const line = data.history.find((l) => l.currency === cur);
    return line?.row.account_id ?? null;
  }, [data.history]);
  usePickResult<number>(keys.repaid, useCallback((minor: number) => {
    if (!focus) return;
    const account = accountFor(focus.currency) ?? mutate((db) => listRows(db, "accounts", "deleted=0 AND archived=0 AND currency=?", [focus.currency])[0]?.id ?? null);
    if (!account) { Alert.alert(t("people.page.noAccount")); return; }
    mutate((db) => createTransaction(db, { account_id: account, date: localIso(), amount_minor: Math.abs(minor), payee: name, person_id: id }));
  }, [focus, accountFor, name, id]));
  usePickResult<string>(keys.name, useCallback((v: string) => {
    const p = data.person;
    if (p && v && v !== p.name) mutate((db) => save(db, "people", { ...p, name: v }));
  }, [data.person]));

  if (!data.person) return <Empty title={t("people.page.settled")} />;
  const person = data.person;

  const paidBack = () => focus && router.push({ pathname: "/pick/amount", params: {
    key: keys.repaid, title: t("people.page.paidBackTitle", { name }), currency: focus.currency, value: String(Math.max(focus.owed_minor, 0)),
  } });
  const remind = () => {
    if (!focus || focus.owed_minor <= 0) return;
    // What is unpaid is the newest shares: repayments cover the oldest first.
    const lines: string[] = [];
    let left = focus.owed_minor;
    for (const l of data.history) {
      if (left <= 0) break;
      if (l.currency !== focus.currency || l.kind !== "share") continue;
      const amount = Math.min(-l.row.amount_minor, left);
      left -= amount;
      lines.push(t("people.page.remindLine", { what: whatFor(l), date: humanDayTime(l.row.date.slice(0, 10)), amount: `${formatMinor(amount, l.currency)} ${l.currency}` }));
    }
    void Share.share({ message: t("people.page.remindText", { name, amount: `${formatMinor(focus.owed_minor, focus.currency)} ${focus.currency}`, lines: lines.join("\n") }) });
  };
  const letGo = () => focus && focus.owed_minor > 0 && Alert.alert(t("people.page.letGoTitle"),
    t("people.page.letGoBody", { name, amount: `${formatMinor(focus.owed_minor, focus.currency)} ${focus.currency}` }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("people.page.letGoAction"), onPress: () => mutate((db) => letItGo(db, id, focus.currency)) },
    ]);
  const rename = () => router.push({ pathname: "/pick/text", params: { key: keys.name, title: t("people.page.renameTitle"), value: name } });
  const del = () => Alert.alert(t("people.page.removeTitle", { name }), t("people.page.removeBody"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((db) => remove(db, "people", id)); router.back(); } },
  ]);
  const owes = !!focus && focus.owed_minor > 0;

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <PersonAvatar person={person} size={64} />
          {data.balances.length ? data.balances.map((b) => (
            <Tap key={b.currency} onPress={() => setCurrency(b.currency)} disabled={data.balances.length < 2} style={[styles.balance, data.balances.length > 1 && focus?.currency === b.currency && styles.balanceOn]}
              accessibilityRole={data.balances.length > 1 ? "button" : undefined}>
              <Text style={styles.balanceLabel}>{b.owed_minor > 0 ? t("people.page.owesYou") : t("people.page.youOwe")}</Text>
              <Money minor={Math.abs(b.owed_minor)} currency={b.currency} style={[styles.balanceMoney, b.owed_minor < 0 && { color: C.red }]} />
            </Tap>
          )) : <Text style={styles.balanceLabel}>{t("people.page.settled")}</Text>}
        </View>

        {owes ? (
          <View style={styles.actions}>
            <Action icon="arrow.down.circle.fill" label={t("people.page.paidBack")} onPress={paidBack} />
            <Action icon="square.and.arrow.up" label={t("people.page.remind")} onPress={remind} />
            <Action icon="hand.raised.fill" label={t("people.page.letGo")} onPress={letGo} />
          </View>
        ) : null}

        {data.history.length ? <SectionHeader>{t("people.page.history")}</SectionHeader> : null}
        {data.history.length ? (
          <Card>
            {data.history.map((l, i) => (
              <View key={l.row.id} style={[styles.line, i > 0 && styles.divider]}>
                <View style={styles.lineText}>
                  <Text style={styles.lineTitle} numberOfLines={2}>{whatFor(l)}</Text>
                  <Text style={styles.lineSub} numberOfLines={3}>
                    {[humanDayTime(l.row.date.slice(0, 10)), l.items.length ? l.items.map((it) => it.name).join(", ") : null].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                <View style={styles.lineRight}>
                  <Money minor={-l.row.amount_minor} currency={l.currency} style={[styles.lineMoney, l.kind === "repaid" && { color: C.green }]} />
                  <Text style={styles.after}>{t("people.page.after", { amount: `${formatMinor(l.balance_minor, l.currency)} ${l.currency}` })}</Text>
                </View>
              </View>
            ))}
          </Card>
        ) : null}

        <Card style={{ marginTop: S.lg }}>
          <Tap onPress={rename} style={styles.plain} accessibilityRole="button"><Text style={styles.plainText}>{t("people.page.rename")}</Text></Tap>
          <Tap onPress={del} style={[styles.plain, styles.divider]} accessibilityRole="button"><Text style={[styles.plainText, { color: C.red }]}>{t("people.page.remove")}</Text></Tap>
        </Card>
      </ScrollView>
    </>
  );
}

/** What a line was: the shop of the purchase a share came from, else the row's own words. */
function whatFor(l: PersonLine): string {
  if (l.kind === "repaid") return t("people.page.repaid");
  return l.purchase?.payee || l.row.payee || l.purchase?.notes?.split("\n")[0] || t("people.page.share");
}

function Action({ icon, label, onPress }: { icon: SFSymbol; label: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={styles.action} accessibilityRole="button" accessibilityLabel={label}>
      <SymbolView name={icon} size={22} tintColor={C.tint} />
      <Text style={styles.actionText} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
    </Tap>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { paddingBottom: S.xl * 2 },
  hero: { alignItems: "center", gap: S.sm, paddingVertical: S.lg },
  balance: { alignItems: "center", paddingHorizontal: S.lg, paddingVertical: S.xs, borderRadius: 14 },
  balanceOn: { backgroundColor: C.fill },
  balanceLabel: { fontSize: 13, color: C.secondary },
  balanceMoney: { fontSize: 34, fontWeight: "700" },
  actions: { flexDirection: "row", gap: S.sm, paddingHorizontal: S.lg, marginBottom: S.md },
  action: { flex: 1, alignItems: "center", gap: 4, paddingVertical: S.md, borderRadius: 14, backgroundColor: C.card, minHeight: 64 },
  actionText: { fontSize: 13, fontWeight: "600", color: C.tint },
  line: { flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  lineText: { flex: 1, gap: 2 },
  lineTitle: { fontSize: 16, color: C.label },
  lineSub: { fontSize: 13, lineHeight: 18, color: C.secondary },
  lineRight: { alignItems: "flex-end", gap: 2 },
  lineMoney: { fontSize: 16, fontWeight: "600" },
  after: { fontSize: 12, color: C.tertiary, fontVariant: ["tabular-nums"] },
  plain: { minHeight: 48, justifyContent: "center" },
  plainText: { fontSize: 17, color: C.tint },
}));
