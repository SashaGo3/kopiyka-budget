import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { THEMES, THEME_IDS, type ThemeId, type ThemeSide } from "@kopiyka/core";
import { Card, Segmented } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { getTheme, switchAppearance, switchTheme, useAppearance, type AppearanceChoice, type TapPoint, type ThemePickerRoute } from "@/lib/theme";
import { t } from "@/i18n";

/** A theme's name in the app's language: brand names stay as they are, the app's own is translated. */
export function themeName(id: ThemeId): string {
  return t(`theme.name.${id}`);
}

/** What the appearance setting is called in a line of text: "" is the phone's. */
export function appearanceName(a: AppearanceChoice): string {
  return t(`theme.appearance.${a || "auto"}`);
}

/** Automatic / Light / Dark: whether the theme follows the phone or stays on one side. */
export function AppearancePicker() {
  const appearance = useAppearance();
  const options: { value: AppearanceChoice; label: string }[] = [
    { value: "", label: appearanceName("") },
    { value: "light", label: appearanceName("light") },
    { value: "dark", label: appearanceName("dark") },
  ];
  // Segmented reports only the value; the touch that led to it says where to reveal from.
  const touch = useRef<TapPoint | undefined>(undefined);
  return (
    <View style={styles.appearance} onTouchStart={(e) => { touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY }; }}>
      <Segmented value={appearance} options={options} onChange={(v) => { void Haptics.selectionAsync(); void switchAppearance(v, touch.current); }} />
    </View>
  );
}

/**
 * A screen in miniature, drawn from one side of a palette as plain colours — not through `C`, which
 * only ever holds the current theme and follows the phone's appearance: here both sides of every
 * theme are on screen at once.
 */
function Preview({ side, label }: { side: ThemeSide; label: string }) {
  return (
    <View style={[tile.screen, { backgroundColor: side.bg, borderColor: side.border }]} accessibilityLabel={label}>
      <View style={[tile.card, { backgroundColor: side.card }]}>
        <View style={[tile.line, { width: "72%", height: 4, backgroundColor: side.text }]} />
        <View style={[tile.line, { width: "48%", backgroundColor: side.muted }]} />
        <View style={tile.pills}>
          <View style={[tile.pill, { backgroundColor: side.red }]} />
          <View style={[tile.pill, { backgroundColor: side.green }]} />
        </View>
      </View>
      <View style={[tile.button, { backgroundColor: side.accent }]}>
        <View style={[tile.line, { width: "44%", backgroundColor: side.onAccent }]} />
      </View>
    </View>
  );
}

/**
 * Every theme with a light and a dark preview of it; a tap applies it at once. The old screen fades
 * off the app re-mounted in the new colours and already back on `from` (src/lib/theme.ts), and then
 * the app icon follows — iOS says so itself, with an alert of its own.
 */
export function ThemePicker({ from }: { from: ThemePickerRoute }) {
  // Ticked at once, so the tap is answered before the tree re-mounts in the new colours.
  const [picked, setPicked] = useState(getTheme);
  const pick = (id: ThemeId, at: TapPoint) => {
    if (id === picked) return;
    setPicked(id);
    void Haptics.selectionAsync();
    void switchTheme(id, from, at).catch(() => setPicked(getTheme()));
  };
  return (
    <>
    <AppearancePicker />
    <Card>
      {THEME_IDS.map((id, i) => {
        const theme = THEMES[id];
        const on = id === picked;
        return (
          <Pressable key={id} onPress={(e) => pick(id, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={themeName(id)}
            style={({ pressed }) => [styles.row, i > 0 && styles.divider, pressed && { backgroundColor: C.fill }]}>
            <View style={styles.previews} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Preview side={theme.light} label={t("theme.light")} />
              <Preview side={theme.dark} label={t("theme.dark")} />
            </View>
            <Text style={[styles.name, on && styles.nameOn]} numberOfLines={1}>{themeName(id)}</Text>
            {on ? <SymbolView name="checkmark" size={17} weight="semibold" tintColor={C.tint} /> : null}
          </Pressable>
        );
      })}
    </Card>
    </>
  );
}

const tile = StyleSheet.create({
  screen: { width: 54, height: 80, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 5, justifyContent: "space-between", overflow: "hidden" },
  card: { borderRadius: 5, padding: 5, gap: 4 },
  line: { height: 3, borderRadius: 2 },
  pills: { flexDirection: "row", gap: 3, marginTop: 1 },
  pill: { width: 14, height: 6, borderRadius: 3 },
  button: { height: 13, borderRadius: 7, alignItems: "center", justifyContent: "center" },
});

const styles = themed(() => StyleSheet.create({
  appearance: { paddingHorizontal: S.lg, marginBottom: S.md },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  previews: { flexDirection: "row", gap: S.sm },
  name: { flex: 1, fontSize: 17, color: C.label },
  nameOn: { fontWeight: "600" },
}));
