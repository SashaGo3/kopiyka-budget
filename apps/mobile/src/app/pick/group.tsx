import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { DEFAULT_ACCOUNT_GROUP, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { Row } from "@/components/ui";
import { C, S } from "@/constants/theme";

/**
 * Group picker: lists groups already in use, with how many accounts are in each, and can create a
 * new one inline. There is no "no group" — every account belongs to one — so the default group is
 * always offered, even before any account has joined it.
 */
export default function PickGroup() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const [q, setQ] = useState("");
  const groups = useQuery((db) => {
    const counts = new Map<string, number>();
    counts.set(DEFAULT_ACCOUNT_GROUP, 0);
    for (const a of listRows(db, "accounts", "deleted=0")) if (a.group_name) counts.set(a.group_name, (counts.get(a.group_name) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  });
  const query = q.trim().toLowerCase();
  const filtered = query ? groups.filter((g) => g.name.toLowerCase().includes(query)) : groups;
  const canCreate = !!query && !groups.some((g) => g.name.toLowerCase() === query);
  const pick = (value: string) => { resolvePick(key, value); router.back(); };

  return (
    <FlatList style={{ backgroundColor: C.bgGrouped }} data={filtered} keyExtractor={(g) => g.name} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingTop: S.sm, paddingBottom: 40 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>Group</Text>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search or create a group" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} accessibilityLabel="Search groups" />
          </View>
          {canCreate ? (
            <Pressable onPress={() => pick(q.trim())} style={styles.row} accessibilityRole="button">
              <SymbolView name="plus.circle" size={20} tintColor={C.tint} />
              <Text style={[styles.rowText, { color: C.tint }]}>Create “{q.trim()}”</Text>
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item: g }) => (
        <Row title={g.name} subtitle={g.count ? `${g.count} account${g.count === 1 ? "" : "s"}` : "Empty"} style={styles.transparent} onPress={() => pick(g.name)}
          right={selected === g.name ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : <SymbolView name="circle" size={1} tintColor="transparent" />} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingVertical: S.md },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginBottom: S.xs, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 48 },
  rowText: { flex: 1, fontSize: 17, color: C.label },
  transparent: { backgroundColor: "transparent" },
});
