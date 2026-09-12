import { FlatList, StyleSheet, Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { resolvePick } from "@/store/pick";
import { CategoryIcon, Row } from "@/components/ui";
import { C, S } from "@/constants/theme";

export interface Option {
  value: string; label: string; subtitle?: string;
  /** Nested under the row above (e.g. an account inside its group). */ indent?: boolean;
  /** Drawn as a category tile on the left, so a list of folders looks like the folders do elsewhere. */
  icon?: string | null; color?: string | null;
}

/** Generic single-choice sheet: `options` is a JSON array of { value, label, subtitle? }. */
export default function PickOption() {
  const { key, title, options, selected } = useLocalSearchParams<{ key: string; title?: string; options: string; selected?: string }>();
  let list: Option[] = [];
  try { list = JSON.parse(options ?? "[]"); } catch { list = []; }
  return (
    <FlatList style={{ backgroundColor: C.bgGrouped }} data={list} keyExtractor={(o) => o.value} contentContainerStyle={{ paddingTop: S.sm, paddingBottom: 40 }}
      ListHeaderComponent={<Text style={styles.title}>{title ?? "Choose"}</Text>}
      renderItem={({ item: o }) => (
        <Row title={o.label} subtitle={o.subtitle} style={[{ backgroundColor: "transparent" }, o.indent && styles.indent]} onPress={() => { resolvePick(key, o.value); router.back(); }}
          left={o.icon !== undefined || o.color !== undefined ? <CategoryIcon name={o.label} icon={o.icon} color={o.color} size={28} /> : undefined}
          right={selected === o.value ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : <SymbolView name="circle" size={1} tintColor="transparent" />} />
      )} />
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "600", color: C.label, textAlign: "center", paddingVertical: S.md },
  indent: { paddingLeft: S.lg + S.xl },
});
