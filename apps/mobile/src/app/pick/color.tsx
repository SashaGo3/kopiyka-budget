import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { COLORS } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

const COLS = 6;

const COLOR_KEYS = ["red", "orange", "amber", "yellow", "lime", "green", "teal", "cyan", "blue", "indigo", "violet", "pink",
  "tealDark", "redDark", "limePastel", "indigoDark", "yellowPastel", "violetDark", "orangePastel", "blueDark", "pinkPastel", "greenDark", "grey", "brown"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];

/** A palette colour's name (core COLORS: "teal dark") in the app's language; anything unknown as it is. */
export function colorLabel(name: string): string {
  const key = name.replace(/ (\w)/g, (_, c: string) => c.toUpperCase());
  return (COLOR_KEYS as readonly string[]).includes(key) ? t(`pick.color.names.${key as ColorKey}`) : name;
}

/**
 * Colour picker as a half sheet: the 24-swatch palette in a 6-per-row grid of 44 pt
 * circles with a checkmark on the selected one. "Automatic" is a full-width row above
 * the grid and resolves `null` (back to the name-matched colour).
 */
export default function PickColor() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const choose = (hex: string | null) => { resolvePick(key, hex); router.back(); };
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bgGrouped }}
      data={COLORS}
      keyExtractor={(c) => c.hex}
      numColumns={COLS}
      contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 60 }}
      columnWrapperStyle={{ gap: S.sm }}
      ListHeaderComponent={
        <Pressable onPress={() => choose(null)} style={styles.autoRow} accessibilityRole="button" accessibilityLabel={t("pick.automatic")}>
          <View style={styles.autoIcon}><SymbolView name="wand.and.stars" size={16} tintColor={C.tertiary} /></View>
          <Text style={styles.autoText}>{t("pick.automatic")}</Text>
          {!selected ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : null}
        </Pressable>
      }
      renderItem={({ item }) => {
        const on = selected === item.hex;
        return (
          <Pressable onPress={() => choose(item.hex)} style={[styles.cell, { backgroundColor: item.hex }, on && styles.cellOn]} accessibilityRole="button" accessibilityLabel={t("pick.color.a11y", { name: colorLabel(item.name) })} accessibilityState={{ selected: on }}>
            {on ? <SymbolView name="checkmark" size={17} weight="bold" tintColor={C.onTint} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  autoRow: { flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 44, marginTop: S.lg, marginBottom: S.lg },
  autoIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  autoText: { flex: 1, fontSize: 17, color: C.label },
  cell: { flex: 1, aspectRatio: 1, maxWidth: 44, minHeight: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 3, borderColor: "transparent", marginBottom: S.sm },
  cellOn: { borderColor: C.label },
}));
