import { useEffect, useRef } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, type ColorValue } from "react-native";
import { Stack, router, useIsFocused } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { advanceRule, dueManualRules, listRows, postOccurrence, ruleWaitDays, waitingRules, type DueRule } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { BarButton, BottomBar } from "@/components/BottomBar";
import { AmountPill, CategoryIcon, Empty, Money } from "@/components/ui";
import { C, R, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { waitDefaultDays } from "@/lib/settings";
import { freqLabel } from "@/app/(tabs)/settings/recurring";

/**
 * The queue behind the "Recurring due" row on Transactions: manual rules whose date has passed.
 * Automatic rules never reach here — they are already real transactions by the time you look.
 *
 * A rule that waits for the bank only reaches this queue once its window has closed with no charge
 * to claim the occurrence — inside the window there is nothing to decide yet.
 *
 * Two taps decide an occurrence: Post writes the transaction, Skip moves the rule on without one
 * (the month you paid in cash, or the subscription you cancelled). Both act on *every* occurrence
 * the rule owes, which for the normal once-a-month case is exactly one. A rule that has fallen
 * several periods behind says so, and tapping the row opens the existing confirm sheet, where
 * "Post only the latest" can settle the backlog without inventing months of history.
 *
 * Emptying the queue closes the screen, like Pending: the row that led here is gone too.
 */
export default function RecurringDueScreen() {
  const today = useQuery(() => todayLocal());
  const { rows, waiting } = useQuery((db) => {
    const accounts = new Map(listRows(db, "accounts", "1=1").map((a) => [a.id, a]));
    const cats = new Map(listRows(db, "categories", "1=1").map((c) => [c.id, c]));
    const waitDefault = waitDefaultDays();
    const dress = (d: DueRule) => ({
      ...d, account: accounts.get(d.rule.account_id), category: d.rule.category_id ? cats.get(d.rule.category_id) : undefined,
      wait: ruleWaitDays(d.rule, waitDefault),
    });
    return {
      rows: dueManualRules(db, today, waitDefault).map(dress),
      waiting: waitingRules(db, today, waitDefault).map(dress),
    };
  }, [today]);
  const focused = useIsFocused();
  const had = useRef(false);
  useEffect(() => {
    if (rows.length || waiting.length) { had.current = true; return; }
    if (had.current && focused && router.canGoBack()) router.back();
  }, [rows.length, waiting.length, focused]);

  const post = (list: typeof rows) => mutate((db) => {
    for (const { rule, days } of list) {
      for (const day of days) postOccurrence(db, rule, day);
      advanceRule(db, rule, days[days.length - 1]!);
    }
  });
  const skip = (d: DueRule) => {
    const title = d.rule.payee || "this payment";
    Alert.alert(d.days.length > 1 ? `Skip ${d.days.length} occurrences?` : "Skip this one?",
      `No transaction is added for ${title}; the rule moves on to its next date.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Skip", style: "destructive", onPress: () => mutate((db) => advanceRule(db, d.rule, d.days[d.days.length - 1]!)) },
    ]);
  };

  // Only meaningful when everything owed is in one currency; mixing them into one number would be a lie.
  // Shown unsigned: "waiting on you — −100.00 PLN" reads like a typo mid-sentence.
  const currencies = new Set([...rows, ...waiting].map((r) => r.account?.currency).filter(Boolean));
  const base = currencies.size === 1 ? [...currencies][0]! : "";
  const total = base ? rows.reduce((a, r) => a + r.rule.amount_minor * r.days.length, 0) : 0;
  const waitingTotal = base ? waiting.reduce((a, r) => a + r.rule.amount_minor * r.days.length, 0) : 0;

  return (
    <>
      <Stack.Screen options={{ title: "Recurring due", headerLargeTitle: true, headerBackTitle: "Back" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 200 }}>
        {rows.length ? (
          <Text style={styles.intro}>
            {rows.length === 1 ? "One payment is" : `${rows.length} payments are`} waiting on you{total ? <> — <Money minor={Math.abs(total)} currency={base} style={styles.introSum} /></> : null}. Post it once it has actually left your account, or skip it for this time.
          </Text>
        ) : null}
        {rows.length === 0 && waiting.length === 0 ? <Empty title="Nothing due" hint="Manual recurring payments show up here on the day they are due." /> : null}
        {rows.map((d, i) => (
          <DueItem key={d.rule.id} d={d} first={i === 0} last={i === rows.length - 1}
            onPost={() => post([d])} onSkip={() => skip(d)} />
        ))}
        {waiting.length ? (
          <>
            <Text style={styles.sh}>Expected · waiting for the charge</Text>
            <Text style={styles.intro}>
              Nothing has been added for {waiting.length === 1 ? "this one" : "these"} yet{waitingTotal ? <> — <Money minor={Math.abs(waitingTotal)} currency={base} style={styles.introSum} /></> : null}. The payment your bank notifies settles it by itself; if none arrives in time, it comes back here to be posted.
            </Text>
            {waiting.map((d, i) => (
              <WaitingItem key={d.rule.id} d={d} first={i === 0} last={i === waiting.length - 1} />
            ))}
          </>
        ) : null}
      </ScrollView>
      {rows.length > 1 ? (
        <BottomBar>
          <BarButton icon="checkmark.circle" label={`Post all ${rows.length}`} active onPress={() => post(rows)} a11y={`Post all ${rows.length} due payments`} />
        </BottomBar>
      ) : null}
    </>
  );
}

type Row = DueRule & { account?: { name: string; currency: string }; category?: { name: string; icon: string | null; color: string | null }; wait: number };

/**
 * A payment whose day has come while the rule waits for the bank. Deliberately without buttons:
 * there is nothing to decide, and nothing has been written — the row is here so the money you are
 * about to be charged is not invisible until it happens. Tapping opens the usual sheet for the rare
 * case where you know the charge is not coming (paid in cash, cancelled) and want to settle it now.
 */
function WaitingItem({ d, first, last }: { d: Row; first: boolean; last: boolean }) {
  const { rule, days, account, category, wait } = d;
  const title = rule.payee || category?.name || "Recurring";
  const deadline = `${rule.auto_post ? "Posts" : "Comes back here"} if nothing arrives within ${wait === 1 ? "a day" : `${wait} days`}`;
  return (
    <View style={[styles.card, styles.waiting, first && styles.first, last && styles.last, !first && styles.divider]}>
      <Pressable style={styles.head} accessibilityRole="button" accessibilityLabel={`${title}, expected ${humanDayTime(days[0]!)}`} accessibilityHint="Opens the full options"
        onPress={() => router.push({ pathname: "/recurring/confirm", params: { id: rule.id } })}>
        <CategoryIcon name={category?.name ?? title} icon={category?.icon} color={category?.color} size={34} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.sub} numberOfLines={1}>Expected {humanDayTime(days[0]!, rule.time_of_day)}{days.length > 1 ? ` · ${days.length} occurrences` : ""}</Text>
          <Text style={styles.sub} numberOfLines={1}>{deadline}</Text>
        </View>
        <AmountPill minor={rule.amount_minor * days.length} currency={account?.currency ?? ""} neutral />
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
    </View>
  );
}

function DueItem({ d, first, last, onPost, onSkip }: { d: Row; first: boolean; last: boolean; onPost: () => void; onSkip: () => void }) {
  const { rule, days, account, category } = d;
  const title = rule.payee || category?.name || "Recurring";
  const behind = days.length > 1;
  const when = behind
    ? `${days.length} due since ${humanDayTime(days[0]!)}`
    : `Due ${humanDayTime(days[0]!, rule.time_of_day)}`;
  return (
    <View style={[styles.card, first && styles.first, last && styles.last, !first && styles.divider]}>
      <Pressable style={styles.head} accessibilityRole="button" accessibilityLabel={`${title}, ${when}`} accessibilityHint="Opens the full options"
        onPress={() => router.push({ pathname: "/recurring/confirm", params: { id: rule.id } })}>
        <CategoryIcon name={category?.name ?? title} icon={category?.icon} color={category?.color} size={34} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={[styles.sub, behind && { color: C.orange }]} numberOfLines={1}>{when}</Text>
          <Text style={styles.sub} numberOfLines={1}>{freqLabel(rule.frequency, rule.interval)}{account ? ` · ${account.name}` : ""}</Text>
        </View>
        <AmountPill minor={rule.amount_minor * days.length} currency={account?.currency ?? ""} />
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
      <View style={styles.actions}>
        <Action icon="checkmark.circle.fill" label={behind ? `Post all ${days.length}` : "Post"} color={C.green} onPress={onPost} grow />
        <Action icon="forward.end" label="Skip" color={C.orange} onPress={onSkip} grow />
      </View>
    </View>
  );
}

function Action({ icon, label, color, onPress, grow }: { icon: SFSymbol; label: string; color: ColorValue; onPress: () => void; grow?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.action, grow && { flex: 1 }, pressed && { backgroundColor: C.fill }]}>
      <SymbolView name={icon} size={16} tintColor={color} />
      <Text style={[styles.actionText, { color }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { color: C.secondary, fontSize: 14, lineHeight: 20, paddingHorizontal: S.xl, paddingTop: S.sm, paddingBottom: S.md },
  sh: { color: C.secondary, fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: S.xl, paddingTop: S.xl },
  waiting: { opacity: 0.85 },
  introSum: { color: C.label, fontSize: 14, fontWeight: "700" },
  card: { marginHorizontal: S.lg, backgroundColor: C.card, overflow: "hidden" },
  first: { borderTopLeftRadius: R.card, borderTopRightRadius: R.card },
  last: { borderBottomLeftRadius: R.card, borderBottomRightRadius: R.card },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, paddingTop: 10, paddingBottom: 8 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  actions: { flexDirection: "row", alignItems: "stretch", gap: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: S.md },
  actionText: { fontSize: 14, fontWeight: "600" },
});
