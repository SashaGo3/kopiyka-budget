import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { CATEGORY_PRESET, presetCounts, seedCategories } from "@kopiyka/core";
import { mutate } from "@/store";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { setOnboarded } from "@/lib/onboarding";

/**
 * Step 3, and the last one: a ready-made set of folders and categories; one tap adds them all.
 *
 * Nothing about notifications or location is asked here. A screen that explains a permission and
 * then lets the user leave without the iOS prompt appearing is what App Review reads as delaying
 * the request (guideline 5.1.1(iv)), so each permission is asked for where its feature is used —
 * the Place button on an entry, a reminder on a recurring payment, the switches in Settings —
 * and the reason is carried by the prompt's own text.
 */
export default function OnboardingCategories() {
  const { folders, categories } = presetCounts();
  const next = (seed: boolean) => {
    if (seed) mutate((d) => seedCategories(d));
    setOnboarded();
    router.replace("/transactions");
  };
  return (
    <OnboardingFrame step={3} title="Categories, ready to go" subtitle={`${categories} categories in ${folders} folders, each with a short description so Siri and the watch can match them. Rename, add or remove any later.`}
      primary={{ label: "Add these categories", onPress: () => next(true) }}
      secondary={{ label: "Start with none", onPress: () => next(false) }}>
      <View style={styles.list}>
        {CATEGORY_PRESET.map((f, i) => (
          <FadeIn key={f.name} delay={150 + i * 40} style={styles.folder}>
            <View style={[styles.icon, { backgroundColor: f.color }]}><SymbolView name={f.icon as SFSymbol} size={18} tintColor="white" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{f.name}{f.kind === "income" ? <Text style={styles.kind}>  income</Text> : null}</Text>
              <Text style={styles.cats}>{f.categories.map((c) => c.name).join(" · ")}</Text>
            </View>
          </FadeIn>
        ))}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  list: { gap: S.sm, paddingTop: S.sm },
  folder: { flexDirection: "row", gap: S.md, alignItems: "center", backgroundColor: C.card, borderRadius: 14, padding: S.md },
  icon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 16, fontWeight: "700", color: C.label },
  kind: { fontSize: 12, fontWeight: "600", color: C.secondary },
  cats: { fontSize: 13, color: C.secondary, marginTop: 2, lineHeight: 18 },
});
