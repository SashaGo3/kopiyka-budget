import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { COLORS, autoIcon, createCategory, getRow, listRows, remove, save, type Category } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, resolvePick, usePickResult } from "@/store/pick";
import { Card, CategoryIcon, DeleteRow, ModalHeader, Row, SectionHeader, Segmented, ToggleRow } from "@/components/ui";
import { C, S } from "@/constants/theme";

/**
 * Category editor: name at the top, icon auto-suggested from the name. Icon, colour and
 * (for a category) folder are compact rows that open a picker sheet rather than inline
 * grids. A folder is a top-level category; a category lives inside a folder. Renaming
 * either updates every transaction, budget and rule that points at it.
 */
export default function CategoryEdit() {
  const { id, pickKey, parent, name: presetName, folder, kind: presetKind } = useLocalSearchParams<{ id: string; pickKey?: string; parent?: string; name?: string; folder?: string; kind?: string }>();
  const existing = id === "new" ? null : getRow(db, "categories", id) ?? null;
  const parents = useQuery((d) => listRows(d, "categories", "deleted=0 AND parent_id IS NULL", [], "sort, name"));
  const [name, setName] = useState(existing?.name ?? presetName ?? "");
  // For an EXISTING row use its own parent_id verbatim: null means folder, and `??` must not
  // fall through to the "new item" default (a null parent_id would otherwise look "missing").
  const [parentId, setParentId] = useState<string | null>(existing ? existing.parent_id : ((folder === "1" ? null : parent || parents[0]?.id) ?? null));
  const [kind, setKind] = useState<"expense" | "income">(existing?.kind ?? (presetKind === "income" ? "income" : "expense"));
  const [icon, setIcon] = useState<string | null>(existing?.icon ?? null);
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [description, setDescription] = useState(existing?.description ?? "");
  const isFolder = parentId === null;
  const children = useQuery((d) => (existing ? listRows(d, "categories", "deleted=0 AND parent_id=?", [existing.id], "sort, name") : []), [existing?.id]);
  const hasChildren = children.length;
  /** Folder colour → every category inside it, applied on Save so Cancel still undoes everything. */
  const [recolour, setRecolour] = useState(false);
  const uses = useQuery((d) => (existing ? d.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions t LEFT JOIN categories c ON c.id=t.category_id WHERE t.deleted=0 AND (t.category_id=? OR c.parent_id=?)`, [existing.id, existing.id])?.n ?? 0 : 0), [existing?.id]);
  const keys = useMemo(() => ({ icon: newPickKey("cicon"), color: newPickKey("ccolor"), folder: newPickKey("cfolder") }), []);
  usePickResult<string | null>(keys.icon, useCallback((v) => setIcon(v), []));
  usePickResult<string | null>(keys.color, useCallback((v) => setColor(v), []));
  usePickResult<string>(keys.folder, useCallback((v) => setParentId(v), []));
  // Jump to this category's transactions (all time, in the Settings stack so it doesn't close Settings).
  const showTransactions = () => {
    if (!existing) return;
    router.back();
    setTimeout(() => router.push({ pathname: "/settings/transactions", params: { category: existing.id, name: existing.name } }), 350);
  };
  const parentFolder = parentId ? parents.find((p) => p.id === parentId) ?? null : null;
  // A category with no colour of its own takes its folder's, so a folder that was given a colour
  // really does colour what is inside it. It is stored on Save, not resolved at display time:
  // every list, chart and widget already reads the category's own colour and none of them knows
  // about folders — and a category moved to another folder keeps the colour it was last saved with.
  const inherited = !isFolder ? parentFolder?.color ?? null : null;
  const auto = autoIcon(name);
  const shownIcon = icon ?? auto?.icon ?? "tag.fill";
  const shownColor = color ?? inherited ?? auto?.color ?? "#8E8E93";
  const colorName = COLORS.find((c) => c.hex === shownColor)?.name;
  const valid = name.trim().length > 0;
  const commit = () => {
    if (!valid) return;
    const c = mutate((d) => {
      const row = existing
        ? save(d, "categories", { ...existing, name: name.trim(), parent_id: parentId, kind, icon: icon ?? auto?.icon ?? null, color: color ?? inherited ?? auto?.color ?? null, description: description.trim() || null } as Category)
        : createCategory(d, { name: name.trim(), parent_id: parentId, kind, icon: icon ?? auto?.icon ?? null, color: color ?? inherited ?? auto?.color ?? null, description: description.trim() || null });
      // Same batch as the folder itself: one refresh, and a half-recoloured folder is impossible.
      if (recolour && isFolder) for (const child of children) save(d, "categories", { ...child, color: shownColor });
      return row;
    });
    if (pickKey) resolvePick(pickKey, c.id);
    router.back();
  };
  const del = () => existing && Alert.alert(isFolder ? "Delete folder?" : "Delete category?", hasChildren ? `Its ${hasChildren} categories become top-level folders. Transactions keep their data.` : "Transactions keep their data but become uncategorized.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => remove(d, "categories", existing.id)); router.back(); } },
  ]);
  const pickFolder = () => {
    const options = parents.filter((p) => p.id !== existing?.id).map((p) => ({ value: p.id, label: p.name, icon: p.icon, color: p.color, subtitle: p.kind === "income" ? "Income" : undefined }));
    router.push({ pathname: "/pick/option", params: { key: keys.folder, title: "Which folder?", selected: parentId ?? "", options: JSON.stringify(options) } });
  };
  const folderName = parentFolder?.name ?? null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={existing ? (isFolder ? "Edit folder" : "Edit category") : isFolder ? "New folder" : "New category"} left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Save", onPress: commit, disabled: !valid }} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.nameRow}>
          <View style={[styles.preview, { backgroundColor: shownColor + "26" }]}><SymbolView name={shownIcon as SFSymbol} size={26} tintColor={shownColor} /></View>
          <TextInput value={name} onChangeText={setName} placeholder={isFolder ? "Folder name" : "Category name"} placeholderTextColor={C.tertiary} style={styles.input} autoFocus={!existing} returnKeyType="done" onSubmitEditing={commit} />
        </View>
        <View style={{ paddingHorizontal: S.md, gap: S.sm }}>
          <Segmented<"category" | "folder"> value={isFolder ? "folder" : "category"} onChange={(v) => setParentId(v === "folder" ? null : parents.find((p) => p.id !== existing?.id)?.id ?? null)}
            options={[{ value: "category", label: "Category in a folder" }, { value: "folder", label: "Folder" }]} />
          <Segmented value={kind} onChange={setKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} />
        </View>
        {isFolder && hasChildren ? <Text style={styles.hint}>Contains {hasChildren} categories.</Text> : null}
        {!isFolder ? (
          <>
            <SectionHeader>Description</SectionHeader>
            <TextInput value={description} onChangeText={setDescription} placeholder="What goes here, e.g. supermarkets, bakery, snacks" placeholderTextColor={C.tertiary} style={styles.desc} multiline accessibilityLabel="Category description" />
            <Text style={styles.hint}>The receipt scanner reads this to pick the category.</Text>
          </>
        ) : null}
        <SectionHeader>Appearance</SectionHeader>
        <Card>
          <Row icon="app.fill" iconColor="#8E8E93" title="Icon" subtitle={icon ? icon : "Automatic"} onPress={() => router.push({ pathname: "/pick/icon", params: { key: keys.icon, selected: icon ?? "", color: shownColor } })}
            right={<View style={styles.right}><View style={[styles.rowIcon, { backgroundColor: shownColor + "26" }]}><SymbolView name={shownIcon as SFSymbol} size={16} tintColor={shownColor} /></View><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
          <Row icon="paintpalette.fill" iconColor="#8E8E93" title="Colour" subtitle={color ? (colorName ?? color) : "Automatic"} onPress={() => router.push({ pathname: "/pick/color", params: { key: keys.color, selected: color ?? "" } })}
            right={<View style={styles.right}><View style={[styles.swatch, { backgroundColor: shownColor }]} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
          {isFolder && hasChildren ? (
            <ToggleRow icon="paintbrush.fill" iconColor="#8E8E93" title="Use for all categories"
              subtitle="Applied when you save."
              value={recolour} onChange={setRecolour} style={styles.divider} />
          ) : null}
          {/* The folder's own icon, like the Icon and Colour rows above it: the row is about which
              folder this is, and the folder is a thing with a face everywhere else in the app. */}
          {!isFolder ? <Row icon="folder.fill" iconColor="#8E8E93" title="Folder" subtitle={folderName ?? "None"} onPress={pickFolder}
            right={parentFolder ? <View style={styles.right}><CategoryIcon name={parentFolder.name} icon={parentFolder.icon} color={parentFolder.color} size={30} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View> : undefined} /> : null}
        </Card>
        {!isFolder && inherited && !color ? <Text style={styles.hint}>Automatic uses {folderName}’s colour, because the folder has one.</Text> : null}
        {isFolder ? <Text style={styles.hint}>A folder groups the list; nothing is ever filed straight into one. Give it a colour and the categories inside it are created in that colour.</Text> : null}
        {existing ? (
          <>
            <SectionHeader>Transactions</SectionHeader>
            <Card><Row icon="list.bullet" iconColor="#8E8E93" title={`${uses} transaction${uses === 1 ? "" : "s"}`} subtitle={isFolder ? "In this folder, all time" : "With this category, all time"} onPress={uses ? showTransactions : undefined} /></Card>
          </>
        ) : null}
        {existing ? <View style={{ marginTop: S.xl }}><DeleteRow label={isFolder ? "Delete folder" : "Delete category"} onPress={del} /></View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, paddingTop: S.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  nameRow: { flexDirection: "row", alignItems: "center", gap: S.md, padding: S.lg },
  preview: { width: 50, height: 50, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: S.md, height: 50, fontSize: 18, color: C.label },
  desc: { marginHorizontal: S.lg, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: S.md, paddingVertical: S.sm, minHeight: 60, fontSize: 16, color: C.label },
  right: { flexDirection: "row", alignItems: "center", gap: S.sm },
  rowIcon: { width: 30, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  swatch: { width: 24, height: 24, borderRadius: 12 },
});
