import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatMinor } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { useTransactions } from "@/components/TransactionList";
import { AmountPill, CategoryIcon } from "@/components/ui";
import { useT } from "@/i18n";
import { C, S } from "@/constants/theme";
import { humanDayTime } from "@/lib/dates";

/**
 * Search past transactions and pick one. Resolves the transaction id.
 *
 * Two callers with two shapes. A rule or an insight wants any past entry as a template, and gets the
 * plain list. Booking money that came back (`returnMinor`, in `currency`) is a choice with a
 * consequence, so that mode says what will happen in a line above the search, offers only entries
 * the return can actually fit into — same currency, enough left on them, no transfers — and prints
 * the result on each row: 90.00 → 60.00, before the row is even tapped.
 */
export default function PickTransaction() {
  const t = useT();
  const { key, title, desc, returnMinor, currency } = useLocalSearchParams<{ key: string; title?: string; desc?: string; returnMinor?: string; currency?: string }>();
  const [q, setQ] = useState("");
  const like = `%${q.trim()}%`;
  // A return of `back` minor units needs a row of the opposite sign with at least that much left on
  // it, in the same currency — converting money back would need a rate this screen has no business
  // asking for. SQL does the filtering so a long history never has to be walked in JS.
  const back = Number(returnMinor ?? 0);
  const forReturn = back > 0 && !!currency;
  const conds = ["t.transfer_id IS NULL"];
  const params: (string | number)[] = [];
  if (forReturn) { conds.push("a.currency = ?", "ABS(t.amount_minor) >= ?"); params.push(currency!, back); }
  if (q.trim()) { conds.push("(t.notes LIKE ? OR t.payee LIKE ? OR c.name LIKE ? OR p.name LIKE ?)"); params.push(like, like, like, like); }
  const rows = useTransactions(conds.join(" AND "), params, 300);
  return (
    <FlatList style={{ flex: 1, backgroundColor: C.bgGrouped }} data={rows} keyExtractor={(tx) => tx.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 60 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>{title ?? t("Choose a transaction")}</Text>
          {desc ? <Text style={styles.desc}>{desc}</Text> : null}
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder={t("Search notes, categories")} placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel={t("Search transactions")} />
          </View>
        </View>
      }
      renderItem={({ item: tx }) => {
        const name = tx.notes?.split("\n")[0] || tx.payee || tx.category_name || tx.parent_name || t("Uncategorized");
        // Towards zero, whichever way the row points, exactly as the entry sheet books it.
        const after = forReturn ? tx.amount_minor + (tx.amount_minor < 0 ? back : -back) : null;
        return (
          <Pressable onPress={() => { resolvePick(key, tx.id); router.back(); }} style={styles.row} accessibilityRole="button"
            accessibilityLabel={after !== null
              ? t("{name}, {before} {currency} becomes {after} {currency}, {when}", { name, before: formatMinor(tx.amount_minor, tx.currency), after: formatMinor(after, tx.currency), currency: tx.currency, when: humanDayTime(tx.date.slice(0, 10)) })
              : t("{name}, {amount} {currency}, {when}", { name, amount: formatMinor(tx.amount_minor, tx.currency), currency: tx.currency, when: humanDayTime(tx.date.slice(0, 10)) })}>
            <CategoryIcon name={tx.category_name ?? tx.parent_name ?? "?"} icon={tx.cat_icon ?? tx.parent_icon} color={tx.cat_color ?? tx.parent_color} size={30} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{humanDayTime(tx.date.slice(0, 10))} · {tx.account_name}{tx.category_name ? ` · ${tx.category_name}` : ""}</Text>
            </View>
            {after !== null ? (
              <View style={styles.change}>
                <Text style={styles.before} numberOfLines={1}>{formatMinor(tx.amount_minor, tx.currency)}</Text>
                <SymbolView name="arrow.right" size={11} tintColor={C.tertiary} />
                <Text style={styles.after} numberOfLines={1}>{formatMinor(after, tx.currency)}</Text>
              </View>
            ) : <AmountPill minor={tx.amount_minor} currency={tx.currency} />}
          </Pressable>
        );
      }}
      ListEmptyComponent={<Text style={styles.empty}>{forReturn ? t("Nothing here is big enough to take this back. Try a smaller amount.") : t("Nothing matches.")}</Text>} />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingTop: S.md },
  desc: { fontSize: 14, color: C.secondary, textAlign: "center", paddingHorizontal: S.xl, paddingTop: S.xs, lineHeight: 19 },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, marginBottom: S.xs, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 56, paddingVertical: 6 },
  name: { fontSize: 16, color: C.label },
  sub: { fontSize: 12, color: C.secondary },
  change: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 0 },
  before: { fontSize: 13, color: C.tertiary, fontVariant: ["tabular-nums"], textDecorationLine: "line-through" },
  after: { fontSize: 15, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
  empty: { color: C.tertiary, textAlign: "center", padding: S.xl },
});
