import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { INSIGHT_KINDS, createInsight, formatMinor, getRow, listRows, parseInsightParams, remove, save, subscriptionsPerYear, templateFromTransaction, type Insight, type InsightKind, type InsightParams } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, DeleteRow, ModalHeader, Row, SectionHeader, Segmented } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { INSIGHT_LOOK, addableKinds } from "@/lib/insights";

/** Pick a kind, then fill in its parameters; each one opens the matching picker sheet. */
export default function InsightEdit() {
  const { id, kind: presetKind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const existing = id === "new" ? null : (getRow(db, "insights", id) as Insight | undefined) ?? null;
  const [kind, setKind] = useState<InsightKind | null>(existing?.kind ?? (presetKind as InsightKind) ?? null);
  const [p, setP] = useState<InsightParams>(() => (existing ? parseInsightParams(existing.params) : {}));
  const names = useQuery((d) => ({ accounts: new Map(listRows(d, "accounts", "1=1").map((a) => [a.id, a])), categories: new Map(listRows(d, "categories", "1=1").map((c) => [c.id, c.name])), tags: new Map(listRows(d, "tags", "1=1").map((t) => [t.id, t.name])) }));
  const subs = useQuery((d) => subscriptionsPerYear(d).lines);
  const others = useQuery((d) => (listRows(d, "insights", "deleted=0") as Insight[]).filter((i) => i.id !== existing?.id));
  const kinds = addableKinds(others);
  const excluded = new Set(p.exclude_rule_ids ?? []);
  const toggleRule = (id: string) => setP((s) => { const ex = new Set(s.exclude_rule_ids ?? []); if (ex.has(id)) ex.delete(id); else ex.add(id); return { ...s, exclude_rule_ids: [...ex] }; });
  const keys = useMemo(() => ({ title: newPickKey("ititle"), acc: newPickKey("iacc"), target: newPickKey("itarget"), monthly: newPickKey("imonthly"), months: newPickKey("imonths"), cats: newPickKey("icats"), tx: newPickKey("itx") }), []);
  usePickResult<string>(keys.title, useCallback((v: string) => setP((s) => ({ ...s, title: v || undefined })), []));
  usePickResult<string>(keys.acc, useCallback((v: string) => setP((s) => ({ ...s, account_id: v })), []));
  usePickResult<number>(keys.target, useCallback((v: number) => setP((s) => ({ ...s, target_minor: v })), []));
  usePickResult<number>(keys.monthly, useCallback((v: number) => setP((s) => ({ ...s, monthly_minor: v })), []));
  usePickResult<string>(keys.months, useCallback((v: string) => setP((s) => ({ ...s, months: Number(v) })), []));
  usePickResult<string[]>(keys.cats, useCallback((v: string[]) => setP((s) => ({ ...s, category_ids: v.filter((x) => x !== "none") })), []));
  usePickResult<string>(keys.tx, useCallback((txId: string) => { const t = getRow(db, "transactions", txId); if (t) setP((s) => ({ ...s, templates: [...(s.templates ?? []), templateFromTransaction(t)] })); }, []));
  const meta = INSIGHT_KINDS.find((k) => k.kind === kind);
  const account = p.account_id ? names.accounts.get(p.account_id) : undefined;
  const currency = account?.currency ?? "EUR";
  const needsAccount = kind === "savings_goal" || kind === "account_balance" || kind === "safety_buffer";
  const needsTarget = kind === "savings_goal";
  // A card that could only ever say "Choose …" is not worth saving: the settings it cannot do without
  // are asked for before Save is offered, rather than on the card afterwards.
  const needsCategories = kind === "checklist" || kind === "regular";
  const valid = !!kind && (!needsAccount || !!p.account_id) && (!needsCategories || !!p.category_ids?.length) && (kind !== "upcoming" || !!p.templates?.length);
  const commit = (k: InsightKind | null = kind, params: InsightParams = p) => {
    if (!k) return;
    mutate((d) => existing ? save(d, "insights", { ...existing, kind: k, params: JSON.stringify(params) }) : createInsight(d, { kind: k, params: JSON.stringify(params), sort: nextSort(d) }));
    router.back();
  };
  const del = () => existing && Alert.alert("Remove this insight?", undefined, [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => { mutate((d) => remove(d, "insights", existing.id)); router.back(); } }]);
  const money = (minor?: number) => (minor != null ? `${formatMinor(minor, currency)} ${currency}` : "Not set");
  const catList = (p.category_ids ?? []).map((cid) => names.categories.get(cid) ?? "?").join(", ");

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={existing ? "Edit insight" : "New insight"} left={{ label: "Cancel", onPress: () => router.back() }} right={{ label: "Save", onPress: () => commit(), disabled: !valid }} />
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {!kind ? (
          <>
            <SectionHeader>What do you want to see?</SectionHeader>
            <Card>{kinds.map((k, i) => <Row key={k.kind} icon={INSIGHT_LOOK[k.kind].icon} iconColor={INSIGHT_LOOK[k.kind].color} title={k.title} subtitle={k.hint} onPress={() => (k.instant ? commit(k.kind, {}) : setKind(k.kind))} style={i > 0 ? styles.divider : undefined} />)}</Card>
            {kinds.length < INSIGHT_KINDS.length ? <Text style={[styles.hint, { marginTop: S.sm }]}>Cards with nothing to set are offered once — the ones you already have are not listed again.</Text> : null}
          </>
        ) : (
          <>
            <SectionHeader>{meta?.title}</SectionHeader>
            <Text style={styles.hint}>{meta?.hint}</Text>
            <Card style={{ marginTop: S.sm }}>
              <Row icon="textformat" iconColor="#8E8E93" title="Title" subtitle={p.title || `Default: ${meta?.title}`} onPress={() => router.push({ pathname: "/pick/text", params: { key: keys.title, title: "Title", value: p.title ?? "" } })} />
              {needsAccount ? <Row icon="creditcard" title="Account" subtitle={account?.name ?? "Choose"} onPress={() => router.push({ pathname: "/pick/account", params: { key: keys.acc, selected: p.account_id ?? "" } })} style={styles.divider} /> : null}
              {needsTarget ? <Row icon="flag" iconColor="#34C759" title="Target" subtitle={money(p.target_minor)} onPress={() => router.push({ pathname: "/pick/amount", params: { key: keys.target, title: "Target", currency, value: String(p.target_minor ?? "") } })} style={styles.divider} /> : null}
              {kind === "checklist" || kind === "regular" ? <Row icon="folder" iconColor="#FF9F0A" title="Categories" subtitle={catList || "Choose"} onPress={() => router.push({ pathname: "/pick/categories", params: { key: keys.cats, selected: (p.category_ids ?? []).join(","), title: "Categories" } })} style={styles.divider} /> : null}
            </Card>
            {kind === "regular" ? <View style={{ paddingHorizontal: S.lg, marginTop: S.md }}><Segmented<"weekly" | "monthly"> value={p.frequency ?? "monthly"} onChange={(v) => setP((s) => ({ ...s, frequency: v }))} options={[{ value: "weekly", label: "Per week" }, { value: "monthly", label: "Per month" }]} /></View> : null}
            {/* How long you want to be able to go on paying for the essentials. The amount is not
                asked for: the whole point of this card is that the target is computed. */}
            {kind === "safety_buffer" ? (
              <>
                <SectionHeader>Months to cover</SectionHeader>
                <View style={{ paddingHorizontal: S.lg }}>
                  <Segmented<"3" | "6" | "12"> value={String(p.months ?? 3) as "3" | "6" | "12"} onChange={(v) => setP((s) => ({ ...s, months: Number(v) }))}
                    options={[{ value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }]} />
                </View>
              </>
            ) : null}
            {kind === "subscriptions" ? (
              <>
                <SectionHeader>Included rules</SectionHeader>
                <Card>
                  {subs.map((l, i) => (
                    <Row key={l.rule.id} title={l.title} subtitle={`${formatMinor(Math.abs(l.rule.amount_minor), l.currency)} ${l.currency} ${l.per_period} · ${formatMinor(l.yearly_minor, l.currency)} ${l.currency} per year`} onPress={() => toggleRule(l.rule.id)} style={i > 0 ? styles.divider : undefined}
                      right={<SymbolView name={excluded.has(l.rule.id) ? "circle" : "checkmark.circle.fill"} size={22} tintColor={excluded.has(l.rule.id) ? C.tertiary : C.tint} />} />
                  ))}
                  {subs.length === 0 ? <Row title="No active expense rules" subtitle="Add recurring rules first" /> : null}
                </Card>
              </>
            ) : null}
            {kind === "upcoming" ? (
              <>
                <SectionHeader>Payments</SectionHeader>
                <Card>
                  {(p.templates ?? []).map((t, i) => (
                    <Row key={i} title={t.notes || (t.category_id ? names.categories.get(t.category_id) : null) || "Payment"} subtitle={`${formatMinor(Math.abs(t.amount_minor), names.accounts.get(t.account_id)?.currency ?? "")} ${names.accounts.get(t.account_id)?.currency ?? ""}${t.category_id ? ` · ${names.categories.get(t.category_id)}` : ""}${t.tag_ids.length ? ` · ${t.tag_ids.map((id) => `#${names.tags.get(id) ?? "tag"}`).join(" ")}` : ""}`}
                      onPress={() => setP((s) => ({ ...s, templates: (s.templates ?? []).filter((_, j) => j !== i) }))} right={<Text style={styles.remove}>Remove</Text>} style={i > 0 ? styles.divider : undefined} />
                  ))}
                  <Row icon="plus.circle" title="Add from a transaction" subtitle="Matched by category, tags and note" onPress={() => router.push({ pathname: "/pick/transaction", params: { key: keys.tx, title: "Which payment repeats?" } })} style={(p.templates?.length ?? 0) > 0 ? styles.divider : undefined} />
                </Card>
              </>
            ) : null}
            {!existing ? <View style={{ marginTop: S.lg }}><Row title="Change type" onPress={() => setKind(null)} style={{ backgroundColor: "transparent" }} /></View> : null}
            {existing ? <View style={{ marginTop: S.xl }}><DeleteRow label="Remove insight" onPress={del} /></View> : null}
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

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl },
  remove: { color: C.red, fontSize: 15 },
});
