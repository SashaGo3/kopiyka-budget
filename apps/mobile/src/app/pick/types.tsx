import { useMemo, useState } from "react";
import { SectionList, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { CATEGORY_TYPES, categoryTypeIcon, categoryTypeName } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { ButtonText, HeaderBar, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { getLanguage, t } from "@/i18n";

/**
 * Several types for one category (DATA.md rule 21): "Car" is fuel, parking and the car wash at once.
 * Grouped under the ready-made folder each type belongs with; the ones suggested by the name come
 * first, ticked. Done hands back the list — empty for "no type".
 */
export default function PickTypes() {
  const { key, selected, kind, title } = useLocalSearchParams<{ key: string; selected?: string; kind?: string; title?: string }>();
  const lang = getLanguage();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set((selected ?? "").split(",").filter(Boolean)));
  const sections = useMemo(() => CATEGORY_TYPES.filter((g) => g.kind === (kind === "income" ? "income" : "expense"))
    .map((g) => ({ title: categoryTypeName(g.folder, lang), data: g.types.map((x) => x.key) })), [kind, lang]);
  const toggle = (k: string) => setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const done = () => { resolvePick(key, [...chosen]); router.back(); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <HeaderBar style={styles.head} title={title ?? t("category.type.title")}
        left={<Tap onPress={() => setChosen(new Set())} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("category.type.none")}><ButtonText style={[styles.link, !chosen.size && { fontWeight: "700" }]} maxFontSizeMultiplier={1.3}>{t("category.type.none")}</ButtonText></Tap>}
        right={<Tap onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.done")} style={styles.doneBtn}><ButtonText style={styles.done} maxFontSizeMultiplier={1.3}>{chosen.size ? t("pick.doneCount", { count: chosen.size }) : t("common.done")}</ButtonText></Tap>} />
      <SectionList sections={sections} keyExtractor={(k) => k} stickySectionHeadersEnabled={false} contentContainerStyle={{ paddingBottom: 60 }}
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item }) => {
          const on = chosen.has(item);
          return (
            <Tap onPress={() => toggle(item)} style={styles.row} accessibilityRole="button" accessibilityLabel={categoryTypeName(item, lang)} accessibilityState={{ selected: on }}>
              <View style={styles.icon}><SymbolView name={categoryTypeIcon(item) as SFSymbol} size={15} tintColor={C.secondary} /></View>
              <Text style={styles.name}>{categoryTypeName(item, lang)}</Text>
              <SymbolView name={on ? "checkmark.circle.fill" : "circle"} size={22} tintColor={on ? C.tint : C.tertiary} />
            </Tap>
          );
        }} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  head: { paddingTop: S.md, paddingBottom: S.sm, backgroundColor: C.bgGrouped },
  link: { color: C.tint, fontSize: 15 },
  doneBtn: { backgroundColor: C.tint, paddingHorizontal: 14, minHeight: 34, paddingVertical: 4, borderRadius: 17, justifyContent: "center" },
  done: { color: C.onTint, fontSize: 15, fontWeight: "700" },
  section: { fontSize: 13, color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 46 },
  icon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontSize: 17, color: C.label },
}));
