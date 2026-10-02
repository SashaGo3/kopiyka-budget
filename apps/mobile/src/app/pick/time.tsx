import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Host, DatePicker } from "@expo/ui/swift-ui";
import { environment } from "@expo/ui/swift-ui/modifiers";
import { resolvePick } from "@/store/pick";
import { BigButton, Chip, ChipRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getLocale, t } from "@/i18n";

/** Time of day picker (HH:MM) for recurring rules and debt reminders. */
export default function PickTime() {
  const { key, selected } = useLocalSearchParams<{ key: string; selected?: string }>();
  const [time, setTime] = useState(selected && /^\d{2}:\d{2}$/.test(selected) ? selected : "09:00");
  const insets = useSafeAreaInsets();
  const pick = (v: string) => { resolvePick(key, v); router.back(); };
  const now = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const asDate = new Date(2026, 0, 1, Number(time.slice(0, 2)), Number(time.slice(3, 5)));
  return (
    <View style={{ backgroundColor: C.bgGrouped, paddingTop: S.xl, paddingBottom: Math.max(insets.bottom, S.md), gap: S.md }}>
      <Host matchContents style={styles.host}>
        <DatePicker selection={asDate} displayedComponents={["hourAndMinute"]} modifiers={[environment("locale", getLocale())]} onDateChange={(d) => setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`)} />
      </Host>
      <ChipRow>
        <Chip label={t("pick.time.now")} onPress={() => pick(now())} />
        {["08:00", "09:00", "12:00", "18:00", "20:00"].map((h) => <Chip key={h} label={h} active={h === time} onPress={() => pick(h)} />)}
      </ChipRow>
      <BigButton label={t("pick.time.use", { time })} onPress={() => pick(time)} />
    </View>
  );
}

const styles = StyleSheet.create({ host: { marginHorizontal: S.md, backgroundColor: C.card, borderRadius: 14, padding: S.sm } });
