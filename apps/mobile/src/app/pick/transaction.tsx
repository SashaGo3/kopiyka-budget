import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { resolvePick } from "@/store/pick";
import { useTransactions } from "@/components/TransactionList";
import { AmountPill, CategoryIcon } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime } from "@/lib/dates";

/** Search past transactions and pick one (as a template for a rule or an insight). Resolves the transaction id. */
export default function PickTransaction() {
  const { key, title } = useLocalSearchParams<{ key: string; title?: string }>();
  const [q, setQ] = useState("");
  const like = `%${q.trim()}%`;
  const rows = useTransactions(q.trim() ? "t.transfer_id IS NULL AND (t.notes LIKE ? OR t.payee LIKE ? OR c.name LIKE ? OR p.name LIKE ?)" : "t.transfer_id IS NULL", q.trim() ? [like, like, like, like] : [], 300);
  return (
    <FlatList style={{ flex: 1, backgroundColor: C.bgGrouped }} data={rows} keyExtractor={(t) => t.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 60 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>{title ?? "Choose a transaction"}</Text>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search notes, categories" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search transactions" />
          </View>
        </View>
      }
      renderItem={({ item: t }) => {
        const name = t.notes?.split("\n")[0] || t.payee || t.category_name || t.parent_name || "Uncategorized";
        return (
          <Pressable onPress={() => { resolvePick(key, t.id); router.back(); }} style={styles.row} accessibilityRole="button" accessibilityLabel={`${name}, ${t.amount_minor / 100} ${t.currency}, ${humanDayTime(t.date.slice(0, 10))}`}>
            <CategoryIcon name={t.category_name ?? t.parent_name ?? "?"} icon={t.cat_icon ?? t.parent_icon} color={t.cat_color ?? t.parent_color} size={30} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{humanDayTime(t.date.slice(0, 10))} · {t.account_name}{t.category_name ? ` · ${t.category_name}` : ""}</Text>
            </View>
            <AmountPill minor={t.amount_minor} currency={t.currency} />
          </Pressable>
        );
      }}
      ListEmptyComponent={<Text style={styles.empty}>Nothing matches.</Text>} />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingTop: S.md },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, marginBottom: S.xs, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 56, paddingVertical: 6 },
  name: { fontSize: 16, color: C.label },
  sub: { fontSize: 12, color: C.secondary },
  empty: { color: C.tertiary, textAlign: "center", padding: S.xl },
});
