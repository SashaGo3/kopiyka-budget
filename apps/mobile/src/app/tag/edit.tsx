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
import { catName, catNameById } from "@/lib/names";
import { colorLabel } from "@/app/pick/color";
import { t } from "@/i18n";

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
    const folderName = parent ? catNameById(parent, t("tag.convert.theFolder")) ?? t("tag.convert.theFolder") : null;
    Alert.alert(t("tag.convert.title", { name: existing.name }),
      folderName ? t("tag.convert.bodyFolder", { count: uses, name: existing.name, folder: folderName }) : t("tag.convert.body", { count: uses, name: existing.name }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("tag.convert.confirm"), style: "destructive", onPress: () => runBusy(
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
    router.push({ pathname: "/pick/option", params: { key: keys.folder, title: t("tag.convert.whichFolder"), options: JSON.stringify([...folders.map((f) => ({ value: f.id, label: catName(f), subtitle: t("tag.convert.inFolder") })), { value: "top", label: t("tag.convert.top"), subtitle: t("tag.convert.topSubtitle") }]) } });
  };
  const valid = name.trim().length > 0;
  const scopeLabel = scope.length ? scope.map((id) => { const c = cats.get(id); return c ? catName(c) : "?"; }).join(", ") : t("tag.anyCategory");
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
      Alert.alert(t("tag.archive.tripTitle"), t("tag.archive.tripBody"), [{ text: t("common.ok") }]);
      return;
    }
    Alert.alert(t("tag.archive.title"),
      [t("tag.archive.keep", { count: uses }),
       rules ? t("tag.archive.rules", { count: rules }) : "",
       t("tag.archive.offered"),
      ].filter(Boolean).join(" "), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("tag.archive.confirm"), onPress: () => { mutate((d) => save(d, "tags", { ...existing, archived: 1 } as Tag)); leave(); } },
    ]);
  };
  const del = () => existing && Alert.alert(t("tag.delete.title"), t("tag.delete.body"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => remove(d, "tags", existing.id)); leave(); } },
  ]);
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={existing ? (existing.archived ? t("tag.title.archived") : t("tag.title.edit")) : t("tag.title.new")} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.save"), onPress: commit, disabled: !valid }} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 60 }}>
        {/* The field on its own line and the preview under it: side by side, a long name's pill took
            half the width and left the text being edited too narrow to read or select. Multiline so a
            long name wraps whole instead of scrolling sideways; Return still saves, never a new line. */}
        <View style={styles.nameBlock}>
          <TextInput value={name} onChangeText={setName} placeholder={t("tag.name")} placeholderTextColor={C.tertiary} style={styles.input} autoFocus={!existing}
            multiline submitBehavior="blurAndSubmit" returnKeyType="done" onSubmitEditing={commit} autoCapitalize="none" accessibilityLabel={t("tag.name")} />
          <View style={styles.preview}><TagPill name={name || t("tag.pillPlaceholder")} color={color} /></View>
        </View>
        <SectionHeader>{t("tag.appearance")}</SectionHeader>
        <Card>
          <Row icon="paintpalette.fill" iconColor="#8E8E93" title={t("tag.colour")} subtitle={color ? (colorName ? colorLabel(colorName) : color) : t("tag.automatic")} onPress={() => router.push({ pathname: "/pick/color", params: { key: keys.color, selected: color ?? "" } })}
            right={<View style={styles.right}><View style={[styles.swatch, { backgroundColor: tagColor(name, color) }]} /><SymbolView name="chevron.right" size={13} tintColor={C.tertiary} /></View>} />
        </Card>
        <Text style={styles.hint}>{t("tag.automaticHint")}</Text>
        <SectionHeader>{t("tag.scope.header")}</SectionHeader>
        <Card>
          <Row icon="folder" iconColor="#FF9F0A" title={t("tag.scope.categories")} subtitle={scopeLabel} onPress={() => router.push({ pathname: "/pick/categories", params: { key: keys.cats, selected: scope.join(","), title: t("tag.scope.pickTitle") } })} />
        </Card>
        <Text style={styles.hint}>{scope.length ? t("tag.scope.some") : t("tag.scope.all")}</Text>
        {existing ? (
          <>
            <SectionHeader>{t("tag.transactions.header")}</SectionHeader>
            <Card><Row icon="list.bullet" iconColor="#8E8E93" title={t("tag.transactions.count", { count: uses })} subtitle={t("tag.transactions.subtitle")} onPress={uses ? showTransactions : undefined} /></Card>
            <SectionHeader>{t("tag.convert.header")}</SectionHeader>
            <Card>
              <Row icon="arrow.turn.down.right" iconColor="#5E5CE6" title={t("tag.convert.row")} subtitle={t("tag.convert.rowSubtitle", { count: uses })} onPress={convert} />
            </Card>
          </>
        ) : null}
        {existing ? (
          <>
            <SectionHeader>{t("tag.archive.header")}</SectionHeader>
            <Card>
              <Row icon={existing.archived ? "tray.and.arrow.up" : "archivebox"} iconColor="#FF9F0A"
                title={existing.archived ? t("tag.archive.restore") : t("tag.archive.row")}
                subtitle={existing.archived ? t("tag.archive.restoreSubtitle")
                  : onTrip ? t("tag.archive.tripSubtitle")
                  : t("tag.archive.rowSubtitle")}
                onPress={archive} />
            </Card>
          </>
        ) : null}
        {existing ? <View style={{ marginTop: S.xl }}><DeleteRow label={t("tag.delete.row")} onPress={del} /></View> : null}
      </ScrollView>
      {converting ? <BusyOverlay label={t("tag.convert.busy", { count: uses })} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, paddingTop: S.sm },
  nameBlock: { gap: S.sm, padding: S.lg },
  input: { backgroundColor: C.card, borderRadius: 12, paddingHorizontal: S.md, paddingTop: 13, paddingBottom: 13, minHeight: 50, fontSize: 18, color: C.label },
  preview: { flexDirection: "row", paddingHorizontal: S.xs },
  right: { flexDirection: "row", alignItems: "center", gap: S.sm },
  swatch: { width: 24, height: 24, borderRadius: 12 },
});
