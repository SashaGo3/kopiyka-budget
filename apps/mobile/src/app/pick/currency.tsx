import { useMemo, useState } from "react";
import { SectionList, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { Row } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { CURRENCY_LIST, type CurrencyInfo } from "@/lib/currencies";

/** Currency sheet: the ones your accounts already use first, then every supported currency; searchable by code or name. Resolves the ISO code. */
export default function PickCurrency() {
  const { key, selected, title } = useLocalSearchParams<{ key: string; selected?: string; title?: string }>();
  const [q, setQ] = useState("");
  const used = useQuery((db) => [...new Set(listRows(db, "accounts", "deleted=0").map((a) => a.currency))]);
  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const match = (c: CurrencyInfo) => !needle || c.code.toLowerCase().includes(needle) || c.name.toLowerCase().includes(needle) || c.symbol.toLowerCase() === needle;
    const mine = CURRENCY_LIST.filter((c) => used.includes(c.code) && match(c));
    const rest = CURRENCY_LIST.filter((c) => !used.includes(c.code) && match(c));
    const out: { title: string; data: CurrencyInfo[] }[] = [];
    if (mine.length) out.push({ title: "Your accounts", data: mine });
    if (rest.length) out.push({ title: mine.length ? "All currencies" : "Currencies", data: rest });
    return out;
  }, [q, used]);
  const pick = (code: string) => { resolvePick(key, code); router.back(); };
  return (
    <SectionList style={{ backgroundColor: C.bgGrouped }} sections={sections} keyExtractor={(c) => c.code} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" stickySectionHeadersEnabled={false}
      contentContainerStyle={{ paddingBottom: 60 }}
      ListHeaderComponent={
        <View>
          <Text style={styles.title}>{title ?? "Currency"}</Text>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search code or name" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} autoCapitalize="characters" clearButtonMode="while-editing" accessibilityLabel="Search currencies" />
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item: c }) => (
        <Row title={`${c.code} · ${c.name}`} subtitle={c.symbol} style={{ backgroundColor: "transparent" }} onPress={() => pick(c.code)}
          right={selected === c.code ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : <SymbolView name="circle" size={1} tintColor="transparent" />} />
      )}
      ListEmptyComponent={<Text style={styles.empty}>No currency matches “{q}”.</Text>} />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingVertical: S.md },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginBottom: S.sm, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 16, color: C.label },
  section: { fontSize: 13, fontWeight: "600", color: C.secondary, textTransform: "uppercase", paddingHorizontal: S.lg, paddingTop: S.md, paddingBottom: S.xs },
  empty: { color: C.secondary, textAlign: "center", padding: S.xl },
});
