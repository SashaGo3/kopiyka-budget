import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { folderIds, listRows, type Category } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { CategoryIcon } from "@/components/ui";
import { C, S } from "@/constants/theme";

/** How many recently used categories get a shortcut at the top before the full list starts. */
const RECENT = 6;

type Pickable = Category & { folder: Category | null; uses: number; isFolder: boolean };
type Item =
  | { row: "header"; id: string; title: string; folder?: Category }
  | { row: "cat"; id: string; cat: Pickable; showFolder: boolean; indent?: boolean };

/**
 * Category picker as a half sheet.
 *
 * A folder is not a place to file money — it is how the list is divided — so a folder is normally
 * not offered here, only the categories inside it (core `folderIds`; a top-level category with
 * nothing in it is an ordinary category and stays pickable). `folders=1` says otherwise, for the
 * one caller that means a whole folder: a budget on one counts every category inside it.
 *
 * The order answers "which one did I mean?" in the order the answer usually arrives: the one
 * already chosen, then the handful used lately, then everything under its folder's name. The
 * first two are shortcuts into the third, so they never repeat each other — but they do repeat
 * the list below, which stays complete rather than having holes punched in it where a shortcut
 * happens to point. Searching flattens all of that into plain matches, and typing three letters
 * that match exactly one category picks it straight away.
 */
