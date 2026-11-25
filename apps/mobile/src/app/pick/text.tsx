import { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { nameWithDay } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { Chip, ChipRow, ModalHeader } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";

/**
 * Text entry modal: input at the top, so the keyboard never covers it. Used for names and groups.
 * `suffix` offers a chip that adds that text after what is typed, once (a trip's day after its name);
 * `suffixLabel` is the chip's words.
 */
export default function PickText() {
  const { key, title, value, multiline, suffix, suffixLabel } = useLocalSearchParams<{ key: string; title?: string; value?: string; multiline?: string; suffix?: string; suffixLabel?: string }>();
  const [text, setText] = useState(value ?? "");
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([text]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
  const done = () => { resolvePick(key, text.trim()); leave(); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={title ?? t("pick.text.title")} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.done"), onPress: done }} />
      <TextInput autoFocus value={text} onChangeText={setText} multiline={multiline === "1"} placeholder={title} placeholderTextColor={C.tertiary}
        style={[styles.input, multiline === "1" && { minHeight: 140 }]} returnKeyType={multiline === "1" ? "default" : "done"} onSubmitEditing={multiline === "1" ? undefined : done} />
      {suffix && !text.includes(suffix) ? (
        <View style={styles.chips}><ChipRow>
          <Chip icon="calendar.badge.plus" label={suffixLabel ?? suffix} onPress={() => setText((x) => nameWithDay(x, suffix))} />
        </ChipRow></View>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  chips: { paddingHorizontal: S.lg },
  input: { margin: S.lg, backgroundColor: C.card, borderRadius: R.card, padding: S.md, fontSize: 17, color: C.label, minHeight: 50, textAlignVertical: "top" },
}));
