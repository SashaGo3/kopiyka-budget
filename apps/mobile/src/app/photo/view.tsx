import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { resolvePick } from "@/store/pick";
import { S } from "@/constants/theme";

/** Full-screen look at a transaction's photo. "Remove" resolves `true` to the caller; retaking happens from the sheet. */
export default function PhotoView() {
  const { uri, key } = useLocalSearchParams<{ uri: string; key?: string }>();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.screen}>
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Attached photo" />
      <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.btn, { top: insets.top + S.sm, right: S.lg }]} accessibilityRole="button" accessibilityLabel="Close">
        <SymbolView name="xmark" size={18} tintColor="white" weight="semibold" />
      </Pressable>
      {key ? (
        <Pressable onPress={() => { resolvePick(key, true); router.back(); }} style={[styles.remove, { bottom: Math.max(insets.bottom, S.lg) + S.md }]} accessibilityRole="button" accessibilityLabel="Remove photo">
          <SymbolView name="trash" size={16} tintColor="white" />
          <Text style={styles.removeText}>Remove photo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "black" },
  btn: { position: "absolute", width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
  remove: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 18, height: 44, borderRadius: 22, backgroundColor: "rgba(255,59,48,0.85)" },
  removeText: { color: "white", fontSize: 16, fontWeight: "600" },
});
