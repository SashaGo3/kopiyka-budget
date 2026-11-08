import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { archivedCategoryIds, categoryTypeName, categoryTypes, folderIds, getRow, listRows, save, suggestCategoryTypes, historySuggestions, typeIsStated, type HistoryEvidence, typesToStore, type Category, type SqlDriver } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { ButtonText, Card, CategoryIcon, Footnote, ModalHeader, Row, SectionHeader, Tap } from "@/components/ui";
import { C, themed } from "@/constants/theme";
import { catName, catNameById, orderedCategories } from "@/lib/names";
import { getLanguage, t } from "@/i18n";

/**
 * Every category you can file into, with its types (DATA.md rule 21) — what a well-known shop is
 * matched to. A category may be several, and several categories may share one. A ready-made category
 * already answers with its preset; one of your own that has said nothing is offered what its name
 * suggests, or failing that what the shops its payments went to suggest, in the tint colour.
 *
 * Nothing waits for a Save: a type picked is written as the picker closes, however it closes, and
 * "Use all suggestions" writes every suggestion at once, with an Undo until the screen is left. Only rows whose answer actually changes are
 * written (rule 15's lesson) — an untouched row with a fresh `updated_at` would win merges it should lose.
 */
type Suggestion = { types: string[]; from: "name" } | { types: string[]; from: "history"; why: HistoryEvidence };

/**
 * Write `types` on `c` if that changes what the row answers; nothing otherwise. Says whether it wrote.
 * Everything written here was chosen — an empty list is "no type, on purpose", which takes the row
 * off the list of those that need one.
 */
function writeTypes(d: SqlDriver, c: Category, types: string[]): boolean {
  const value = typesToStore(types, c.preset, true);
  const after = { type: value, preset: c.preset };
  if (JSON.stringify(categoryTypes(after)) === JSON.stringify(categoryTypes(c)) && typeIsStated(after) === typeIsStated(c)) return false;
  save(d, "categories", { ...c, type: value });
  return true;
}

