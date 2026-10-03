import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, type ColorValue } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  applyImportance, categoryImportance, importanceAffected, importanceMarks, markableCategories,
  markableLeaves, type Category, type Importance,
} from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { BigButton, Card, Empty, ModalHeader, CategoryIcon } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { catName } from "@/lib/names";
import { t } from "@/i18n";

/**
 * Marking every category with how much it matters, in one sitting.
 *
 * Not a bulk editor with a level dropdown, because the question is what makes the answer honest:
 * "set this to Medium" is a shrug, and "could you stop paying for this tomorrow?" is a decision
 * anyone can make about forty things in five minutes.
 *
 * So: two questions and a confirmation. Medium is never asked — it is what neither answer claimed.
 * That is not a saved tap. Asked as a third question, Medium becomes where everything you did not
 * want to think about goes; arrived at by elimination it honestly means "the things in between".
 * It also makes marking something both High and Low unreachable rather than a contradiction the app
 * has to settle by some arbitrary rule.
 *
 * Nothing is written until the last screen, and what that screen lists is what `applyImportance`
 * writes — `importanceMarks` computes both, so the preview cannot describe one edit while the save
 * performs another (the `bulk.ts` rule).
 */

const steps = () => [
  { title: t("category.importance.high.title"), hint: t("category.importance.high.hint") },
  { title: t("category.importance.low.title"), hint: t("category.importance.low.hint") },
  { title: t("category.importance.review.title"), hint: t("category.importance.review.hint") },
] as const;

const levelTitle = (level: Exclude<Importance, 0>): string =>
  level === 3 ? t("category.importance.level.high") : level === 2 ? t("category.importance.level.medium") : t("category.importance.level.low");
const LEVEL_TINT = themed((): Record<Exclude<Importance, 0>, ColorValue> => ({ 3: C.green, 2: C.secondary, 1: C.orange }));

type Group = { folder: Category | null; kids: Category[] };

