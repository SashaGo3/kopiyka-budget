import { ScrollView, StyleSheet } from "react-native";
import { Stack } from "expo-router";
import { AppIconPicker, ThemePicker } from "@/components/ThemePicker";
import { SectionHeader } from "@/components/ui";
import { S, themed } from "@/constants/theme";
import { t } from "@/i18n";

// A theme switch re-mounts this screen's content (components/ThemeKeyed.tsx), which would put the
// list back at the top under the finger that just tapped it; the offset is carried across instead.
let lastOffset = 0;

/** Settings → Theme: the app icon on its own row, then Automatic/Light/Dark and the eight palettes, each previewed light and dark. */
export default function ThemeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: t("theme.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}
        contentOffset={lastOffset ? { x: 0, y: lastOffset } : undefined} scrollEventThrottle={64}
        onScroll={(e) => { lastOffset = e.nativeEvent.contentOffset.y; }}>
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
