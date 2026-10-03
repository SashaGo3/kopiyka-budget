import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { CATEGORY_PRESET, presetCounts, presetKey, presetName, seedCategories } from "@kopiyka/core";
import { mutate } from "@/store";
import { OnboardingFrame } from "@/components/Onboarding";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { setOnboarded } from "@/lib/onboarding";
import { getLanguage, t } from "@/i18n";

/**
 * Step 4, and the last one: a ready-made set of folders and categories; one tap adds them all.
 *
 * Notifications are not asked for anywhere in the welcome flow. They are asked for where the
 * feature is — setting a reminder on a recurring payment, or the switch in Settings — because a
 * screen that explains a permission and then lets the user leave without the iOS prompt appearing
 * is what App Review reads as delaying the request (guideline 5.1.1(iv)). Location has a step of
 * its own for the same reason and plays by the same rule: see `location.tsx`.
 */
export default function OnboardingCategories() {
  const { folders, categories } = presetCounts();
  const next = (seed: boolean) => {
    // Named in the language the app is in now; they follow it from then on until renamed (core presets.ts).
    if (seed) mutate((d) => seedCategories(d, getLanguage()));
    setOnboarded();
    router.replace("/transactions");
  };
  const lang = getLanguage();
  return (
    <OnboardingFrame step={4} title={t("onboarding.categories.title")} subtitle={t("onboarding.categories.subtitle", { categories, folders })}
      primary={{ label: t("onboarding.categories.add"), onPress: () => next(true) }}
      secondary={{ label: t("onboarding.categories.none"), onPress: () => next(false) }}>
      <View style={styles.list}>
        {CATEGORY_PRESET.map((f, i) => (
          <FadeIn key={f.key} delay={150 + i * 40} style={styles.folder}>
            <View style={[styles.icon, { backgroundColor: f.color }]}><SymbolView name={f.icon as SFSymbol} size={18} tintColor="white" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{presetName(f.key, lang)}{f.kind === "income" ? <Text style={styles.kind}>  {t("onboarding.categories.income")}</Text> : null}</Text>
              <Text style={styles.cats}>{f.categories.map((c) => presetName(presetKey(f.key, c.key), lang)).join(" · ")}</Text>
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
