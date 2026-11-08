import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { CATEGORY_TYPES, archivedCategoryIds, categoryTypeIcon, categoryTypeName, categoryTypes, folderIds, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { catName } from "@/lib/names";
import { resolvePick } from "@/store/pick";
import { PickCheck, PickerHeader, PickerSections, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { getLanguage, t } from "@/i18n";

/**
 * Several types for one category (DATA.md rule 21): "Car" is fuel, parking and the car wash at once.
 * Grouped under the ready-made folder each type belongs with; the ones suggested by the name come
 * first, ticked. Done hands back the list — empty for "no type" — and so does closing the sheet any
 * other way (a swipe, a tap outside): ticking a type and swiping down is choosing it, not cancelling.
 *
 * Several categories may share a type, so each row names the others that already carry it ("Also:
 * Supermarket") — a shop of that kind goes to the most specific of them (`categoryForShop`).
 */
export default function PickTypes() {
  const { key, selected, kind, title, exclude } = useLocalSearchParams<{ key: string; selected?: string; kind?: string; title?: string; exclude?: string }>();
  const lang = getLanguage();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set((selected ?? "").split(",").filter(Boolean)));
  const sections = useMemo(() => CATEGORY_TYPES.filter((g) => g.kind === (kind === "income" ? "income" : "expense"))
    .map((g) => ({ title: categoryTypeName(g.folder, lang), data: g.types.map((x) => x.key) })), [kind, lang]);
  // Which of your other categories already carry each type: live, pickable, not the one being edited.
  const carriers = useQuery((d) => {
    const all = listRows(d, "categories", "deleted=0", [], "sort, name");
    const folders = folderIds(all), gone = archivedCategoryIds(all);
    const out = new Map<string, string[]>();
    for (const c of all) {
      if (c.id === exclude || folders.has(c.id) || gone.has(c.id)) continue;
      for (const ty of categoryTypes(c)) out.set(ty, [...(out.get(ty) ?? []), catName(c)]);
    }
    return out;
  });
  const toggle = (k: string) => { latest.current.touched = true; setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }); };
  // Handed back once, on the way out however it is taken; untouched, nothing is handed back at all.
  const latest = useRef({ chosen, touched: false, sent: false });
  latest.current.chosen = chosen;
  useEffect(() => () => { const l = latest.current; if (!l.sent && l.touched) { l.sent = true; resolvePick(key, [...l.chosen]); } }, [key]);
  const done = () => { latest.current.sent = true; resolvePick(key, [...chosen]); router.back(); };
  return (
    <PickerSections sections={sections} keyExtractor={(k) => k}
      header={<PickerHeader title={title ?? t("category.type.title")} clear={{ label: t("category.type.none"), onPress: () => { latest.current.touched = true; setChosen(new Set()); }, active: !chosen.size }} done={{ onPress: done, count: chosen.size }} />}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => {
        const on = chosen.has(item);
        return (
          <Tap onPress={() => toggle(item)} style={styles.row} accessibilityRole="button" accessibilityLabel={categoryTypeName(item, lang)} accessibilityState={{ selected: on }}>
            <View style={styles.icon}><SymbolView name={categoryTypeIcon(item) as SFSymbol} size={15} tintColor={C.secondary} /></View>
            <View style={styles.text}>
              <Text style={styles.name}>{categoryTypeName(item, lang)}</Text>
              {carriers.get(item)?.length ? <Text style={styles.also} numberOfLines={1}>{t("category.type.also", { names: carriers.get(item)!.join(", ") })}</Text> : null}
            </View>
            <PickCheck state={on} />
          </Tap>
        );
      }} />
  );
}

const styles = themed(() => StyleSheet.create({
  section: { fontSize: 13, color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 46 },
  icon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, paddingVertical: 6 },
  name: { fontSize: 17, color: C.label },
  also: { fontSize: 13, color: C.secondary, marginTop: 1 },
}));
