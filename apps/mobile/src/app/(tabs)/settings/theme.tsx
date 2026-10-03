import { ScrollView, StyleSheet, Text } from "react-native";
import { Stack } from "expo-router";
import { AppIconPicker, ThemePicker } from "@/components/ThemePicker";
import { SectionHeader } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/** Settings → Theme: the app icon on its own row, then Automatic/Light/Dark and the eight palettes, each previewed light and dark. */
export default function ThemeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t("theme.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <SectionHeader>{t("theme.icon.title")}</SectionHeader>
        <AppIconPicker />
        <SectionHeader>{t("theme.title")}</SectionHeader>
        <ThemePicker from="/settings/theme" />
        <Text style={styles.foot}>{t("theme.footer")}</Text>
        <Text style={styles.foot}>{t("theme.credits")}</Text>
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { paddingTop: S.lg, paddingBottom: 60 },
  foot: { color: C.tertiary, fontSize: 13, lineHeight: 18, paddingHorizontal: S.xl, marginTop: S.md },
}));
