import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Host, DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, environment, frame, padding } from "@expo/ui/swift-ui/modifiers";
import { resolvePick } from "@/store/pick";
import { BigButton, Chip, Segmented } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getLocale, t } from "@/i18n";

/** Calendar is expanded from the start; tapping a day picks it immediately. */
export default function PickDate() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const [day, setDay] = useState(selected ?? todayLocal());
  const insets = useSafeAreaInsets();
  const pick = (d: string) => { resolvePick(key, d); router.back(); };
  const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return todayLocal(d); };
  // The last five years one tap away (the calendar's own year wheel is two taps and a spin), plus the
  // chosen day's year when it is older. A year moves the calendar there, the same day where it exists.
  const thisYear = new Date().getFullYear();
  const shownYear = Number(day.slice(0, 4));
  const years = [...new Set([...Array.from({ length: 5 }, (_, i) => thisYear - 4 + i), shownYear])].sort((a, b) => a - b);
  const toYear = (y: number) => { const d = new Date(y, Number(day.slice(5, 7)) - 1, 1); d.setDate(Math.min(Number(day.slice(8, 10)), new Date(y, d.getMonth() + 1, 0).getDate())); setDay(todayLocal(d)); };
  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.md, paddingBottom: Math.max(insets.bottom, S.md), gap: S.md }}>
      <View style={styles.chips}>
        <Chip label={t("common.today")} active={day === todayLocal()} onPress={() => pick(todayLocal())} />
        <Chip label={t("common.yesterday")} active={day === yesterday()} onPress={() => pick(yesterday())} />
      </View>
      <View style={styles.years}>
        <Segmented value={String(shownYear)} options={years.map((y) => ({ value: String(y), label: String(y) }))} onChange={(v) => toYear(Number(v))} />
      </View>
      {/* Height from SwiftUI, width from the sheet: the calendar fills the card instead of hugging the left edge.
          Its inset is SwiftUI's `padding`: a Host's own RN padding does not reach the SwiftUI content. */}
      <Host matchContents={{ vertical: true }} style={styles.host}>
        <DatePicker selection={new Date(day + "T12:00:00")} displayedComponents={["date"]} modifiers={[datePickerStyle("graphical"), environment("locale", getLocale()), frame({ maxWidth: 10000, alignment: "center" }), padding({ leading: S.md, trailing: S.md })]}
          onDateChange={(d) => { const v = todayLocal(d); setDay(v); if (v !== day) pick(v); }} />
      </Host>
      <BigButton label={t("pick.date.use")} onPress={() => pick(day)} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  host: { marginHorizontal: S.md, backgroundColor: C.card, borderRadius: R.card },
  chips: { flexDirection: "row", gap: S.sm, paddingHorizontal: S.md },
  years: { paddingHorizontal: S.md },
}));
