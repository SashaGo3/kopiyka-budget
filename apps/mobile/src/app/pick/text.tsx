import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { resolvePick } from "@/store/pick";
import { ModalHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";

/** Text entry modal: input at the top, so the keyboard never covers it. Used for names and groups. */
export default function PickText() {
  const { key, title, value, multiline } = useLocalSearchParams<{ key: string; title?: string; value?: string; multiline?: string }>();
  const [text, setText] = useState(value ?? "");
  const done = () => { resolvePick(key, text.trim()); router.back(); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={title ?? "Text"} left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Done", onPress: done }} />
      <TextInput autoFocus value={text} onChangeText={setText} multiline={multiline === "1"} placeholder={title} placeholderTextColor={C.tertiary}
        style={[styles.input, multiline === "1" && { minHeight: 140 }]} returnKeyType={multiline === "1" ? "default" : "done"} onSubmitEditing={multiline === "1" ? undefined : done} />
    </View>
  );
}

const styles = StyleSheet.create({
  input: { margin: S.lg, backgroundColor: C.card, borderRadius: 14, padding: S.md, fontSize: 18, color: C.label, minHeight: 50, textAlignVertical: "top" },
});
