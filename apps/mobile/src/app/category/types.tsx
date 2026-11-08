import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { CATEGORY_TYPES, NO_TYPE, archivedCategoryIds, categoryType, categoryTypeIcon, categoryTypeName, folderIds, isCategoryType, listRows, save, suggestCategoryType, type Category } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, CategoryIcon, ModalHeader, Row, SectionHeader } from "@/components/ui";
import { C, themed } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { catName } from "@/lib/names";
import { getLanguage, t } from "@/i18n";

/**
 * Every category you can file into, with its type (DATA.md rule 21) — what a well-known shop is
 * matched to. A ready-made category already has one from its preset; one of your own starts with
 * what its name suggests, shown as a suggestion and kept on Save. Tap a row to change it.
 * Only rows whose answer actually changes are written (rule 15's lesson).
 */
export default function CategoryTypes() {
  const lang = getLanguage();
  const cats = useQuery((d) => {
    const all = listRows(d, "categories", "deleted=0", [], "sort, name");
    const folders = folderIds(all), gone = archivedCategoryIds(all);
    const byId = new Map(all.map((c) => [c.id, c]));
    const leaves = all.filter((c) => !folders.has(c.id) && !gone.has(c.id));
    const groups = new Map<string, { folder: Category | null; items: Category[] }>();
    for (const c of leaves) {
      const k = c.parent_id ?? "";
      if (!groups.has(k)) groups.set(k, { folder: c.parent_id ? byId.get(c.parent_id) ?? null : null, items: [] });
      groups.get(k)!.items.push(c);
    }
    return [...groups.values()];
  });
  /** The answer as it stands on the phone: stated, else the preset's; and what a name suggests when neither. */
  const start = useMemo(() => {
    const out = new Map<string, string | null>();
    for (const g of cats) for (const c of g.items) out.set(c.id, categoryType(c) ?? (c.type === NO_TYPE ? null : suggestCategoryType(catName(c), c.kind)));
    return out;
  }, [cats]);
  const [draft, setDraft] = useState<Map<string, string | null>>(() => new Map(start));
  const shown = (c: Category) => (draft.has(c.id) ? draft.get(c.id)! : start.get(c.id) ?? null);
  const isSuggestion = (c: Category) => !categoryType(c) && c.type !== NO_TYPE && shown(c) !== null && shown(c) === start.get(c.id);
  const exit = useDiscardGuard(useDirty([[...draft].map(([k, v]) => `${k}=${v ?? ""}`).join("|")]));

  const pickKey = useMemo(() => newPickKey("ctypes"), []);
  const editing = useRef<Category | null>(null);
  usePickResult<string>(pickKey, useCallback((v: string) => {
    const c = editing.current;
    if (c) setDraft((m) => new Map(m).set(c.id, v === NO_TYPE ? null : v));
  }, []));
  const pick = (c: Category) => {
    editing.current = c;
    const options = [
      { value: NO_TYPE, label: t("category.type.none"), icon: "minus", color: "#8E8E93" },
      ...CATEGORY_TYPES.filter((g) => g.kind === c.kind).flatMap((g) => g.types.map((x) => ({
        value: x.key, label: categoryTypeName(x.key, lang), subtitle: categoryTypeName(g.folder, lang), icon: categoryTypeIcon(x.key), color: "#8E8E93",
      }))),
    ];
    router.push({ pathname: "/pick/option", params: { key: pickKey, title: catName(c), selected: shown(c) ?? NO_TYPE, options: JSON.stringify(options) } });
  };

  const commit = () => {
    mutate((d) => {
      for (const g of cats) for (const c of g.items) {
        const want = shown(c);
        const fromPreset = isCategoryType(c.preset) ? c.preset : null;
        // What the row should hold: nothing when the preset already says it, "none" to say no on purpose.
        const value = want === null ? (fromPreset || c.type ? NO_TYPE : null) : want === fromPreset && !c.type ? null : want;
        if ((c.type ?? null) !== value) save(d, "categories", { ...c, type: value });
      }
    });
    exit(() => router.back());
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("category.types.title")} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.save"), onPress: commit }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {cats.map((g) => (
          <View key={g.folder?.id ?? "top"}>
            <SectionHeader>{g.folder ? catName(g.folder) : t("category.noFolder")}</SectionHeader>
            <Card>
              {g.items.map((c, i) => {
                const type = shown(c);
                return (
                  <Row key={c.id} title={catName(c)} onPress={() => pick(c)} style={i ? styles.divider : undefined}
                    left={<CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={30} />}
                    subtitle={type ? (isSuggestion(c) ? t("category.type.suggested", { type: categoryTypeName(type, lang) }) : categoryTypeName(type, lang)) : t("category.type.none")}
                    subtitleColor={isSuggestion(c) ? C.tint : !type ? C.tertiary : undefined} />
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
