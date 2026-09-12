import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { COLORS, convertTagToCategory, createTag, getRow, jsonIds, listRows, remove, save, tagColor, type Tag } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, DeleteRow, ModalHeader, Row, SectionHeader, TagPill } from "@/components/ui";
import { C, S } from "@/constants/theme";

/** Tag editor: name, colour, and which categories (or whole folders) it belongs to. */
export default function TagEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = id === "new" ? null : getRow(db, "tags", id) ?? null;
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [scope, setScope] = useState<string[]>(() => (existing ? jsonIds(existing.category_ids) : []));
  const cats = useQuery((d) => new Map(listRows(d, "categories", "deleted=0", [], "sort, name").map((c) => [c.id, c])));
  const uses = useQuery((d) => (existing ? d.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0 AND tag_ids LIKE ?`, [`%"${existing.id}"%`])?.n ?? 0 : 0), [existing?.id]);
  const keys = useMemo(() => ({ cats: newPickKey("tcats"), folder: newPickKey("tfolder"), color: newPickKey("tcolor") }), []);
  usePickResult<string[]>(keys.cats, useCallback((ids: string[]) => setScope(ids.filter((x) => x !== "none")), []));
  usePickResult<string | null>(keys.color, useCallback((v) => setColor(v), []));
  usePickResult<string>(keys.folder, useCallback((folder: string) => {
    if (!existing) return;
    const parent = folder === "top" ? null : folder;
    Alert.alert(`Turn “${existing.name}” into a category?`, `${uses} transaction${uses === 1 ? "" : "s"} will get the category “${existing.name}”${parent ? ` in ${getRow(db, "categories", parent)?.name ?? "the folder"}` : ""} and lose the tag. The tag is removed.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Convert", style: "destructive", onPress: () => { mutate((d) => convertTagToCategory(d, existing.id, { parent_id: parent })); router.back(); } },
    ]);
  }, [existing, uses]));
  // Jump to this tag's transactions (all time, in the Settings stack so it doesn't close Settings).
  const showTransactions = () => {
    if (!existing) return;
    router.back();
    setTimeout(() => router.push({ pathname: "/settings/transactions", params: { tag: existing.id, name: existing.name } }), 350);
  };
  const convert = () => {
    const folders = [...cats.values()].filter((c) => !c.parent_id);
    router.push({ pathname: "/pick/option", params: { key: keys.folder, title: "Which folder?", options: JSON.stringify([...folders.map((f) => ({ value: f.id, label: f.name, subtitle: "Category inside this folder" })), { value: "top", label: "Top level", subtitle: "Becomes a folder of its own" }]) } });
  };
  const valid = name.trim().length > 0;
  const scopeLabel = scope.length ? scope.map((id) => cats.get(id)?.name ?? "?").join(", ") : "Any category";
  const colorName = COLORS.find((c) => c.hex === color)?.name;
  const commit = () => {
    if (!valid) return;
    mutate((d) => existing
      ? save(d, "tags", { ...existing, name: name.trim(), color, category_ids: JSON.stringify(scope) } as Tag)
      : createTag(d, { name: name.trim(), color, category_ids: JSON.stringify(scope) }));
    router.back();
  };
  const del = () => existing && Alert.alert("Delete tag?", "Transactions keep everything else.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => remove(d, "tags", existing.id)); router.back(); } },
  ]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={existing ? "Edit tag" : "New tag"} left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Save", onPress: commit, disabled: !valid }} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 60 }}>
        <View style={styles.nameRow}>
          <TagPill name={name || "tag"} color={color} />
          <TextInput value={name} onChangeText={setName} placeholder="Tag name" placeholderTextColor={C.tertiary} style={styles.input} autoFocus={!existing} returnKeyType="done" onSubmitEditing={commit} autoCapitalize="none" />
        </View>
        <SectionHeader>Appearance</SectionHeader>
        <Card>
          <Row icon="paintpalette.fill" iconColor="#8E8E93" title="Colour" subtitle={color ? (colorName ?? color) : "Automatic"} onPress={() => router.push({ pathname: "/pick/color", params: { key: keys.color, selected: color ?? "" } })}
            right={<View style={styles.right}><View style={[styles.swatch, { backgroundColor: tagColor(name, color) }]} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
        </Card>
        <Text style={styles.hint}>Automatic picks a colour from the tag’s name, so no two tags next to each other look alike. Renaming the tag picks another one.</Text>
        <SectionHeader>Where it is offered</SectionHeader>
        <Card>
          <Row icon="folder" iconColor="#FF9F0A" title="Categories" subtitle={scopeLabel} onPress={() => router.push({ pathname: "/pick/categories", params: { key: keys.cats, selected: scope.join(","), title: "Offer this tag for" } })} />
        </Card>
        <Text style={styles.hint}>{scope.length ? "Offered only when one of these categories (or a category in a selected folder) is chosen." : "Nothing selected: the tag is offered for every category."}</Text>
        {existing ? (
          <>
            <SectionHeader>Transactions</SectionHeader>
            <Card><Row icon="list.bullet" iconColor="#8E8E93" title={`${uses} transaction${uses === 1 ? "" : "s"}`} subtitle="With this tag, all time" onPress={uses ? showTransactions : undefined} /></Card>
            <SectionHeader>Convert</SectionHeader>
            <Card>
              <Row icon="arrow.turn.down.right" iconColor="#5E5CE6" title="Turn into a category" subtitle={`Moves ${uses} transaction${uses === 1 ? "" : "s"} to a new category and removes the tag`} onPress={convert} />
            </Card>
          </>
        ) : null}
        {existing ? <View style={{ marginTop: S.xl }}><DeleteRow label="Delete tag" onPress={del} /></View> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, paddingTop: S.sm },
  nameRow: { flexDirection: "row", alignItems: "center", gap: S.md, padding: S.lg },
  input: { flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: S.md, height: 50, fontSize: 18, color: C.label },
  right: { flexDirection: "row", alignItems: "center", gap: S.sm },
  swatch: { width: 24, height: 24, borderRadius: 12 },
});
