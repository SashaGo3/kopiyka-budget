import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { COLORS, activeTripTagId, convertTagToCategory, createTag, getRow, jsonIds, listRows, remove, save, tagColor, type Tag } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { BusyOverlay, Card, DeleteRow, ModalHeader, Row, SectionHeader, TagPill, runBusy } from "@/components/ui";
import { ALL_TIME } from "@/lib/filters";
import { dismissTo } from "@/lib/nav";
import { C, S } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";

/** Tag editor: name, colour, and which categories (or whole folders) it belongs to. */
export default function TagEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = id === "new" ? null : getRow(db, "tags", id) ?? null;
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState<string | null>(existing?.color ?? null);
  const [scope, setScope] = useState<string[]>(() => (existing ? jsonIds(existing.category_ids) : []));
  // The write is one synchronous transaction over every transaction carrying the tag, so the screen
  // cannot render while it runs: the overlay goes up first and the work starts two frames later.
  const [converting, setConverting] = useState(false);
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([name, color, scope]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
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
      { text: "Convert", style: "destructive", onPress: () => runBusy(
        () => setConverting(true),
        () => mutate((d) => convertTagToCategory(d, existing.id, { parent_id: parent })),
        () => { setConverting(false); leave(); },
      ) },
    ]);
  }, [existing, uses, leave]));
  // Jump to this tag's transactions: the Transactions tab itself, filtered to it over all time (see
  // the same jump in category/edit.tsx). One navigation rather than a dismissal and a timer — see
  // `lib/nav.ts` for what the timer cost.
  const showTransactions = () => {
    if (!existing) return;
    dismissTo({ pathname: "/transactions", params: { tag: existing.id, name: existing.name, from: ALL_TIME, nonce: String(Date.now()) } });
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
    leave();
  };
  /**
   * Retire the tag: every transaction keeps it, a budget on it still counts, and it simply stops
   * being offered — in the tag picker, on the watch, and to the Shortcut automation, which drops it
   * from what a shop's history would otherwise hand a new payment.
   *
   * Two things are in the way of that and are checked rather than discovered later. **Travel mode**
   * is a trip tagging everything you buy, so its tag is being applied right now and archiving it
   * would leave the trip tagging with something the app says is retired — the trip has to be ended
   * first. **Recurring rules** carrying the tag would go on writing it onto every occurrence, which
   * is not wrong but is worth knowing before rather than after.
   */
  const onTrip = useQuery((d) => (existing ? activeTripTagId(d) === existing.id : false), [existing?.id]);
  const rules = useQuery((d) => (existing ? listRows(d, "recurring_rules", "deleted=0 AND active=1").filter((r) => jsonIds(r.tag_ids).includes(existing.id)).length : 0), [existing?.id]);
  const archive = () => {
    if (!existing) return;
    if (existing.archived) { mutate((d) => save(d, "tags", { ...existing, archived: 0 } as Tag)); leave(); return; }
    if (onTrip) {
      Alert.alert("Travel mode is using this tag", "It is being put on everything you log right now. End the trip on the Budgets screen first, then archive the tag.", [{ text: "OK" }]);
      return;
    }
    Alert.alert("Archive this tag?",
      [`Its ${uses} transaction${uses === 1 ? "" : "s"} keep it, and a budget on it still counts.`,
       rules ? `${rules} recurring rule${rules === 1 ? "" : "s"} still put it on what they post — open those if that is not what you want.` : "",
       "It stops being offered for anything new.",
      ].filter(Boolean).join(" "), [
      { text: "Cancel", style: "cancel" },
      { text: "Archive", onPress: () => { mutate((d) => save(d, "tags", { ...existing, archived: 1 } as Tag)); leave(); } },
    ]);
  };
  const del = () => existing && Alert.alert("Delete tag?", "Transactions keep everything else.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => { mutate((d) => remove(d, "tags", existing.id)); leave(); } },
  ]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={existing ? (existing.archived ? "Archived tag" : "Edit tag") : "New tag"} left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Save", onPress: commit, disabled: !valid }} />
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
        {existing ? (
          <>
            <SectionHeader>Archive</SectionHeader>
            <Card>
              <Row icon={existing.archived ? "tray.and.arrow.up" : "archivebox"} iconColor="#FF9F0A"
                title={existing.archived ? "Bring this tag back" : "Archive this tag"}
                subtitle={existing.archived ? "Offered again everywhere it used to be"
                  : onTrip ? "Not while travel mode is using it — end the trip first"
                  : "Keeps every transaction and every budget; just stops being offered"}
                onPress={archive} />
            </Card>
          </>
        ) : null}
        {existing ? <View style={{ marginTop: S.xl }}><DeleteRow label="Delete tag" onPress={del} /></View> : null}
      </ScrollView>
      {converting ? <BusyOverlay label={`Converting ${uses} transaction${uses === 1 ? "" : "s"}…`} /> : null}
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
