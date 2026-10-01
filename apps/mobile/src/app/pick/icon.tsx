import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { ICON_CATALOG, ICON_GROUPS, searchIcons, type CatalogIcon } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { C, S } from "@/constants/theme";

const COLS = 6;

/** A heading, or one row of up to six symbols. The list is built out of these so a grid can have headings. */
type Line = { kind: "head"; title: string } | { kind: "row"; icons: CatalogIcon[] };

/** Chop a group's icons into rows of `COLS`. */
function rows(icons: CatalogIcon[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < icons.length; i += COLS) out.push({ kind: "row", icons: icons.slice(i, i + COLS) });
  return out;
}

/**
 * Icon picker as a half sheet: a search field over a 6-per-row grid of the ~240-symbol catalogue.
 * "Automatic" is a full-width row above it and resolves `null` (back to the name-matched icon).
 * Tapping a symbol resolves it and closes.
 *
 * Browsing and searching want different shapes, so the list is built from `Line`s rather than
 * handed to `numColumns` (which cannot put a heading between rows). Idle, the catalogue is shown
 * under its group headings — 240 icons in one undifferentiated wall is not something anyone reads.
 * Searching drops the headings: the results are ranked across every group, and a heading would
 * imply an order the ranking does not have.
 */
export default function PickIcon() {
  const { key, selected, color } = useLocalSearchParams<{ key: string; selected?: string; color?: string }>();
  const [q, setQ] = useState("");
  const tint = color || "#8E8E93";
  const ql = q.trim();
  const lines = useMemo<Line[]>(() => {
    if (ql) return rows(searchIcons(ql));
    const out: Line[] = [];
    for (const group of ICON_GROUPS) {
      const icons = ICON_CATALOG.filter((i) => i.group === group);
      if (!icons.length) continue;
      out.push({ kind: "head", title: group });
      out.push(...rows(icons));
    }
    return out;
  }, [ql]);
  const choose = (name: string | null) => { resolvePick(key, name); router.back(); };
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bgGrouped }}
      data={lines}
      keyExtractor={(l, i) => (l.kind === "head" ? `h${l.title}` : `r${i}`)}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 60 }}
      ListHeaderComponent={
        <View>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search icons" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" accessibilityLabel="Search icons" />
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
      ListEmptyComponent={ql ? <Text style={styles.none}>No icon for “{ql}”.</Text> : null}
      renderItem={({ item }) => {
        if (item.kind === "head") return <Text style={styles.group}>{item.title}</Text>;
        return (
          <View style={styles.row}>
            {item.icons.map((icon) => {
              const on = selected === icon.name;
              return (
                <Pressable key={icon.name} onPress={() => choose(icon.name)} style={[styles.cell, on && { borderColor: tint, backgroundColor: tint + "1F" }]}
                  accessibilityRole="button" accessibilityLabel={`${icon.group}: ${icon.keywords.split(" ")[0]}`} accessibilityState={{ selected: on }}>
                  <SymbolView name={icon.name as SFSymbol} size={22} tintColor={on ? tint : C.secondary} />
                </Pressable>
              );
            })}
            {/* Keeps the last row of a group left-aligned instead of spreading four icons across six slots. */}
            {Array.from({ length: COLS - item.icons.length }, (_, i) => <View key={`pad${i}`} style={[styles.cell, styles.pad]} pointerEvents="none" />)}
          </View>
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
  group: { fontSize: 13, fontWeight: "600", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4, marginTop: S.sm, marginBottom: S.xs },
  row: { flexDirection: "row", gap: S.sm },
  cell: { flex: 1, aspectRatio: 1, maxWidth: 48, minHeight: 48, borderRadius: 12, backgroundColor: C.card, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent", marginBottom: S.sm },
  pad: { backgroundColor: "transparent", borderColor: "transparent" },
  none: { color: C.tertiary, fontSize: 15, textAlign: "center", paddingVertical: S.xl },
});