export default function CategoryTypes() {
  const lang = getLanguage();
  const cats = useQuery((d) => {
    const all = orderedCategories(d, listRows(d, "categories", "deleted=0", [], "sort, name"));
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
  // What the payments say, read once as the screen opens: it scans every payment of the last two
  // years, and a pick here changes nothing about what a payment was.
  const [history] = useState(() => historySuggestions(db));
  // The rows "Use all" wrote, as they were before, for its Undo.
  const [undo, setUndo] = useState<{ id: string; type: string | null }[] | null>(null);

  /** What a row that has said nothing would be given: its name's answer, else its payments'. */
  const suggestions = useMemo(() => {
    const out = new Map<string, Suggestion>();
    for (const g of cats) for (const c of g.items) {
      if (categoryTypes(c).length || typeIsStated(c)) continue;
      const byName = suggestCategoryTypes(catName(c), c.kind, g.folder ? catName(g.folder) : null);
      if (byName.length) out.set(c.id, { types: byName, from: "name" });
      else { const why = history.get(c.id); if (why) out.set(c.id, { types: why.types, from: "history", why }); }
    }
    return out;
  }, [cats, history]);

  const pickKey = useMemo(() => newPickKey("ctypes"), []);
  const editing = useRef<Category | null>(null);
  usePickResult<string[]>(pickKey, useCallback((v: string[]) => {
    const c = editing.current;
    editing.current = null;
    if (c) mutate((d) => writeTypes(d, c, v));
  }, []));
  const shown = (c: Category) => { const own = categoryTypes(c); return own.length || typeIsStated(c) ? own : suggestions.get(c.id)?.types ?? []; };
  const pick = (c: Category) => {
    editing.current = c;
    router.push({ pathname: "/pick/types", params: { key: pickKey, title: catName(c), selected: shown(c).join(","), kind: c.kind, exclude: c.id } });
  };
  const applyAll = () => {
    const before: { id: string; type: string | null }[] = [];
    mutate((d) => {
      for (const g of cats) for (const c of g.items) {
        const s = suggestions.get(c.id);
        if (s && writeTypes(d, c, s.types)) before.push({ id: c.id, type: c.type ?? null });
      }
    });
    if (before.length) setUndo(before);
  };
  // Back to what each row said before — "not said" included, so it is offered again as a suggestion.
  const undoAll = () => {
    const was = undo;
    setUndo(null);
    if (was) mutate((d) => { for (const w of was) { const c = getRow(d, "categories", w.id) as Category | undefined; if (c && !c.deleted) save(d, "categories", { ...c, type: w.type }); } });
  };

  // What still needs an answer goes first, where it cannot be missed: no type at all (orange) ahead of
  // a suggestion waiting for a yes (tint), each with its folder named since it is shown outside it.
  // Once a row has a type — or "none" chosen on purpose — it moves down into its folder.
  const undecided = (c: Category) => !categoryTypes(c).length && !typeIsStated(c);
  const needs = cats.flatMap((g) => g.items.filter(undecided).map((c) => ({ c, folder: g.folder })))
    .sort((a, b) => Number(suggestions.has(a.c.id)) - Number(suggestions.has(b.c.id)));
  const decided = cats.map((g) => ({ ...g, items: g.items.filter((c) => !undecided(c)) })).filter((g) => g.items.length);
  const row = (c: Category, i: number, folder?: Category | null) => {
    const list = shown(c).map((x) => categoryTypeName(x, lang)).join(", ");
    const s = suggestions.get(c.id);
    const what = !list ? (undecided(c) ? t("category.types.choose") : t("category.type.none"))
      : s ? (s.from === "history" ? t("category.types.fromHistory", { type: list }) : t("category.type.suggested", { type: list })) : list;
    // A guess from payments says what it rests on, so a wrong one is plain at a glance.
    const because = s?.from === "history" ? reason(s.why) : null;
    const line = (folder ? `${catName(folder)} · ${what}` : what) + (because ? `\n${because}` : "");
    // Nothing to suggest and nothing chosen: "Not needed" answers it in one tap ("Sodastream" is not
    // a kind of shop), instead of the picker and its None.
    const quiet = undecided(c) && !s;
    return (
      <Row key={c.id} title={catName(c)} onPress={() => pick(c)} style={i ? styles.divider : undefined}
        left={<CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={30} />}
        subtitle={line}
        subtitleColor={s ? C.tint : !list && undecided(c) ? C.orange : !list ? C.tertiary : undefined}
        right={quiet ? (
          <Tap onPress={() => mutate((d) => writeTypes(d, c, []))} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("category.types.notNeededA11y", { name: catName(c) })} style={styles.quiet}>
            <ButtonText style={styles.quietText}>{t("category.types.notNeeded")}</ButtonText>
          </Tap>
        ) : undefined} />
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("category.types.title")} right={{ label: t("common.done"), onPress: () => router.back() }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {suggestions.size ? (
          <Card style={{ marginTop: 16 }}>
            <Row icon="wand.and.stars" iconColor="#AF52DE" title={t("category.types.useAll", { count: suggestions.size })} onPress={applyAll} />
          </Card>
        ) : undo ? (
          <Card style={{ marginTop: 16 }}>
            <Row icon="arrow.uturn.backward" iconColor="#8E8E93" title={t("category.types.undo", { count: undo.length })} onPress={undoAll} />
          </Card>
        ) : null}
        {needs.length ? (
          <View>
            <SectionHeader>{t("category.types.needs", { count: needs.length })}</SectionHeader>
            <Card>{needs.map(({ c, folder }, i) => row(c, i, folder))}</Card>
          </View>
        ) : null}
        {decided.map((g) => (
          <View key={g.folder?.id ?? "top"}>
            <SectionHeader>{g.folder ? catName(g.folder) : t("category.noFolder")}</SectionHeader>
            <Card>{g.items.map((c, i) => row(c, i))}</Card>
          </View>
        ))}
        <Footnote>{t("category.types.hint")}</Footnote>
      </ScrollView>
    </View>
  );
}

/** "Paid to E-BOK.VANTAGERENT.PL, like Rent" or "Lidl, Biedronka — known shops". */
function reason(why: HistoryEvidence): string {
  const short = (p: string) => (p.length > 28 ? `${p.slice(0, 27)}…` : p);
  if (why.like) return t("category.types.becauseLike", { payee: short(why.payees[0] ?? ""), category: catNameById(why.like) ?? "?" });
  return t("category.types.becauseShops", { payees: why.payees.slice(0, 2).map(short).join(", ") });
}

const styles = themed(() => StyleSheet.create({
  quiet: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: C.fill },
  quietText: { fontSize: 14, color: C.secondary, fontWeight: "600" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
}));
