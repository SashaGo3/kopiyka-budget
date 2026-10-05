import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import { THEMES, THEME_IDS, type ThemeId, type ThemeSide } from "@kopiyka/core";
import { Image } from "expo-image";
import { Card, Segmented } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { getAppIcon, setAppIcon } from "@/lib/bridge";
import { getTheme, switchAppearance, switchTheme, useAppearance, type AppearanceChoice, type TapPoint } from "@/lib/theme";
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

// Static requires, one per theme (Metro cannot follow a computed path). Made by `bun run icons:themes`.
const ICON_PREVIEW: Record<ThemeId, number> = {
  graphite: require("@/../assets/icons/preview/graphite.png"),
  solarized: require("@/../assets/icons/preview/solarized.png"),
  catppuccin: require("@/../assets/icons/preview/catppuccin.png"),
  gruvbox: require("@/../assets/icons/preview/gruvbox.png"),
  nord: require("@/../assets/icons/preview/nord.png"),
  tokyonight: require("@/../assets/icons/preview/tokyonight.png"),
  rosepine: require("@/../assets/icons/preview/rosepine.png"),
  github: require("@/../assets/icons/preview/github.png"),
};

/**
 * The home-screen icon, one per theme, chosen on its own: iOS answers every change with an alert,
 * which has no place in the middle of a theme switch. iOS itself remembers which one is set, so
 * nothing is stored here.
 */
export function AppIconPicker() {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => { void getAppIcon().then(setIcon); }, []);
  const pick = (id: ThemeId) => {
    if (id === icon) return;
    void Haptics.selectionAsync();
    const before = icon;
    setIcon(id);
    setAppIcon(id).catch(() => setIcon(before));
  };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.icons}>
      {THEME_IDS.map((id) => {
        const on = id === icon;
        return (
          <Pressable key={id} onPress={() => pick(id)} accessibilityRole="button" accessibilityState={{ selected: on }}
            accessibilityLabel={t("theme.icon.a11y", { name: themeName(id) })} style={styles.iconCell}>
            <View style={[styles.iconRing, on && styles.iconRingOn]}>
              <Image source={ICON_PREVIEW[id]} style={styles.icon} />
            </View>
            <Text style={[styles.iconName, on && styles.nameOn]} numberOfLines={1}>{themeName(id)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
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
 * Every theme with a light and a dark preview of it; a tap applies it at once. The new colours grow
 * over the old screen from the tap, every screen already recoloured where it was (src/lib/theme.ts).
 * The app icon is chosen separately (AppIconPicker).
 */
export function ThemePicker() {
  // Ticked at once, so the tap is answered before the cover goes up.
  const [picked, setPicked] = useState(getTheme);
  const pick = (id: ThemeId, at: TapPoint) => {
    if (id === picked) return;
    setPicked(id);
    void Haptics.selectionAsync();
    void switchTheme(id, at).catch(() => setPicked(getTheme()));
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
  icons: { paddingHorizontal: S.lg, gap: S.md, paddingBottom: S.sm },
  iconCell: { alignItems: "center", width: 68, gap: 6 },
  iconRing: { padding: 3, borderRadius: 19, borderWidth: 2, borderColor: "transparent" },
  iconRingOn: { borderColor: C.tint },
  icon: { width: 56, height: 56, borderRadius: 13 },
  iconName: { fontSize: 12, color: C.secondary },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.lg, paddingVertical: S.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  previews: { flexDirection: "row", gap: S.sm },
  name: { flex: 1, fontSize: 17, color: C.label },
  nameOn: { fontWeight: "600" },
}));
