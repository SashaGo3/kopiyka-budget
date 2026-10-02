import { ScrollView, StyleSheet, Text } from "react-native";
import { Stack } from "expo-router";
import { ThemePicker } from "@/components/ThemePicker";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";

/** Settings → Theme: the eight palettes, each previewed light and dark; a tap applies one. */
export default function ThemeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t("theme.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        <ThemePicker from="/settings/theme" />
        <Text style={styles.foot}>{t("theme.footer")}</Text>
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { paddingTop: S.lg, paddingBottom: 60 },
  foot: { color: C.tertiary, fontSize: 13, lineHeight: 18, paddingHorizontal: S.xl, marginTop: S.md },
}));
