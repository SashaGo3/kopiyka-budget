import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { CATEGORY_PRESET, missingPresets, presetDescription, presetKey, presetName, seedCategories } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { PickCheck, PickerHeader, PickerSections, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { getLanguage, t } from "@/i18n";

/**
 * The ready-made categories this phone has nothing for (`missingPresets`) — added in later versions,
 * or skipped at onboarding — to add one by one. Nothing is ticked to start with: each is a category
 * someone asked for, not a gap the app fills. A pick goes into the folder of that name if there is
 * one ("Bills"), or a new ready-made folder; each is named in the app's language and follows it
 * until renamed (DATA.md rule 16).
 */
export default function AddPresets() {
  const lang = getLanguage();
  const [missing] = useState(() => new Set(missingPresets(db)));
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const sections = useMemo(() => CATEGORY_PRESET
    .map((f) => ({ title: presetName(f.key, lang) ?? f.key, data: f.categories.map((c) => ({ key: presetKey(f.key, c.key), icon: c.icon })).filter((c) => missing.has(c.key)) }))
    .filter((s) => s.data.length), [missing, lang]);
  const toggle = (k: string) => setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const done = () => {
    if (chosen.size) mutate((d) => seedCategories(d, lang, chosen));
    router.back();
  };
  return (
    <PickerSections sections={sections} keyExtractor={(c) => c.key}
      header={<PickerHeader title={t("settingsLists.categories.presets.title")} done={{ onPress: done, count: chosen.size }} />}
      ListEmptyComponent={<Text style={styles.empty}>{t("settingsLists.categories.presets.none")}</Text>}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => {
        const on = chosen.has(item.key);
        const name = presetName(item.key, lang) ?? item.key;
        return (
          <Tap onPress={() => toggle(item.key)} style={styles.row} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected: on }}>
            <View style={styles.icon}><SymbolView name={item.icon as SFSymbol} size={15} tintColor={C.secondary} /></View>
            <View style={styles.text}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.hint} numberOfLines={1}>{presetDescription(item.key, lang)}</Text>
            </View>
            <PickCheck state={on} />
          </Tap>
        );
      }} />
  );
}

const styles = themed(() => StyleSheet.create({
  section: { fontSize: 13, color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 52 },
  icon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, paddingVertical: 6 },
  name: { fontSize: 17, color: C.label },
  hint: { fontSize: 13, color: C.secondary, marginTop: 1 },
  empty: { fontSize: 15, color: C.secondary, textAlign: "center", padding: S.xl },
}));
