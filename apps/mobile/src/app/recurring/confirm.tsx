import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { advanceRule, dueOccurrences, getRow, postOccurrence } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { BigButton, Money, Subtle, Title } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Opened from a notification or the recurring list: post the due occurrence(s). */
export default function RecurringConfirm() {
  const { id, occurrence } = useLocalSearchParams<{ id: string; occurrence?: string }>();
  const insets = useSafeAreaInsets();
  const data = useQuery((db) => {
    const rule = getRow(db, "recurring_rules", id);
    if (!rule) return null;
    const account = getRow(db, "accounts", rule.account_id);
    const cat = rule.category_id ? getRow(db, "categories", rule.category_id) : undefined;
    const due = dueOccurrences(rule, occurrence && occurrence > todayLocal() ? occurrence : todayLocal());
    return { rule, account, cat, due };
  }, [id, occurrence]);
  if (!data) return null;
  const { rule, account, cat, due } = data;
  const title = rule.payee || cat?.name || "Recurring transaction";

  const post = (days: string[]) => {
    mutate((db) => {
      for (const day of days) postOccurrence(db, rule, day);
      advanceRule(db, rule, days[days.length - 1]!);
    });
    router.back();
  };
  const skip = () => { mutate((db) => advanceRule(db, rule, (due.length ? due : [rule.next_date]).at(-1)!)); router.back(); };

  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.xl, paddingBottom: Math.max(insets.bottom, S.md) }}>
      <View style={styles.top}>
        <Title>{title}</Title>
        <Money minor={rule.amount_minor} currency={account?.currency ?? ""} style={styles.amount} colored />
        <Subtle>{account?.name} · {due.length > 1 ? `${due.length} occurrences due (${humanDayTime(due[0]!)} → ${humanDayTime(due[due.length - 1]!)})` : `due ${humanDayTime(due[0] ?? rule.next_date, rule.time_of_day)}`}</Subtle>
      </View>
      <View style={{ gap: S.sm }}>
        <BigButton label={due.length > 1 ? `Post all ${due.length}` : "Post transaction"} onPress={() => post(due.length ? due : [rule.next_date])} />
        {due.length > 1 ? <BigButton label="Post only the latest" onPress={() => post([due[due.length - 1]!])} /> : null}
        <BigButton label="Skip" destructive onPress={skip} />
        <Text style={styles.hint}>Skipping moves the next date forward without adding a transaction.</Text>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingBottom: S.xl, gap: 6 },
  amount: { fontSize: 40, fontWeight: "700" },
  hint: { color: C.tertiary, fontSize: 13, textAlign: "center", paddingHorizontal: S.xl },
});
