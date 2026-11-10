import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatMinor, fromMinor, shareItems, toMinor, type ShareItem } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { ModalHeader, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";

type Line = { key: number; name: string; amount: string };

/** "12,50" and "12.50" are the same number; anything that is not a positive amount is none. */
function parseAmount(text: string, currency: string): number {
  const v = Number(text.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(v) && v > 0 ? toMinor(v, currency) : 0;
}

/**
 * What one friend had, line by line: the lamp, the beer. Resolves `ShareItem[]`.
 *
 * These are the things that were only theirs; the split screen adds them to the friend's equal share
 * of everything else, and their page and the reminder message quote them. A line without a name or
 * an amount is left out, so a half-typed row never becomes a debt.
 */
export default function PickItems() {
  const p = useLocalSearchParams<{ key: string; name: string; currency: string; items?: string }>();
  const currency = p.currency ?? "EUR";
  const [lines, setLines] = useState<Line[]>(() => {
    const start = shareItems(p.items).map((it, i) => ({ key: i, name: it.name, amount: String(fromMinor(it.amount_minor, currency)) }));
    return start.length ? start : [{ key: 0, name: "", amount: "" }];
  });
  const exit = useDiscardGuard(useDirty([lines.map((l) => [l.name, l.amount])]));
  const items = useMemo<ShareItem[]>(() => lines.map((l) => ({ name: l.name.trim(), amount_minor: parseAmount(l.amount, currency) }))
    .filter((it) => it.name && it.amount_minor > 0), [lines, currency]);
  const total = items.reduce((a, it) => a + it.amount_minor, 0);
  const edit = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, { key: Math.max(...ls.map((l) => l.key)) + 1, name: "", amount: "" }]);
  const done = () => exit(() => { resolvePick(p.key, items); router.back(); });

  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      <ModalHeader title={t("people.items.title", { name: p.name ?? "" })} left={{ label: t("common.cancel"), onPress: () => router.back() }}
        right={{ label: t("people.items.done"), onPress: done }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text style={styles.intro}>{t("people.items.intro")}</Text>
        <View style={styles.card}>
          {lines.map((l, i) => (
            <View key={l.key} style={[styles.row, i > 0 && styles.divider]}>
              <TextInput value={l.name} onChangeText={(name) => edit(l.key, { name })} placeholder={t("people.items.name")} placeholderTextColor={C.tertiary}
                style={styles.name} autoFocus={i === lines.length - 1 && !l.name} returnKeyType="next" accessibilityLabel={t("people.items.name")} />
              <TextInput value={l.amount} onChangeText={(amount) => edit(l.key, { amount })} placeholder={t("people.items.amount")} placeholderTextColor={C.tertiary}
                style={styles.amount} keyboardType="decimal-pad" accessibilityLabel={t("people.items.amount")} />
              <Tap onPress={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [{ key: l.key + 1, name: "", amount: "" }]))} hitSlop={12}
                accessibilityRole="button" accessibilityLabel={t("common.delete")}>
                <SymbolView name="minus.circle.fill" size={20} tintColor={C.tertiary} />
              </Tap>
            </View>
          ))}
          <Tap onPress={add} style={[styles.row, styles.divider]} accessibilityRole="button">
            <SymbolView name="plus.circle.fill" size={20} tintColor={C.tint} />
            <Text style={styles.addText}>{t("people.items.add")}</Text>
          </Tap>
        </View>
        {total ? <Text style={styles.total}>{t("people.items.total", { amount: `${formatMinor(total, currency)} ${currency}` })}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  content: { padding: S.md, gap: S.md },
  intro: { fontSize: 14, lineHeight: 19, color: C.secondary, paddingHorizontal: S.xs },
  card: { backgroundColor: C.card, borderRadius: 16, paddingHorizontal: S.md },
  row: { flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 52 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  name: { flex: 1, fontSize: 17, color: C.label, minHeight: 44 },
  amount: { width: 96, fontSize: 17, color: C.label, textAlign: "right", fontVariant: ["tabular-nums"], minHeight: 44 },
  addText: { fontSize: 16, fontWeight: "600", color: C.tint },
  total: { fontSize: 13, color: C.secondary, textAlign: "center", fontVariant: ["tabular-nums"] },
}));
