import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { INSIGHT_KINDS, createInsight, formatMinor, getRow, listRows, parseInsightParams, remove, save, subscriptionsPerYear, templateFromTransaction, type Insight, type InsightKind, type InsightParams, type RecurringRule } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, DeleteRow, ModalHeader, Row, SectionHeader, Segmented, ToggleRow } from "@/components/ui";
import { InsightCard } from "@/components/InsightCard";
import { C, S, themed, themeTone } from "@/constants/theme";
import { INSIGHT_GROUPS, INSIGHT_LOOK, addableKinds, kindsIn, kindHint, kindTitle, perPeriod, ruleTitle } from "@/lib/insights";
import { catName, acctName } from "@/lib/names";
import { t } from "@/i18n";
import { useDirty, useDiscardGuard } from "@/lib/discard";

/**
 * Pick a kind — grouped by what it is about, so twelve cards are three short lists rather than one
 * long one — then fill in its settings, each opening the matching picker. What the card will show is
 * drawn underneath as it is set up (`InsightCard` in preview), and a setting it cannot do without is
 * marked until it is given.
 */
export default function InsightEdit() {
  const { id, kind: presetKind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const existing = id === "new" ? null : (getRow(db, "insights", id) as Insight | undefined) ?? null;
  const [kind, setKind] = useState<InsightKind | null>(existing?.kind ?? (presetKind as InsightKind) ?? null);
  const [p, setP] = useState<InsightParams>(() => (existing ? parseInsightParams(existing.params) : {}));
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([kind, p]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
  const names = useQuery((d) => ({ accounts: new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a])), categories: new Map(listRows(d, "categories", "1=1").map((c) => [c.id, catName(c)])), tags: new Map(listRows(d, "tags", "1=1").map((x) => [x.id, x.name])) }));
  const subs = useQuery((d) => subscriptionsPerYear(d).lines);
  // The recurring expenses a payments checklist can wait for; one paid only when needed is unticked.
  const expenseRules = useQuery((d) => listRows(d, "recurring_rules", "deleted=0 AND active=1 AND amount_minor<0", [], "next_date") as RecurringRule[]);
  const others = useQuery((d) => (listRows(d, "insights", "deleted=0") as Insight[]).filter((i) => i.id !== existing?.id));
  const kinds = addableKinds(others);
  const excluded = new Set(p.exclude_rule_ids ?? []);
  const toggleRule = (id: string) => setP((s) => { const ex = new Set(s.exclude_rule_ids ?? []); if (ex.has(id)) ex.delete(id); else ex.add(id); return { ...s, exclude_rule_ids: [...ex] }; });
  const keys = useMemo(() => ({ title: newPickKey("ititle"), acc: newPickKey("iacc"), target: newPickKey("itarget"), monthly: newPickKey("imonthly"), months: newPickKey("imonths"), cats: newPickKey("icats"), tx: newPickKey("itx"), ctags: newPickKey("ictags") }), []);
  // The category whose tags the tag picker was opened for (one picker key serves every category).
  const tagsFor = useRef<string | null>(null);
  usePickResult<string[]>(keys.ctags, useCallback((v: string[]) => {
    const cid = tagsFor.current; if (!cid) return;
    setP((s) => { const ct = { ...(s.category_tags ?? {}) }; if (v.length) ct[cid] = v; else delete ct[cid]; return { ...s, category_tags: Object.keys(ct).length ? ct : undefined }; });
  }, []));
  usePickResult<string>(keys.title, useCallback((v: string) => setP((s) => ({ ...s, title: v || undefined })), []));
  usePickResult<string>(keys.acc, useCallback((v: string) => setP((s) => ({ ...s, account_id: v })), []));
  usePickResult<number>(keys.target, useCallback((v: number) => setP((s) => ({ ...s, target_minor: v })), []));
  usePickResult<number>(keys.monthly, useCallback((v: number) => setP((s) => ({ ...s, monthly_minor: v })), []));
  usePickResult<string>(keys.months, useCallback((v: string) => setP((s) => ({ ...s, months: Number(v) })), []));
  // Tags chosen for a category that is no longer on the list go with it.
  usePickResult<string[]>(keys.cats, useCallback((v: string[]) => setP((s) => {
    const ids = v.filter((x) => x !== "none");
    const ct = Object.fromEntries(Object.entries(s.category_tags ?? {}).filter(([k]) => ids.includes(k)));
    return { ...s, category_ids: ids, category_tags: Object.keys(ct).length ? ct : undefined };
  }), []));
  usePickResult<string>(keys.tx, useCallback((txId: string) => { const tx = getRow(db, "transactions", txId); if (tx) setP((s) => ({ ...s, templates: [...(s.templates ?? []), templateFromTransaction(tx)] })); }, []));
  const kindName = kind ? kindTitle(kind) : "";
  const account = p.account_id ? names.accounts.get(p.account_id) : undefined;
  const currency = account?.currency ?? "EUR";
  const needsAccount = kind === "savings_goal" || kind === "account_balance" || kind === "safety_buffer";
  const needsTarget = kind === "savings_goal";
  // A card that could only ever say "Choose …" is not worth saving: the settings it cannot do without
  // are asked for before Save is offered, rather than on the card afterwards.
  const needsCategories = kind === "checklist" || kind === "regular";
  // A checklist of nothing but this period's recurring payments is a checklist too.
  const hasCategories = !!p.category_ids?.length || (kind === "checklist" && !!p.include_recurring);
  const valid = !!kind && (!needsAccount || !!p.account_id) && (!needsCategories || hasCategories) && (kind !== "upcoming" || !!p.templates?.length);
  const required = (missing: boolean) => (missing ? C.orange : undefined);
  const kindTone = themeTone(kind ? INSIGHT_LOOK[kind]?.color ?? "#8E8E93" : "#8E8E93");
  const commit = (k: InsightKind | null = kind, params: InsightParams = p) => {
    if (!k) return;
    mutate((d) => existing ? save(d, "insights", { ...existing, kind: k, params: JSON.stringify(params) }) : createInsight(d, { kind: k, params: JSON.stringify(params), sort: nextSort(d) }));
    leave();
  };
  const del = () => existing && Alert.alert(t("insights.edit.removeTitle"), undefined, [{ text: t("common.cancel"), style: "cancel" }, { text: t("insights.edit.remove"), style: "destructive", onPress: () => { mutate((d) => remove(d, "insights", existing.id)); leave(); } }]);
  const money = (minor?: number) => (minor != null ? `${formatMinor(minor, currency)} ${currency}` : t("insights.edit.notSet"));
  const catList = (p.category_ids ?? []).map((cid) => names.categories.get(cid) ?? "?").join(", ");

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={existing ? t("insights.edit.editTitle") : t("insights.edit.newTitle")} left={{ label: t("common.cancel"), onPress: () => router.back() }} right={{ label: t("common.save"), onPress: () => commit(), disabled: !valid }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {!kind ? (
          <>
            <Text style={styles.question}>{t("insights.edit.question")}</Text>
            {INSIGHT_GROUPS.map((g) => {
              const here = kindsIn(g.id, kinds);
              if (!here.length) return null;
              return (
                <View key={g.id}>
                  <SectionHeader>{t(`insights.edit.group.${g.id}`)}</SectionHeader>
                  <Card>{here.map((k, i) => <Row key={k.kind} icon={INSIGHT_LOOK[k.kind].icon} iconColor={INSIGHT_LOOK[k.kind].color} title={kindTitle(k.kind)} subtitle={kindHint(k.kind)}
                    onPress={() => (k.instant ? commit(k.kind, {}) : setKind(k.kind))} right={k.instant ? <Text style={styles.instant}>{t("insights.edit.addNow")}</Text> : undefined} style={i > 0 ? styles.divider : undefined} />)}</Card>
                </View>
              );
            })}
            {kinds.length < INSIGHT_KINDS.length ? <Text style={[styles.hint, { marginTop: S.sm }]}>{t("insights.edit.offeredOnce")}</Text> : null}
          </>
        ) : (
          <>
            <View style={styles.kindHead}>
              <View style={[styles.kindIcon, { backgroundColor: kindTone.fill }]}><SymbolView name={INSIGHT_LOOK[kind]?.icon ?? "sparkles"} size={20} tintColor={kindTone.glyph} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.kindTitle}>{kindName}</Text>
                <Text style={styles.kindHint}>{kindHint(kind)}</Text>
              </View>
            </View>
            <Card>
              <Row icon="textformat" iconColor="#8E8E93" title={t("insights.edit.title")} subtitle={p.title || t("insights.edit.defaultTitle", { title: kindName })} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.title, title: t("insights.edit.title"), value: p.title ?? "" } })} />
              {needsAccount ? <Row icon="creditcard" title={t("insights.edit.account")} subtitle={acctName(account) ?? t("insights.edit.required")} subtitleColor={required(!account)} onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.acc, selected: p.account_id ?? "" } })} style={styles.divider} /> : null}
              {needsTarget ? <Row icon="flag" iconColor="#34C759" title={t("insights.edit.target")} subtitle={money(p.target_minor)} onPress={() => router.push({ pathname: "/pick/amount", params: { key: keys.target, title: t("insights.edit.target"), currency, value: String(p.target_minor ?? "") } })} style={styles.divider} /> : null}
              {kind === "checklist" || kind === "regular" ? <Row icon="folder" iconColor="#FF9F0A" title={t("insights.edit.categories")} subtitle={catList || (kind === "checklist" && p.include_recurring ? t("insights.edit.none") : t("insights.edit.required"))} subtitleColor={required(!hasCategories)} onPress={() => router.push({ pathname: "/pick/categories", params: { key: keys.cats, selected: (p.category_ids ?? []).join(","), title: t("insights.edit.categories") } })} style={styles.divider} /> : null}
            </Card>
            {/* Each category is waited for once, or once per tag: one Insurance category paid for
                several people, each person a tag. */}
            {kind === "checklist" && p.category_ids?.length ? (
              <>
                <SectionHeader>{t("insights.edit.perTag.title")}</SectionHeader>
                <Card>
                  {p.category_ids.map((cid, i) => {
                    const tags = p.category_tags?.[cid] ?? [];
                    return <Row key={cid} icon="number" iconColor="#5E5CE6" title={names.categories.get(cid) ?? "?"}
                      subtitle={tags.length ? tags.map((x) => `#${names.tags.get(x) ?? "?"}`).join(" ") : t("insights.edit.perTag.once")}
                      onPress={() => { tagsFor.current = cid; router.push({ pathname: "/pick/tags", params: { key: keys.ctags, selected: tags.join(","), category: cid } }); }} style={i > 0 ? styles.divider : undefined} />;
                  })}
                </Card>
                <Text style={[styles.hint, { marginTop: S.sm }]}>{t("insights.edit.perTag.hint")}</Text>
              </>
            ) : null}
            {kind === "checklist" ? (
              <>
                <Card style={{ marginTop: S.md }}>
                  <ToggleRow icon="repeat" iconColor="#AF52DE" title={t("insights.edit.recurring.title")} subtitle={t("insights.edit.recurring.subtitle")}
                    value={!!p.include_recurring} onChange={(v) => setP((s) => ({ ...s, include_recurring: v || undefined }))} />
                  <ToggleRow icon="eye.slash" iconColor="#8E8E93" title={t("insights.edit.recurring.hideDone")} subtitle={t("insights.edit.recurring.hideDoneSubtitle")}
                    value={!!p.hide_done} onChange={(v) => setP((s) => ({ ...s, hide_done: v || undefined }))} style={styles.divider} />
                </Card>
                <SectionHeader>{t("insights.edit.recurring.sum")}</SectionHeader>
                <View style={{ paddingHorizontal: S.lg }}>
                  <Segmented<"left" | "total"> value={p.sum ?? "left"} onChange={(v) => setP((s) => ({ ...s, sum: v === "total" ? "total" : undefined }))}
                    options={[{ value: "left", label: t("insights.edit.recurring.sumLeft") }, { value: "total", label: t("insights.edit.recurring.sumTotal") }]} />
                </View>
              </>
            ) : null}
            {kind === "checklist" && p.include_recurring && expenseRules.length ? (
              <>
                <SectionHeader>{t("insights.edit.recurring.which")}</SectionHeader>
                <Card>
                  {expenseRules.map((r, i) => {
                    const cur = names.accounts.get(r.account_id)?.currency ?? "";
                    return <Row key={r.id} title={ruleTitle(r)} subtitle={t("insights.subscriptions.amountPer", { amount: `${formatMinor(Math.abs(r.amount_minor), cur)} ${cur}`, per: perPeriod(r.frequency, r.interval) })} onPress={() => toggleRule(r.id)} style={i > 0 ? styles.divider : undefined}
                      right={<SymbolView name={excluded.has(r.id) ? "circle" : "checkmark.circle.fill"} size={22} tintColor={excluded.has(r.id) ? C.tertiary : C.tint} />} />;
                  })}
                </Card>
                <Text style={[styles.hint, { marginTop: S.sm }]}>{t("insights.edit.recurring.whichHint")}</Text>
              </>
            ) : null}
            {kind === "regular" ? <View style={{ paddingHorizontal: S.lg, marginTop: S.md }}><Segmented<"weekly" | "monthly"> value={p.frequency ?? "monthly"} onChange={(v) => setP((s) => ({ ...s, frequency: v }))} options={[{ value: "weekly", label: t("insights.edit.perWeek") }, { value: "monthly", label: t("insights.edit.perMonth") }]} /></View> : null}
            {/* How long you want to be able to go on paying for the essentials. The amount is not
                asked for: the whole point of this card is that the target is computed. */}
            {kind === "safety_buffer" ? (
              <>
                <SectionHeader>{t("insights.edit.monthsToCover")}</SectionHeader>
                <View style={{ paddingHorizontal: S.lg }}>
                  <Segmented<"3" | "6" | "12"> value={String(p.months ?? 3) as "3" | "6" | "12"} onChange={(v) => setP((s) => ({ ...s, months: Number(v) }))}
                    options={[{ value: "3", label: t("insights.months", { count: 3 }) }, { value: "6", label: t("insights.months", { count: 6 }) }, { value: "12", label: t("insights.months", { count: 12 }) }]} />
                </View>
              </>
            ) : null}
            {kind === "subscriptions" ? (
              <>
                <SectionHeader>{t("insights.edit.includedRules")}</SectionHeader>
                <Card>
                  {subs.map((l, i) => (
                    <Row key={l.rule.id} title={ruleTitle(l.rule)} subtitle={t("insights.edit.ruleLine", { amount: `${formatMinor(Math.abs(l.rule.amount_minor), l.currency)} ${l.currency}`, per: perPeriod(l.rule.frequency, l.rule.interval), yearly: `${formatMinor(l.yearly_minor, l.currency)} ${l.currency}` })} onPress={() => toggleRule(l.rule.id)} style={i > 0 ? styles.divider : undefined}
                      right={<SymbolView name={excluded.has(l.rule.id) ? "circle" : "checkmark.circle.fill"} size={22} tintColor={excluded.has(l.rule.id) ? C.tertiary : C.tint} />} />
                  ))}
                  {subs.length === 0 ? <Row title={t("insights.edit.noRules")} subtitle={t("insights.edit.noRulesHint")} /> : null}
                </Card>
              </>
            ) : null}
            {kind === "upcoming" ? (
              <>
                <SectionHeader>{t("insights.edit.payments")}</SectionHeader>
                <Card>
                  {(p.templates ?? []).map((tp, i) => (
                    <Row key={i} title={tp.notes || (tp.category_id ? names.categories.get(tp.category_id) : null) || t("insights.payment")} subtitle={`${formatMinor(Math.abs(tp.amount_minor), names.accounts.get(tp.account_id)?.currency ?? "")} ${names.accounts.get(tp.account_id)?.currency ?? ""}${tp.category_id ? ` · ${names.categories.get(tp.category_id)}` : ""}${tp.tag_ids.length ? ` · ${tp.tag_ids.map((id) => `#${names.tags.get(id) ?? t("budgets.title.tag")}`).join(" ")}` : ""}`}
                      onPress={() => setP((s) => ({ ...s, templates: (s.templates ?? []).filter((_, j) => j !== i) }))} right={<Text style={styles.remove}>{t("insights.edit.remove")}</Text>} style={i > 0 ? styles.divider : undefined} />
                  ))}
                  <Row icon="plus.circle" title={t("insights.edit.addFromTx")} subtitle={t("insights.edit.addFromTxHint")} onPress={() => router.push({ pathname: "/pick/transaction", params: { key: keys.tx, title: t("insights.edit.whichPayment") } })} style={(p.templates?.length ?? 0) > 0 ? styles.divider : undefined} />
                </Card>
              </>
            ) : null}
            {/* The card as Save will add it, from the settings above as they are now. */}
            <SectionHeader>{t("insights.edit.preview")}</SectionHeader>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <InsightCard preview insight={{ ...(existing ?? { id: "preview", sort: 0, deleted: 0, updated_at: "", created_at: "" } as unknown as Insight), kind, params: JSON.stringify(p) }} />
            </View>
            {!existing ? <View style={{ marginTop: S.lg }}><Row title={t("insights.edit.changeType")} onPress={() => setKind(null)} style={{ backgroundColor: "transparent" }} /></View> : null}
            {existing ? <View style={{ marginTop: S.xl }}><DeleteRow label={t("insights.edit.removeInsight")} onPress={del} /></View> : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** After every card there is, so a new one lands last even when earlier ones were removed and the count no longer matches the highest `sort`. */
function nextSort(d: Parameters<typeof listRows>[0]): number {
  return (listRows(d, "insights", "deleted=0") as Insight[]).reduce((m, i) => Math.max(m, i.sort + 1), 0);
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.secondary, fontSize: 13, paddingHorizontal: S.xl },
  question: { color: C.label, fontSize: 22, fontWeight: "700", paddingHorizontal: S.xl, paddingTop: S.md },
  instant: { color: C.tint, fontSize: 15, fontWeight: "600" },
  kindHead: { flexDirection: "row", alignItems: "center", gap: S.md, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.md },
  kindIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  kindTitle: { color: C.label, fontSize: 20, fontWeight: "700" },
  kindHint: { color: C.secondary, fontSize: 14, marginTop: 2 },
  remove: { color: C.red, fontSize: 15 },
}));
