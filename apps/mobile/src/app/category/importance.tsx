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
import { C, R, S } from "@/constants/theme";

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

const STEPS = [
  {
    title: "Which could you not live without?",
    hint: "If the money got tight, these are the ones you would still be paying. The roof, the food, the bills with consequences.",
  },
  {
    title: "Which could you stop tomorrow?",
    hint: "From what is left. Nothing breaks if these stop — you would miss them, and that is all.",
  },
  {
    title: "Everything else is in between",
    hint: "The third answer is what was left over rather than a box anyone ticked. Tap any category to move it.",
  },
] as const;

const LEVEL_TITLE: Record<Exclude<Importance, 0>, string> = { 3: "Could not live without", 2: "In between", 1: "Could stop tomorrow" };
const LEVEL_TINT: Record<Exclude<Importance, 0>, ColorValue> = { 3: C.green, 2: C.secondary, 1: C.orange };

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
                accessibilityLabel={`${folder.name} folder`} accessibilityState={{ selected: full }}>
                <CategoryIcon name={folder.name} icon={folder.icon} color={folder.color} size={28} />
                <Text style={[styles.name, { fontWeight: "600" }]}>{folder.name} <Text style={styles.all}>· all {rows.length}</Text></Text>
                <Check state={full ? "full" : half ? "half" : "off"} />
              </Pressable>
            ) : <Text style={styles.looseHead}>No folder</Text>}
            {rows.map((c) => (
              <Pressable key={c.id} onPress={() => toggle(c.id)} style={[styles.row, folder ? styles.child : null]} accessibilityRole="button"
                accessibilityLabel={c.name} accessibilityState={{ selected: chosen.has(c.id) }}>
                <CategoryIcon name={c.name} icon={c.icon} color={c.color} size={26} />
                <Text style={styles.name}>{c.name}</Text>
                <Check state={chosen.has(c.id) ? "full" : "off"} />
              </Pressable>
            ))}
          </Card>
        );
      })}
      {step === 1 && groups.every(({ kids }) => !offered(kids).length) ? (
        <Text style={styles.none}>Nothing left to ask about — the first question took everything.</Text>
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
            <Text style={[styles.levelHead, { color: LEVEL_TINT[level] }]}>{LEVEL_TITLE[level]} · {rows.length}</Text>
            {rows.length ? (
              <Card style={styles.group}>
                {rows.map((c) => (
                  <Pressable key={c.id} onPress={() => cycle(c.id)} style={styles.row} accessibilityRole="button"
                    accessibilityLabel={`${c.name}, ${LEVEL_TITLE[level]}. Tap to move.`}>
                    <CategoryIcon name={c.name} icon={c.icon} color={c.color} size={26} />
                    <Text style={styles.name}>{c.name}</Text>
                    <SymbolView name="arrow.triangle.2.circlepath" size={13} tintColor={C.tertiary} />
                  </Pressable>
                ))}
              </Card>
            ) : <Text style={styles.emptyLevel}>None.</Text>}
          </View>
        );
      })}
      <Text style={styles.foot}>
        {affected.length ? `${affected.length} ${affected.length === 1 ? "row changes" : "rows change"}` : "Nothing changes: they already say this"}
        {folderRows ? ` · ${folderRows === 1 ? "one folder answers" : `${folderRows} folders answer`} for what is inside, so anything added to them later is already marked` : ""}
      </Text>
    </View>
  );

  const nextLabel = step < 2 ? "Next" : affected.length ? `Mark ${affected.length} ${affected.length === 1 ? "row" : "rows"}` : "Nothing to change";
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title="Set what matters"
        left={step === 0 ? { label: "Cancel", onPress: () => router.back() } : { label: "Back", onPress: () => setStep((s) => s - 1) }} />
      {leaves.length ? (
        <FlatList
          data={[0]}
          keyExtractor={() => "body"}
          contentContainerStyle={{ paddingBottom: 140 }}
          ListHeaderComponent={
            <View style={styles.head}>
              <Text style={styles.step}>Step {step + 1} of 3</Text>
              <Text style={styles.question}>{STEPS[step]!.title}</Text>
              <Text style={styles.hint}>{STEPS[step]!.hint}</Text>
            </View>
          }
          renderItem={() => (step === 2 ? review : picking)}
        />
      ) : (
        <Empty title="No categories to mark" hint="Importance is asked about expense categories that are not archived. Add some first." />
      )}
      {leaves.length ? (
        <View style={styles.bar}>
          <BigButton label={nextLabel} onPress={() => (step < 2 ? setStep((s) => s + 1) : commit())} disabled={step === 2 && !affected.length} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
});
