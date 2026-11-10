import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { SymbolView } from "expo-symbols";
import { createInsight, getMeta, getRow, setMeta, suggestInsights, type Insight, type InsightHint, type SqlDriver } from "@kopiyka/core";
import { mutate, useQuery } from "@/store";
import { Card, Chip, Row, SectionHeader, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { getPeriodStartDay } from "@/lib/period";
import { INSIGHT_LOOK, kindTitle } from "@/lib/insights";
import { acctName, catName } from "@/lib/names";
import { t } from "@/i18n";

/** The suggestions waved away (DATA.md rule 7): keys from `suggestInsights`. */
const KEY = "insight_hints_dismissed";

function dismissedHints(db: SqlDriver): string[] {
  let list: string[] = [];
  try { list = JSON.parse(getMeta(db, KEY) ?? "[]") as string[]; } catch { /* a broken value is no answer */ }
  // One TestFlight build kept the forecast's invitation under a key of its own.
  if (getMeta(db, "forecast_promo") === "dismissed" && !list.includes("forecast")) list.push("forecast");
  return list;
}

/**
 * Cards worth adding, from how you use the app (core `suggestInsights`), each with the reason in one
 * line and one tap to add it — or, for a card that needs one more answer (a goal's target), to the
 * editor with everything else filled in. The cross puts a suggestion away for good. A new person
 * sees a few more, as the way in; someone with cards already sees at most three.
 */
export function InsightHints({ insights }: { insights: Insight[] }) {
  const startDay = useQuery(() => getPeriodStartDay());
  const shape = insights.map((i) => `${i.kind}${i.params}`).join("|");
  const { hints, names } = useQuery((db) => {
    const list = suggestInsights(db, { today: todayLocal(), startDay, existing: insights, dismissed: dismissedHints(db) });
    // The account or category a reason names, as the app shows it.
    const named: Record<string, string> = {};
    for (const h of list) {
      if (!h.ref_id) continue;
      const a = getRow(db, "accounts", h.ref_id), c = a ? null : getRow(db, "categories", h.ref_id);
      named[h.ref_id] = a ? acctName(a) ?? "" : c ? catName(c) : "";
    }
    return { hints: list, names: named };
  }, [startDay, shape]);
  const shown = hints.slice(0, insights.length ? 3 : 5);
  if (!shown.length) return null;

  const add = (h: InsightHint) => {
    void Haptics.selectionAsync();
    if (h.setup) {
      router.push({ pathname: "/insight/edit", params: { id: "new", kind: h.kind, params: JSON.stringify(h.params) } });
      return;
    }
    // First in the list, where the eye already is.
    mutate((d) => {
      const first = d.get<{ s: number | null }>("SELECT MIN(sort) AS s FROM insights WHERE deleted=0")?.s ?? 0;
      createInsight(d, { kind: h.kind, params: JSON.stringify(h.params), sort: first - 1 });
    });
  };
  const dismiss = (h: InsightHint) => mutate((d) => setMeta(d, KEY, JSON.stringify([...new Set([...dismissedHints(d), h.key])])));

  return (
    <View>
      <SectionHeader>{insights.length ? t("insights.hints.title") : t("insights.hints.titleFirst")}</SectionHeader>
      <Card>
        {shown.map((h, i) => {
          const look = INSIGHT_LOOK[h.kind];
          const title = kindTitle(h.kind);
          return (
            <Row key={h.key} icon={look?.icon} iconColor={look?.color} title={title}
              subtitle={t(`insights.hints.why.${h.why}`, { count: h.count, name: h.ref_id ? names[h.ref_id] ?? "" : "" })}
              onPress={() => add(h)}
              right={
                <View style={styles.actions}>
                  <Chip compact label={h.setup ? t("insights.hints.setUp") : t("insights.hints.add")} onPress={() => add(h)} />
                  <Tap onPress={() => dismiss(h)} hitSlop={8} style={styles.dismiss} accessibilityRole="button" accessibilityLabel={t("insights.hints.dismissA11y", { title })}>
                    <SymbolView name="xmark" size={11} weight="semibold" tintColor={C.secondary} />
                  </Tap>
                </View>
              }
              style={i ? styles.divider : undefined} />
          );
        })}
      </Card>
      {!insights.length ? <Text style={styles.hint}>{t("insights.hints.more")}</Text> : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", gap: S.sm },
  dismiss: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.secondary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
}));