export default function ImportanceFlow() {
  const asked = useQuery((d) => markableCategories(d));
  const [step, setStep] = useState(0);
  // Both sets hold leaf ids only. A folder is a way of ticking its categories, never a member
  // itself — `importanceMarks` decides when a whole folder agrees and writes the mark up there.
  const seed = useMemo(() => {
    const level = categoryImportance(asked);
    const leaves = markableLeaves(asked);
    return {
      high: new Set(leaves.filter((c) => level.get(c.id) === 3).map((c) => c.id)),
      low: new Set(leaves.filter((c) => level.get(c.id) === 1).map((c) => c.id)),
    };
    // Seeded once: coming back after adding categories should start from the answers already given,
    // not from a blank sheet. Later renders must not overwrite what is being edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [high, setHigh] = useState<Set<string>>(seed.high);
  const [low, setLow] = useState<Set<string>>(seed.low);

  /** Folders with what is inside them, then the categories that belong to no folder. */
  const groups = useMemo<Group[]>(() => {
    const here = new Set(asked.map((c) => c.id));
    const kidsOf = new Map<string, Category[]>();
    for (const c of asked) {
      if (!c.parent_id) continue;
      const list = kidsOf.get(c.parent_id);
      if (list) list.push(c); else kidsOf.set(c.parent_id, [c]);
    }
    const out: Group[] = [];
    for (const c of asked) if (!c.parent_id && kidsOf.get(c.id)?.length) out.push({ folder: c, kids: kidsOf.get(c.id)! });
    // A top-level category with nothing inside it is an ordinary category (DATA.md rule 5), and a
    // category whose folder is archived has nobody to answer for it; both stand on their own.
    const loose = asked.filter((c) => !kidsOf.get(c.id)?.length && (!c.parent_id || !here.has(c.parent_id)));
    if (loose.length) out.push({ folder: null, kids: loose });
    return out;
  }, [asked]);

  const levelOf = (id: string): Exclude<Importance, 0> => (high.has(id) ? 3 : low.has(id) ? 1 : 2);
  const marks = useMemo(() => importanceMarks(asked, [...high], [...low]), [asked, high, low]);
  const affected = useQuery(() => importanceAffected(db, marks), [JSON.stringify([...marks])]);
  const folderRows = affected.filter((a) => groups.some((g) => g.folder?.id === a.row.id)).length;

  /** Step 1 offers everything; step 2 only what step 1 did not already claim. */
  const offered = (kids: Category[]) => (step === 0 ? kids : kids.filter((c) => !high.has(c.id)));
  const chosen = step === 0 ? high : low;
  const setChosen = step === 0 ? setHigh : setLow;
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleFolder = (kids: Category[]) => setChosen((s) => {
    const n = new Set(s);
    const full = kids.every((k) => n.has(k.id));
    for (const k of kids) { if (full) n.delete(k.id); else n.add(k.id); }
    return n;
  });
  /** On the last screen a row cycles: could not live without → in between → could stop → back. */
  const cycle = (id: string) => {
    const at = levelOf(id);
    setHigh((s) => { const n = new Set(s); n.delete(id); if (at === 1) n.add(id); return n; });
    setLow((s) => { const n = new Set(s); n.delete(id); if (at === 2) n.add(id); return n; });
  };

  const commit = () => {
    mutate((d) => applyImportance(d, marks));
    router.back();
  };

  const Check = ({ state }: { state: "full" | "half" | "off" }) => (
    <SymbolView name={state === "full" ? "checkmark.circle.fill" : state === "half" ? "minus.circle.fill" : "circle"} size={22}
      tintColor={state === "full" ? C.tint : C.tertiary} />
  );

  const picking = (
    <View>
      {groups.map(({ folder, kids }) => {
        const rows = offered(kids);
        if (!rows.length) return null;
        const full = rows.every((k) => chosen.has(k.id));
        const half = !full && rows.some((k) => chosen.has(k.id));
        return (
          <Card key={folder?.id ?? "loose"} style={styles.group}>
            {folder ? (
              <Pressable onPress={() => toggleFolder(rows)} style={[styles.row, styles.folderRow]} accessibilityRole="button"
                accessibilityLabel={t("category.importance.folderA11y", { name: catName(folder) })} accessibilityState={{ selected: full }}>
                <CategoryIcon name={catName(folder)} icon={folder.icon} color={folder.color} size={28} />
                <Text style={[styles.name, { fontWeight: "600" }]}>{catName(folder)} <Text style={styles.all}>{t("category.importance.all", { count: rows.length })}</Text></Text>
                <Check state={full ? "full" : half ? "half" : "off"} />
              </Pressable>
            ) : <Text style={styles.looseHead}>{t("category.importance.noFolder")}</Text>}
            {rows.map((c) => (
              <Pressable key={c.id} onPress={() => toggle(c.id)} style={[styles.row, folder ? styles.child : null]} accessibilityRole="button"
                accessibilityLabel={catName(c)} accessibilityState={{ selected: chosen.has(c.id) }}>
                <CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={26} />
                <Text style={styles.name}>{catName(c)}</Text>
                <Check state={chosen.has(c.id) ? "full" : "off"} />
              </Pressable>
            ))}
          </Card>
        );
      })}
      {step === 1 && groups.every(({ kids }) => !offered(kids).length) ? (
        <Text style={styles.none}>{t("category.importance.nothingLeft")}</Text>
      ) : null}
    </View>
  );

  const leaves = markableLeaves(asked);
  const review = (
    <View>
      {([3, 2, 1] as const).map((level) => {
        const rows = leaves.filter((c) => levelOf(c.id) === level);
        return (
          <View key={level}>
            <Text style={[styles.levelHead, { color: LEVEL_TINT[level] }]}>{levelTitle(level)} · {rows.length}</Text>
            {rows.length ? (
              <Card style={styles.group}>
                {rows.map((c) => (
                  <Pressable key={c.id} onPress={() => cycle(c.id)} style={styles.row} accessibilityRole="button"
                    accessibilityLabel={t("category.importance.rowA11y", { name: catName(c), level: levelTitle(level) })}>
                    <CategoryIcon name={catName(c)} icon={c.icon} color={c.color} size={26} />
                    <Text style={styles.name}>{catName(c)}</Text>
                    <SymbolView name="arrow.triangle.2.circlepath" size={13} tintColor={C.tertiary} />
                  </Pressable>
                ))}
              </Card>
            ) : <Text style={styles.emptyLevel}>{t("category.importance.none")}</Text>}
          </View>
        );
      })}
      <Text style={styles.foot}>
        {affected.length ? t("category.importance.changes", { count: affected.length }) : t("category.importance.noChanges")}
        {folderRows ? ` · ${t("category.importance.folders", { count: folderRows })}` : ""}
      </Text>
    </View>
  );

  const nextLabel = step < 2 ? t("common.next") : affected.length ? t("category.importance.mark", { count: affected.length }) : t("category.importance.nothingToChange");
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("category.importance.title")}
        left={step === 0 ? { label: t("common.cancel"), onPress: () => router.back() } : { label: t("common.back"), onPress: () => setStep((s) => s - 1) }} />
      {leaves.length ? (
        <FlatList
          data={[0]}
          keyExtractor={() => "body"}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListHeaderComponent={
            <View style={styles.head}>
              <Text style={styles.step}>{t("category.importance.step", { step: step + 1, total: 3 })}</Text>
              <Text style={styles.question}>{steps()[step]!.title}</Text>
              <Text style={styles.hint}>{steps()[step]!.hint}</Text>
            </View>
          }
          renderItem={() => (step === 2 ? review : picking)}
        />
      ) : (
        <Empty title={t("category.importance.empty.title")} hint={t("category.importance.empty.hint")} />
      )}
      {leaves.length ? (
        <View style={styles.bar}>
          <BigButton label={nextLabel} onPress={() => (step < 2 ? setStep((s) => s + 1) : commit())} disabled={step === 2 && !affected.length} />
        </View>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  head: { paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.sm },
  step: { fontSize: 13, color: C.tertiary, fontWeight: "600" },
  question: { fontSize: 22, fontWeight: "700", color: C.label, paddingTop: 2 },
  hint: { fontSize: 14, color: C.secondary, paddingTop: 6, lineHeight: 19 },
  group: { marginHorizontal: S.lg, marginBottom: S.sm, borderRadius: R.card, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.md, minHeight: 46 },
  folderRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.separator, paddingBottom: 6, marginBottom: 2 },
  child: { paddingLeft: S.md + 14 },
  name: { flex: 1, fontSize: 16, color: C.label },
  all: { fontSize: 13, color: C.secondary, fontWeight: "400" },
  looseHead: { fontSize: 13, color: C.tertiary, fontWeight: "600", paddingHorizontal: S.md, paddingTop: 4, paddingBottom: 2 },
  levelHead: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: 6 },
  emptyLevel: { fontSize: 14, color: C.tertiary, paddingHorizontal: S.xl, paddingBottom: S.sm },
  none: { color: C.tertiary, fontSize: 15, textAlign: "center", paddingHorizontal: S.xl, paddingVertical: S.xxl },
  foot: { fontSize: 13, color: C.secondary, paddingHorizontal: S.xl, paddingTop: S.lg, lineHeight: 18 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: S.xxl, paddingTop: S.sm, backgroundColor: C.bgGrouped },
}));
