import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { resolvePick } from "@/store/pick";
import { ButtonText, Money, PickerHeader, PickerList, Row, accountIcon, Tap } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { t } from "@/i18n";
import { acctName, groupName } from "@/lib/names";

type Side = "from" | "to";
type TransferPair = { from: string; to: string };

/**
 * Both accounts of a transfer, chosen in one place. Two slots on top say which is which — the
 * account the money leaves and the one it arrives in — and the list below fills whichever slot is
 * selected. Choosing the account the other slot already holds swaps the two rather than refusing,
 * so turning a transfer round, or changing both sides, is never more than a tap or two; the swap
 * button does the same in one.
 *
 * Nothing reaches the transfer sheet until Done, which waits for two different accounts; swiping the
 * sheet away leaves the transfer as it was. Resolves `{ from, to }`.
 */
export default function PickTransferAccounts() {
  const p = useLocalSearchParams<{ key: string; from?: string; to?: string; focus?: Side }>();
  const [pair, setPair] = useState<Record<Side, string>>({ from: p.from ?? "", to: p.to ?? "" });
  const [focus, setFocus] = useState<Side>(p.focus ?? (!p.from ? "from" : !p.to ? "to" : "from"));
  // Live accounts, plus an archived one this transfer already uses (as the transfer sheet does).
  const keep = [p.from ?? "", p.to ?? ""];
  const accounts = useQuery((db) => listRows(db, "accounts", "deleted=0 AND (archived=0 OR id IN (?, ?))", keep, "sort, name")
    .map((a) => ({ ...a, balance: accountBalanceMinor(db, a.id) })), keep);
  const byId = (id: string) => accounts.find((a) => a.id === id);
  const other = (s: Side): Side => (s === "from" ? "to" : "from");

  const choose = (id: string) => {
    const o = other(focus);
    // The other side's account: the two change places instead of making a transfer to itself.
    const next = pair[o] === id ? { [focus]: id, [o]: pair[focus] } as Record<Side, string> : { ...pair, [focus]: id };
    setPair(next);
    // The next empty slot is the obvious next question.
    if (!next[o]) setFocus(o);
  };
  const swap = () => { setPair((cur) => ({ from: cur.to, to: cur.from })); setFocus(other); };
  const ready = !!pair.from && !!pair.to && pair.from !== pair.to;
  const done = () => { if (!ready) return; resolvePick(p.key, pair satisfies TransferPair); router.back(); };

  const slot = (s: Side) => {
    const a = byId(pair[s]);
    const role = s === "from" ? t("transfer.from") : t("transfer.to");
    const active = focus === s;
    return (
      <Tap onPress={() => setFocus(s)} style={[styles.slot, active && styles.slotActive]} accessibilityRole="button" accessibilityState={{ selected: active }}
        accessibilityLabel={t("transfer.pickA11y", { role, account: a ? acctName(a) : t("transfer.chooseAccount") })}>
        <Text style={styles.slotRole}>{role}</Text>
        <ButtonText fit={1} style={[styles.slotName, !a && { color: active ? C.tint : C.tertiary }]}>{a ? acctName(a) : t("transfer.chooseAccount")}</ButtonText>
        {a ? <Text style={styles.slotCur}>{a.currency}</Text> : null}
      </Tap>
    );
  };

  return (
    <PickerList data={accounts} keyExtractor={(a) => a.id}
      header={
        <PickerHeader title={t("transfer.pickTitle")} done={{ onPress: done, disabled: !ready }}>
          <View style={styles.slots}>
            {slot("from")}
            <Tap onPress={swap} disabled={!pair.from && !pair.to} hitSlop={8} style={styles.swap} accessibilityRole="button" accessibilityLabel={t("transfer.swapA11y")}>
              <SymbolView name="arrow.left.arrow.right" size={14} tintColor={C.tint} />
            </Tap>
            {slot("to")}
          </View>
          <Text style={styles.hint}>{focus === "from" ? t("transfer.chooseFrom") : t("transfer.chooseTo")}</Text>
        </PickerHeader>
      }
      renderItem={({ item: a }) => {
        const side: Side | null = pair.from === a.id ? "from" : pair.to === a.id ? "to" : null;
        return (
          <Row title={acctName(a)} subtitle={groupName(a.group_name) || undefined} icon={accountIcon(a.type)} iconFill={a.color} style={{ backgroundColor: "transparent" }}
            badge={side ? (side === "from" ? t("transfer.from") : t("transfer.to")) : undefined}
            onPress={() => choose(a.id)}
            right={<Money minor={a.balance} currency={a.currency} style={{ color: C.secondary, fontSize: 15 }} />} />
        );
      }} />
  );
}

const styles = themed(() => StyleSheet.create({
  slots: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.lg, marginTop: S.sm },
  slot: { flex: 1, minWidth: 0, backgroundColor: C.card, borderRadius: 14, padding: S.md, borderWidth: 2, borderColor: "transparent", gap: 2 },
  slotActive: { borderColor: C.tint },
  slotRole: { color: C.secondary, fontSize: 13 },
  slotName: { color: C.label, fontSize: 17, fontWeight: "600" },
  slotCur: { color: C.tertiary, fontSize: 12 },
  swap: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  hint: { color: C.secondary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
}));
