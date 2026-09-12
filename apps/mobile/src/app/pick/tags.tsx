import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { createTag, getRow, jsonIds, listRows } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { TagPill } from "@/components/ui";
import { C, S } from "@/constants/theme";

/**
 * Multi-select tags in a half sheet. With a category chosen, tags assigned to that
 * category (or its folder) and tags already used together with it come first; tags
 * meant for other categories are hidden unless already selected. Typing a new name offers to create it:
 * the new tag is assigned to the chosen category (that is what naming it here means) and pinned to the
 * top of the list, newest first — it has no usage history to rank it, and it is the one the user was
 * just looking for.
 */
export default function PickTags() {
  const { key, selected, category } = useLocalSearchParams<{ key: string; selected?: string; category?: string }>();
  const [chosen, setChosen] = useState<string[]>(() => (selected ? selected.split(",").filter(Boolean) : []));
  const [q, setQ] = useState("");
  const [created, setCreated] = useState<string[]>([]);   // ids made in this sheet, oldest first
  const tags = useQuery((db) => {
    const rows = listRows(db, "tags", "deleted=0", [], "name");
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    const recent = db.all<{ tag_ids: string }>(`SELECT tag_ids FROM transactions WHERE deleted=0 AND date>=? AND tag_ids<>'[]'`, [since]);
    const usage = new Map<string, number>();
    for (const r of recent) for (const id of jsonIds(r.tag_ids)) usage.set(id, (usage.get(id) ?? 0) + 1);
    const cat = category ? getRow(db, "categories", category) : undefined;
    const scope = new Set([category ?? "", cat?.parent_id ?? ""]);
    // Tags that were used on transactions of this category (or its folder) before.
    const withCat = new Map<string, number>();
    if (category) for (const r of db.all<{ tag_ids: string }>(`SELECT t.tag_ids FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.deleted=0 AND t.tag_ids<>'[]' AND (t.category_id=? OR c.parent_id=? OR t.category_id=?)`, [category, category, cat?.parent_id ?? ""])) {
      for (const id of jsonIds(r.tag_ids)) withCat.set(id, (withCat.get(id) ?? 0) + 1);
    }
    const rank = (t: { id: string; category_ids: string }) => { const ids = jsonIds(t.category_ids); return ids.length && !ids.some((id) => scope.has(id)) ? 2 : ids.length || withCat.has(t.id) ? 0 : 1; };
    // Tags the transaction already has come first so the ticks are visible without scrolling.
    const initial = new Set(selected ? selected.split(",").filter(Boolean) : []);
    return rows.map((t) => ({ ...t, rank: rank(t), together: withCat.get(t.id) ?? 0 })).filter((t) => t.rank < 2 || chosen.includes(t.id))
      .sort((a, b) => Number(initial.has(b.id)) - Number(initial.has(a.id)) || a.rank - b.rank || b.together - a.together || (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  }, [category, selected]);
  // Sorted after the query so the rest of the order is untouched (Array#sort is stable).
  const ordered = useMemo(() => {
    if (!created.length) return tags;
    const at = (id: string) => { const i = created.indexOf(id); return i < 0 ? created.length : created.length - 1 - i; }; // newest first, everything else after
    return [...tags].sort((a, b) => at(a.id) - at(b.id));
  }, [tags, created]);
  const filtered = q ? ordered.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : ordered;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const done = () => { resolvePick(key, chosen); router.back(); };
  const create = () => {
    const name = q.trim(); if (!name) return;
    const t = mutate((db) => createTag(db, { name, ...(category ? { category_ids: JSON.stringify([category]) } : null) }));
    setChosen((c) => [...c, t.id]); setCreated((c) => [...c, t.id]); setQ("");
  };
  const canCreate = !!q.trim() && !tags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <FlatList style={{ flex: 1, backgroundColor: C.bgGrouped }} data={filtered} keyExtractor={(t) => t.id} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets stickyHeaderIndices={[0]}
      ListHeaderComponent={
        <View style={{ backgroundColor: C.bgGrouped }}>
          <View style={styles.head}>
            <View style={styles.side} />
            <Text style={styles.title}>Tags</Text>
            <View style={[styles.side, { alignItems: "flex-end" }]}><Pressable onPress={done} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done" style={styles.doneBtn}><Text style={styles.done}>Done{chosen.length ? ` (${chosen.length})` : ""}</Text></Pressable></View>
          </View>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search or type a new tag" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} onSubmitEditing={canCreate ? create : done} returnKeyType={canCreate ? "default" : "done"} accessibilityLabel="Search tags" />
          </View>
          {canCreate ? <Pressable onPress={create} style={styles.row} accessibilityRole="button"><SymbolView name="plus.circle" size={20} tintColor={C.tint} /><Text style={[styles.name, { color: C.tint }]}>Create “{q.trim()}”</Text></Pressable> : null}
        </View>
      }
      renderItem={({ item: t, index }) => (
        <>
          {category && index === 0 && t.rank === 0 ? <Text style={styles.section}>Used with this category</Text> : null}
          {category && t.rank === 1 && (index === 0 || filtered[index - 1]!.rank === 0) ? <Text style={styles.section}>Other tags</Text> : null}
          <Pressable onPress={() => toggle(t.id)} style={styles.row} accessibilityRole="button" accessibilityLabel={t.name} accessibilityState={{ selected: chosen.includes(t.id) }}>
            <TagPill name={t.name} color={t.color} />
            <Text style={styles.count}>{t.together ? `${t.together}×` : ""}</Text>
            <View style={{ flex: 1 }} />
            <SymbolView name={chosen.includes(t.id) ? "checkmark.circle.fill" : "circle"} size={22} tintColor={chosen.includes(t.id) ? C.tint : C.tertiary} />
          </Pressable>
        </>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No tags yet. Type a name above to create one.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: S.lg, paddingTop: S.md },
  side: { width: 90 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600", color: C.label },
  count: { fontSize: 12, color: C.tertiary },
  doneBtn: { backgroundColor: C.tint, paddingHorizontal: 14, minHeight: 34, paddingVertical: 4, borderRadius: 17, justifyContent: "center" },
  done: { color: C.onTint, fontSize: 15, fontWeight: "700" },
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.sm, marginBottom: S.xs, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  section: { fontSize: 12, color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 48 },
  name: { flex: 1, fontSize: 17, color: C.label },
  empty: { color: C.tertiary, textAlign: "center", padding: S.xl },
});
