import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { categoryName, categoryNames, getCategoryNamesSeen, listRows, markCategoryNamesSeen, namesToStore, save, suggestName, wantsTranslation, type Category } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { CategoryIcon, Chip, ChipRow, ModalHeader, ScreenNote } from "@/components/ui";
import { orderedCategories } from "@/lib/names";
import { C, R, S, themed } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { getLanguage, LANGUAGES, t } from "@/i18n";

/**
 * Names in the app's language for the categories that were named in another one — what you get after
 * switching the app from English to Ukrainian with "Cats" and "Car wash" of your own. Those the list
 * of common names knows already read translated (core `autoName`); here each can be given a name of
 * your own, the suggestion, or its own name kept as it is. Nothing is stored until Save — then only
 * the rows whose answer changed (`categories.names`, v27, DATA.md rule 16). An empty field goes back
 * to the automatic name.
 */
export default function CategoryNames() {
  const lang = getLanguage();
  const language = LANGUAGES.find((l) => l.code === lang)?.name ?? lang;
  const rows = useMemo(() => {
    const all = orderedCategories(db, listRows(db, "categories", "deleted=0 AND archived=0", [], "sort, name"));
    const parents = all.filter((c) => !c.parent_id);
    // Folders first, each followed by what is in it, the way Settings → Categories lists them.
    const ordered = [...parents.flatMap((p) => [p, ...all.filter((c) => c.parent_id === p.id)]), ...all.filter((c) => c.parent_id && !parents.some((p) => p.id === c.parent_id))];
    // The ones not looked at yet — new since the last Save here — come first.
    const seen = getCategoryNamesSeen(db);
    const listed = ordered.filter((c) => !!categoryNames(c.names)[lang] || wantsTranslation(c, lang));
    return [...listed.filter((c) => !seen.has(c.id)), ...listed.filter((c) => seen.has(c.id))].map((c) => ({ c, suggestion: suggestName(c.name, lang) }));
  }, [lang]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map(({ c }) => [c.id, categoryName(c, lang)])));
  const exit = useDiscardGuard(useDirty([values]));
  const set = (id: string, v: string) => setValues((x) => ({ ...x, [id]: v }));
  const commit = () => {
    mutate((d) => {
      for (const { c } of rows) {
        const next = namesToStore({ ...categoryNames(c.names), [lang]: values[c.id] ?? "" }, c);
        if (next !== (c.names ?? null)) save(d, "categories", { ...c, names: next } as Category);
      }
      // Looked at, all of them: Settings stops offering this screen until a new one turns up.
      markCategoryNamesSeen(d, rows.map(({ c }) => c.id));
    });
    exit(() => router.back());
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("category.names.title", { language })} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.save"), onPress: commit, bold: true }} />
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets contentContainerStyle={{ paddingBottom: 60 }}>
        <ScreenNote>{rows.length ? t("category.names.intro", { language }) : t("category.names.none", { language })}</ScreenNote>
        {rows.map(({ c, suggestion }) => {
          const v = values[c.id] ?? "";
          const keeps = v.trim() === c.name.trim();
          return (
            <View key={c.id} style={styles.card}>
              <View style={styles.head}>
                <CategoryIcon name={c.name} icon={c.icon} color={c.color} size={26} />
                <Text style={styles.original} numberOfLines={1}>{c.name}</Text>
              </View>
              <TextInput value={v} onChangeText={(x) => set(c.id, x)} placeholder={c.name} placeholderTextColor={C.tertiary} style={styles.input}
                returnKeyType="done" autoCorrect={false} accessibilityLabel={t("category.names.a11y", { name: c.name, language })} />
              <View style={styles.chips}><ChipRow>
                {suggestion && suggestion !== c.name ? <Chip compact label={suggestion} icon="character.book.closed" active={v.trim() === suggestion} onPress={() => set(c.id, suggestion)} /> : null}
                <Chip compact label={t("category.names.keep", { name: c.name })} icon="arrow.uturn.backward" active={keeps} onPress={() => set(c.id, c.name)} />
              </ChipRow></View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { marginHorizontal: S.lg, marginTop: S.sm, backgroundColor: C.card, borderRadius: R.card, padding: S.md, gap: S.sm },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm },
  original: { flex: 1, color: C.secondary, fontSize: 14 },
  chips: { marginHorizontal: -S.md },
  input: { color: C.label, fontSize: 17, paddingVertical: S.xs },
}));
