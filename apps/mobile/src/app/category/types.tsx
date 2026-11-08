import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { archivedCategoryIds, categoryTypeName, categoryTypes, folderIds, listRows, save, suggestCategoryTypes, typeIsStated, typesToStore, type Category } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, CategoryIcon, ModalHeader, Row, SectionHeader } from "@/components/ui";
import { C, themed } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { catName } from "@/lib/names";
import { getLanguage, t } from "@/i18n";

/**
 * Every category you can file into, with its types (DATA.md rule 21) — what a well-known shop is
 * matched to; a category may be several. A ready-made category already answers with its preset; one
 * of your own starts with what its name suggests, shown as a suggestion and kept on Save. Tap a row
 * to change it. Only rows whose answer actually changes are written (rule 15's lesson).
 */
export default function CategoryTypes() {
  const lang = getLanguage();
  const cats = useQuery((d) => {
    const all = listRows(d, "categories", "deleted=0", [], "sort, name");
    const folders = folderIds(all), gone = archivedCategoryIds(all);
    const byId = new Map(all.map((c) => [c.id, c]));
    const groups = new Map<string, { folder: Category | null; items: Category[] }>();
    for (const c of all.filter((x) => !folders.has(x.id) && !gone.has(x.id))) {
      const k = c.parent_id ?? "";
      if (!groups.has(k)) groups.set(k, { folder: c.parent_id ? byId.get(c.parent_id) ?? null : null, items: [] });
      groups.get(k)!.items.push(c);
    }
    return [...groups.values()];
  });
  /** What a row would be saved as untouched: its own answer, or what its name suggests when it has none. */
  const start = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const g of cats) for (const c of g.items) {
      const own = categoryTypes(c);
      out.set(c.id, own.length || typeIsStated(c) ? own : suggestCategoryTypes(catName(c), c.kind));
    }
    return out;
  }, [cats]);
  const [draft, setDraft] = useState<Map<string, string[]>>(() => new Map());
  const shown = (c: Category) => draft.get(c.id) ?? start.get(c.id) ?? [];
  const isSuggestion = (c: Category) => !draft.has(c.id) && !categoryTypes(c).length && !typeIsStated(c) && shown(c).length > 0;
  const exit = useDiscardGuard(useDirty([[...draft].map(([k, v]) => `${k}=${v.join(",")}`).join("|")]));

  const pickKey = useMemo(() => newPickKey("ctypes"), []);
  const editing = useRef<Category | null>(null);
  usePickResult<string[]>(pickKey, useCallback((v: string[]) => {
    const c = editing.current;
    if (c) setDraft((m) => new Map(m).set(c.id, v));
  }, []));
  const pick = (c: Category) => {
    editing.current = c;
    router.push({ pathname: "/pick/types", params: { key: pickKey, title: catName(c), selected: shown(c).join(","), kind: c.kind } });
  };

  const commit = () => {
    mutate((d) => {
      for (const g of cats) for (const c of g.items) {
        const value = typesToStore(shown(c), c.preset);
        if ((c.type ?? null) !== value && JSON.stringify(categoryTypes({ type: value, preset: c.preset })) !== JSON.stringify(categoryTypes(c)) ) save(d, "categories", { ...c, type: value });
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
                const list = shown(c).map((x) => categoryTypeName(x, lang)).join(", ");
                return (
                  <Row key={c.id} title={catName(c)} onPress={() => pick(c)} style={i ? styles.divider : undefined}
                    left={<CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={30} />}
                    subtitle={list ? (isSuggestion(c) ? t("category.type.suggested", { type: list }) : list) : t("category.type.none")}
                    subtitleColor={isSuggestion(c) ? C.tint : !list ? C.tertiary : undefined} />
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
