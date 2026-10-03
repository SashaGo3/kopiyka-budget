import { ScrollView, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { AppIconPicker, ThemePicker } from "@/components/ThemePicker";
import { SectionHeader } from "@/components/ui";
import { S, themed } from "@/constants/theme";
import { t } from "@/i18n";
import { useKeptScroll } from "@/lib/keptScroll";

/** Settings → Theme: the app icon on its own row, then Automatic/Light/Dark and the eight palettes, each previewed light and dark. */
export default function ThemeScreen() {
  // A theme switch re-mounts this content; the list comes back where it was (lib/keptScroll.ts).
  const kept = useKeptScroll("settings.theme");
  return (
    <>
      <Stack.Screen options={{ title: t("theme.title") }} />
      <ScrollView {...kept} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <SectionHeader>{t("theme.icon.title")}</SectionHeader>
        <AppIconPicker />
        <SectionHeader>{t("theme.title")}</SectionHeader>
        <ThemePicker />
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { paddingTop: S.lg, paddingBottom: 60 },
}));
