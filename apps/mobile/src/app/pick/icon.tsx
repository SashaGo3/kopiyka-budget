import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { ICON_CATALOG } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { C, S } from "@/constants/theme";

const COLS = 6;

/**
 * Icon picker as a half sheet: a search field filters the ~120-symbol catalogue by name
 * or keyword, shown as a 6-per-row grid. "Automatic" is a full-width row above the grid
 * and resolves `null` (back to the name-matched icon). Tapping a symbol resolves it and closes.
 */
export default function PickIcon() {
  const { key, selected, color } = useLocalSearchParams<{ key: string; selected?: string; color?: string }>();
  const [q, setQ] = useState("");
  const tint = color || "#8E8E93";
  const ql = q.trim().toLowerCase();
  const items = useMemo(() => (ql ? ICON_CATALOG.filter((i) => i.name.toLowerCase().includes(ql) || i.keywords.toLowerCase().includes(ql)) : ICON_CATALOG), [ql]);
  const choose = (name: string | null) => { resolvePick(key, name); router.back(); };
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bgGrouped }}
      data={items}
      keyExtractor={(i) => i.name}
      numColumns={COLS}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 60 }}
      columnWrapperStyle={{ gap: S.sm }}
      ListHeaderComponent={
        <View>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search icons" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search icons" />
          </View>
          {!ql ? (
            <Pressable onPress={() => choose(null)} style={styles.autoRow} accessibilityRole="button" accessibilityLabel="Automatic">
              <View style={styles.autoIcon}><SymbolView name="wand.and.stars" size={16} tintColor={C.tertiary} /></View>
              <Text style={styles.autoText}>Automatic</Text>
              {!selected ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : null}
            </Pressable>
          ) : null}
        </View>
      }
      renderItem={({ item }) => {
        const on = selected === item.name;
        return (
          <Pressable onPress={() => choose(item.name)} style={[styles.cell, on && { borderColor: tint, backgroundColor: tint + "1F" }]} accessibilityRole="button" accessibilityLabel={`Icon ${item.name}`} accessibilityState={{ selected: on }}>
            <SymbolView name={item.name as SFSymbol} size={22} tintColor={on ? tint : C.secondary} />
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: S.lg, marginBottom: S.md, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  autoRow: { flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 44, marginBottom: S.sm },
  autoIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  autoText: { flex: 1, fontSize: 17, color: C.label },
  cell: { flex: 1, aspectRatio: 1, maxWidth: 48, minHeight: 48, borderRadius: 12, backgroundColor: C.card, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent", marginBottom: S.sm },
});