export default function PickCategory() {
  const { key, kind, selected, folders: withFolders } = useLocalSearchParams<{ key: string; kind?: string; selected?: string; folders?: string }>();
  const allowFolders = withFolders === "1";
  const [q, setQ] = useState("");
  const { pickable, sections } = useQuery((db) => {
    const all = listRows(db, "categories", "deleted=0", [], "sort, name");
    const byId = new Map(all.map((c) => [c.id, c]));
    const folders = folderIds(all);
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
    const usage = new Map(db.all<{ category_id: string; n: number }>(`SELECT category_id, COUNT(*) AS n FROM transactions WHERE deleted=0 AND category_id IS NOT NULL AND date>=? GROUP BY category_id`, [since]).map((r) => [r.category_id, r.n]));
    const wanted = !kind || kind === "expense" ? "expense" : "income";
    // A row that already carries a category shows it whatever its kind — and whatever it is: an
    // older entry may still point at a folder, and hiding it would make the sheet claim the
    // transaction has no category at all.
    const list: Pickable[] = all
      .filter((c) => c.id === selected || ((allowFolders || !folders.has(c.id)) && (c.kind === wanted || (c.parent_id && byId.get(c.parent_id)?.kind === wanted))))
      .map((c) => ({ ...c, folder: c.parent_id ? byId.get(c.parent_id) ?? null : null, uses: usage.get(c.id) ?? 0, isFolder: folders.has(c.id) }));

    const out: Item[] = [];
    const current = list.find((c) => c.id === selected);
    if (current) { out.push({ row: "header", id: "h-assigned", title: "Assigned" }, { row: "cat", id: `a-${current.id}`, cat: current, showFolder: true }); }
    const recent = list.filter((c) => c.uses > 0 && c.id !== selected).sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name)).slice(0, RECENT);
    if (recent.length) { out.push({ row: "header", id: "h-recent", title: "Recent" }); for (const c of recent) out.push({ row: "cat", id: `r-${c.id}`, cat: c, showFolder: true }); }
    // Then every category again, this time where it lives: one block per folder, in the folder
    // order of the Categories screen, with the loose ones last under a heading of their own. Where
    // a folder may be chosen it leads its own block as a row rather than a heading, and its
    // categories are indented under it, so "the whole folder" and "one thing in it" read as the
    // two different answers they are.
    for (const f of all.filter((c) => folders.has(c.id))) {
      const kids = list.filter((c) => c.parent_id === f.id);
      if (!kids.length) continue;
      const whole = list.find((c) => c.id === f.id);
      if (allowFolders && whole) out.push({ row: "cat", id: `g-${f.id}`, cat: whole, showFolder: false });
      else out.push({ row: "header", id: `h-${f.id}`, title: f.name, folder: f });
      for (const c of kids) out.push({ row: "cat", id: `f-${c.id}`, cat: c, showFolder: false, indent: allowFolders });
    }
    const loose = list.filter((c) => !c.parent_id && !c.isFolder);
    if (loose.length) { out.push({ row: "header", id: "h-loose", title: "No folder" }); for (const c of loose) out.push({ row: "cat", id: `l-${c.id}`, cat: c, showFolder: false }); }
    return { pickable: list, sections: out };
  }, [kind, selected, allowFolders]);

  const ql = q.trim().toLowerCase();
  const found = useMemo(() => pickable.filter((c) => c.name.toLowerCase().includes(ql) || c.folder?.name.toLowerCase().includes(ql)), [pickable, ql]);
  const data: Item[] = ql ? found.map((c) => ({ row: "cat" as const, id: `s-${c.id}`, cat: c, showFolder: true })) : sections;
  const chosen = useRef(false);
  const choose = (id: string | null) => { if (chosen.current) return; chosen.current = true; resolvePick(key, id); router.back(); };

  // Three matching letters, one category: pick it without another tap.
  useEffect(() => {
    if (ql.length < 3) return;
    // Never a folder: "the whole of Food" is a deliberate choice, not something to be jumped to.
    const leaves = pickable.filter((c) => !c.isFolder);
    const starts = leaves.filter((c) => c.name.toLowerCase().startsWith(ql));
    const inc = found.filter((c) => !c.isFolder);
    const hit = starts.length === 1 ? starts[0] : starts.length === 0 ? (inc.length === 1 ? inc[0] : undefined) : undefined;
    if (hit) choose(hit.id);
  }, [ql]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bgGrouped }}
      data={data}
      keyExtractor={(i) => i.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingBottom: 60 }}
      ListHeaderComponent={
        <View>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder="Search categories" placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} clearButtonMode="while-editing" accessibilityLabel="Search categories" />
          </View>
          {!ql ? <Pressable onPress={() => choose(null)} style={styles.row} accessibilityRole="button" accessibilityLabel="No category"><View style={styles.noIcon}><SymbolView name="minus" size={14} tintColor={C.tertiary} /></View><Text style={[styles.name, { color: C.secondary }]}>No category</Text>{!selected ? <Check /> : null}</Pressable> : null}
        </View>
      }
      renderItem={({ item }) => {
        if (item.row === "header") return (
          <View style={styles.headerRow}>
            {item.folder ? <CategoryIcon name={item.folder.name} icon={item.folder.icon} color={item.folder.color} size={18} /> : null}
            <Text style={styles.header} numberOfLines={1}>{item.title}</Text>
          </View>
        );
        const c = item.cat;
        return (
          <Pressable onPress={() => choose(c.id)} style={[styles.row, item.indent && styles.indent]} accessibilityRole="button" accessibilityLabel={c.isFolder ? `${c.name}, the whole folder` : c.folder ? `${c.name}, in ${c.folder.name}` : c.name} accessibilityState={{ selected: selected === c.id }}>
            <CategoryIcon name={c.name} icon={c.icon} color={c.color} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              {/* Only a budget may take a whole folder; elsewhere a folder can still appear as the
                  category an older row was filed under, and there it is just named for what it is. */}
              {c.isFolder ? <Text style={styles.folder}>{allowFolders ? "Everything in this folder" : "Folder"}</Text> : item.showFolder && c.folder ? (
                <View style={styles.folderRow}>
                  <CategoryIcon name={c.folder.name} icon={c.folder.icon} color={c.folder.color} size={14} />
                  <Text style={styles.folder} numberOfLines={1}>{c.folder.name}</Text>
                </View>
              ) : null}
            </View>
            {selected === c.id ? <Check /> : null}
          </Pressable>
        );
      }}
      ListEmptyComponent={ql ? <Text style={styles.empty}>Nothing matches “{q.trim()}”.</Text> : null}
      ListFooterComponent={<Pressable onPress={() => router.replace({ pathname: "/category/edit", params: { id: "new", pickKey: key, name: q.trim(), kind: kind === "income" ? "income" : "expense" } })} style={styles.row} accessibilityRole="button" accessibilityLabel={q.trim() ? `New category “${q.trim()}”` : "New category"}><SymbolView name="plus.circle" size={20} tintColor={C.tint} /><Text style={[styles.name, { color: C.tint }]}>{q.trim() ? `New category “${q.trim()}”` : "New category…"}</Text></Pressable>}
    />
  );
}

function Check() { return <SymbolView name="checkmark" size={16} tintColor={C.tint} />; }

const styles = StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginHorizontal: S.lg, marginTop: S.lg, marginBottom: S.xs, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, minHeight: 52, paddingVertical: 6 },
  indent: { paddingLeft: S.xl + S.lg },
  headerRow: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.xs },
  header: { fontSize: 13, fontWeight: "600", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4 },
  noIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  name: { fontSize: 17, color: C.label },
  folderRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  folder: { fontSize: 12, color: C.secondary },
  empty: { color: C.tertiary, fontSize: 15, textAlign: "center", paddingTop: S.xl },
});
