import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Money, Row, ScreenNote, SectionHeader, accountIcon, Empty } from "@/components/ui";
import { NetWorth } from "@/components/AccountsSummary";
import { C } from "@/constants/theme";
import { getCurrentAccount } from "@/lib/settings";

export default function AccountsSettings() {
  const data = useQuery((db) => {
    const current = getCurrentAccount();
    const accounts = listRows(db, "accounts", "deleted=0", [], "archived, sort, name").map((a) => ({ ...a, balance: accountBalanceMinor(db, a.id), type: a.id === current ? `${a.type} · current` : a.type }));
    const nw = new Map<string, number>();
    for (const a of accounts) if (!a.archived && a.include_in_net_worth) nw.set(a.currency, (nw.get(a.currency) ?? 0) + a.balance);
    return { accounts, totals: [...nw].map(([currency, minor]) => ({ currency, minor })) };
  });
  const groups = new Map<string, typeof data.accounts>();
  for (const a of data.accounts.filter((a) => !a.archived)) (groups.get(a.group_name) ?? groups.set(a.group_name, []).get(a.group_name)!).push(a);
  const archived = data.accounts.filter((a) => a.archived);
  return (
    <>
      <Stack.Screen options={{ title: "Accounts", headerRight: () => <Pressable onPress={() => router.push({ pathname: "/account/edit", params: { id: "new" } })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Add"><SymbolView name="plus" size={20} tintColor={C.tint} /></Pressable> }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <ScreenNote>An account is somewhere money sits: cash, a card, a bank account. Every transaction belongs to one, balances and net worth are added up from them, and a group (“Personal”, “Business”) is how the app is scoped to a subset of them.</ScreenNote>
        {data.accounts.length ? <NetWorth totals={data.totals} /> : <Empty title="No accounts yet" hint="Tap + to add one, or restore a backup in Settings." />}
        {[...groups].map(([group, accounts]) => (
          <SectionGroup key={group} title={group || "Accounts"} accounts={accounts} />
        ))}
        {archived.length ? <SectionGroup title="Archived" accounts={archived} disabled /> : null}
      </ScrollView>
    </>
  );
}

function SectionGroup({ title, accounts, disabled }: { title: string; accounts: { id: string; name: string; type: string; currency: string; balance: number; color: string | null }[]; disabled?: boolean }) {
  return (
    <>
      <SectionHeader right={accounts.length > 1 ? <GroupTotal accounts={accounts} /> : undefined}>{title}</SectionHeader>
      <Card>
        {accounts.map((a, i) => (
          <Row key={a.id} title={a.name} subtitle={disabled ? `${a.type} · archived` : a.type} icon={accountIcon(a.type)} iconColor={a.color ?? undefined}
            right={<Money minor={a.balance} currency={a.currency} />} onPress={() => router.push({ pathname: "/accounts/[id]", params: { id: a.id } })}
            style={[i > 0 ? styles.divider : undefined, disabled && styles.disabled]} />
        ))}
      </Card>
    </>
  );
}

/** Per-currency sum for a group's header row; currencies are never added together (see NetWorth). */
function GroupTotal({ accounts }: { accounts: { balance: number; currency: string }[] }) {
  const totals = new Map<string, number>();
  for (const a of accounts) totals.set(a.currency, (totals.get(a.currency) ?? 0) + a.balance);
  const entries = [...totals];
  const shown = entries.slice(0, 2);
  const extra = entries.length - shown.length;
  return (
    <View style={styles.total}>
      {shown.map(([currency, minor], i) => (
        <View key={currency} style={styles.totalItem}>
          {i > 0 ? <Text style={styles.totalSep}>·</Text> : null}
          <Money minor={minor} currency={currency} style={styles.totalMoney} />
        </View>
      ))}
      {extra > 0 ? <Text style={styles.totalSep}>+{extra}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }, disabled: { opacity: 0.45 },
  total: { flexDirection: "row", alignItems: "center", gap: 4 },
  totalItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  totalSep: { color: C.tertiary, fontSize: 13 },
  totalMoney: { fontSize: 13, fontWeight: "500", color: C.secondary },
});
