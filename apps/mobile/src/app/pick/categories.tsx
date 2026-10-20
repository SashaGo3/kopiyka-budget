import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { archivedCategoryIds, listRows, type Category } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { ButtonText, CategoryIcon, HeaderBar } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { catName } from "@/lib/names";
import { t } from "@/i18n";

type Item = { kind: "none" } | { kind: "folder"; c: Category; kids: Category[] } | { kind: "child"; c: Category; parent: Category };

/**
 * Multi-select categories grouped by folder. Selection is per category id: a folder row
 * ticks (full) only when every one of its categories is selected — meaning "this folder,
 * including future categories" — and half-ticks (`minus.circle.fill`) when some are.
 * Tapping a folder selects all its categories when not all are selected yet, else clears
 * them all; a folder with zero categories is selectable as itself. Tapping a category
 * toggles just that one. On open, a folder id found in `selected` (older saved scopes)
 * expands into its current categories. On Done, a fully-selected folder resolves to its
 * own id again; otherwise the individual category ids are returned. The header stays put
 * while scrolling.
 */
export default function PickCategories() {
  const { key, selected, title } = useLocalSearchParams<{ key: string; selected?: string; title?: string }>();
  const groups = useQuery((db) => {
    // Retired categories are not offered here either. One already in the selection stays visible, so
    // an existing budget or tag scope can be read and edited rather than silently losing a member.
    const keep = new Set((selected ?? "").split(",").filter(Boolean));
    const retired = archivedCategoryIds(listRows(db, "categories", "deleted=0"));
    const all = listRows(db, "categories", "deleted=0", [], "sort, name").filter((c) => keep.has(c.id) || !retired.has(c.id));
    return all.filter((c) => !c.parent_id).map((p) => ({ p, kids: all.filter((c) => c.parent_id === p.id) }));
  });
  const [chosen, setChosen] = useState<Set<string>>(() => {
    const ids = selected ? selected.split(",").filter(Boolean) : [];
    const out = new Set<string>();
    for (const id of ids) {
      if (id === "none") { out.add("none"); continue; }
      const folder = groups.find((g) => g.p.id === id);
      if (folder && folder.kids.length) for (const k of folder.kids) out.add(k.id);
      else out.add(id); // a plain category id, or an empty folder standing for itself
    }
    return out;
  });
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [{ kind: "none" }];
    for (const { p, kids } of groups) { out.push({ kind: "folder", c: p, kids }); for (const c of kids) out.push({ kind: "child", c, parent: p }); }
    return out;
  }, [groups]);
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleFolder = (kids: Category[]) => setChosen((s) => {
    const n = new Set(s);
    const full = kids.every((k) => n.has(k.id));
    for (const k of kids) { if (full) n.delete(k.id); else n.add(k.id); }
    return n;
  });
  const catCount = [...chosen].filter((id) => id !== "none").length;
  const done = () => {
    const out: string[] = [];
    for (const { p, kids } of groups) {
      if (!kids.length) { if (chosen.has(p.id)) out.push(p.id); continue; }
      const picked = kids.filter((k) => chosen.has(k.id));
      if (picked.length === kids.length) out.push(p.id); // all categories: stands for the whole folder
      else out.push(...picked.map((k) => k.id));
    }
    if (chosen.has("none")) out.push("none");
    resolvePick(key, out);
    router.back();
  };
  const Check = ({ state }: { state: "full" | "half" | "off" }) => (
    <SymbolView name={state === "full" ? "checkmark.circle.fill" : state === "half" ? "minus.circle.fill" : "circle"} size={22} tintColor={state === "full" ? C.tint : C.tertiary} />
  );
  return (
    <FlatList style={{ flex: 1, backgroundColor: C.bgGrouped }} data={items} keyExtractor={(i) => (i.kind === "none" ? "none" : i.c.id)} stickyHeaderIndices={[0]} contentContainerStyle={{ paddingBottom: 60 }}
      ListHeaderComponent={
        <HeaderBar style={styles.head} title={title ?? t("pick.categories.title")}
          left={<Pressable onPress={() => setChosen(new Set())} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("pick.categories.anyA11y")}><ButtonText style={[styles.link, !chosen.size && { fontWeight: "700" }]} maxFontSizeMultiplier={1.3}>{t("pick.any")}</ButtonText></Pressable>}
          right={<Pressable onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.done")} style={styles.doneBtn}><ButtonText style={styles.done} maxFontSizeMultiplier={1.3}>{catCount ? t("pick.doneCount", { count: catCount }) : t("common.done")}</ButtonText></Pressable>} />
      }
      renderItem={({ item }) => {
        if (item.kind === "none") return (
          <Pressable onPress={() => toggle("none")} style={styles.row} accessibilityRole="button" accessibilityLabel={t("pick.categories.uncategorized")} accessibilityState={{ selected: chosen.has("none") }}>
            <View style={styles.noIcon}><SymbolView name="minus" size={14} tintColor={C.tertiary} /></View>
            <Text style={[styles.name, { color: C.secondary }]}>{t("pick.categories.uncategorized")}</Text><Check state={chosen.has("none") ? "full" : "off"} />
          </Pressable>
        );
        if (item.kind === "folder") {
          const full = item.kids.length ? item.kids.every((k) => chosen.has(k.id)) : chosen.has(item.c.id);
          const half = item.kids.length ? !full && item.kids.some((k) => chosen.has(k.id)) : false;
          return (
            <Pressable onPress={() => (item.kids.length ? toggleFolder(item.kids) : toggle(item.c.id))} style={[styles.row, styles.folder]} accessibilityRole="button" accessibilityLabel={t("pick.categories.folderA11y", { name: catName(item.c) })} accessibilityState={{ selected: full }}>
              <CategoryIcon name={catName(item.c)} icon={item.c.icon} color={item.c.color} size={28} />
              <Text style={[styles.name, { fontWeight: "600" }]}>{catName(item.c)} <Text style={styles.all}>{t("pick.categories.wholeFolder")}</Text></Text>
              <Check state={full ? "full" : half ? "half" : "off"} />
            </Pressable>
          );
        }
        const on = chosen.has(item.c.id);
        return (
          <Pressable onPress={() => toggle(item.c.id)} style={[styles.row, styles.child]} accessibilityRole="button" accessibilityLabel={catName(item.c)} accessibilityState={{ selected: on }}>
            <CategoryIcon name={catName(item.c)} icon={item.c.icon} color={item.c.color} size={26} />
            <Text style={styles.name}>{catName(item.c)}</Text>
            <Check state={on ? "full" : "off"} />
          </Pressable>
        );
      }} />
  );
}

const styles = themed(() => StyleSheet.create({
  head: { paddingTop: S.md, paddingBottom: S.sm, backgroundColor: C.bgGrouped },
  link: { color: C.tint, fontSize: 15 },
  doneBtn: { backgroundColor: C.tint, paddingHorizontal: 14, minHeight: 34, paddingVertical: 4, borderRadius: 17, justifyContent: "center" },
  done: { color: C.onTint, fontSize: 15, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 48 },
  folder: { marginTop: S.sm },
  child: { paddingLeft: S.xl + 12 },
  noIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontSize: 17, color: C.label },
  all: { fontSize: 13, color: C.secondary, fontWeight: "400" },
}));
