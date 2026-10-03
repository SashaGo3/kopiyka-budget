import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Host, DatePicker } from "@expo/ui/swift-ui";
import { datePickerStyle, environment } from "@expo/ui/swift-ui/modifiers";
import { resolvePick } from "@/store/pick";
import { BigButton, Chip } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
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
  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.md, paddingBottom: Math.max(insets.bottom, S.md), gap: S.md }}>
      <View style={styles.chips}>
        <Chip label={t("common.today")} active={day === todayLocal()} onPress={() => pick(todayLocal())} />
        <Chip label={t("common.yesterday")} active={day === yesterday()} onPress={() => pick(yesterday())} />
      </View>
      <Host matchContents style={styles.host}>
        <DatePicker selection={new Date(day + "T12:00:00")} displayedComponents={["date"]} modifiers={[datePickerStyle("graphical"), environment("locale", getLocale())]}
          onDateChange={(d) => { const v = todayLocal(d); setDay(v); if (v !== day) pick(v); }} />
      </Host>
      <BigButton label={t("pick.date.use")} onPress={() => pick(day)} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  host: { marginHorizontal: S.md, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: S.sm },
  chips: { flexDirection: "row", gap: S.sm, paddingHorizontal: S.md },
}));
