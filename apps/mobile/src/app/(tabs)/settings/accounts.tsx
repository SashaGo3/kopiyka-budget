import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack, router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { accountBalanceMinor, listRows } from "@kopiyka/core";
import { useQuery } from "@/store";
import { Card, Money, Row, ScreenNote, SectionHeader, accountIcon, Empty } from "@/components/ui";
import { NetWorth } from "@/components/AccountsSummary";
import { C, themed } from "@/constants/theme";
import { getCurrentAccount } from "@/lib/settings";
import { t } from "@/i18n";
import { acctName, groupName } from "@/lib/names";

const TYPES = ["cash", "bank", "card", "investment", "savings", "other"] as const;
/** "Card", "Готівка": an account's type as shown; anything unknown reads as Other. */
const typeLabel = (type: string) => t(`settingsLists.accounts.type.${(TYPES as readonly string[]).includes(type) ? (type as (typeof TYPES)[number]) : "other"}`);

export default function AccountsSettings() {
  const data = useQuery((db) => {
    const current = getCurrentAccount();
    const accounts = listRows(db, "accounts", "deleted=0", [], "archived, sort, name").map((a) => ({ ...a, balance: accountBalanceMinor(db, a.id), label: a.id === current ? t("settingsLists.accounts.current", { type: typeLabel(a.type) }) : typeLabel(a.type) }));
    const nw = new Map<string, number>();
    for (const a of accounts) if (!a.archived && a.include_in_net_worth) nw.set(a.currency, (nw.get(a.currency) ?? 0) + a.balance);
    return { accounts, totals: [...nw].map(([currency, minor]) => ({ currency, minor })) };
  });
  const groups = new Map<string, typeof data.accounts>();
  for (const a of data.accounts.filter((a) => !a.archived)) (groups.get(a.group_name) ?? groups.set(a.group_name, []).get(a.group_name)!).push(a);
  const archived = data.accounts.filter((a) => a.archived);
  return (
    <>
      <Stack.Screen options={{ title: t("settingsLists.accounts.title"), headerRight: () => <Pressable onPress={() => router.push({ pathname: "/account/edit", params: { id: "new" } })} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("settingsLists.accounts.add")}><SymbolView name="plus" size={20} tintColor={C.tint} /></Pressable> }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 180 }}>
        <ScreenNote more={t("settingsLists.accounts.introMore")}>{t("settingsLists.accounts.introShort")}</ScreenNote>
        {data.accounts.length ? <NetWorth totals={data.totals} /> : <Empty title={t("settingsLists.accounts.emptyTitle")} hint={t("settingsLists.accounts.emptyHint")} />}
        {[...groups].map(([group, accounts]) => (
          <SectionGroup key={group} title={groupName(group) || t("settingsLists.accounts.group")} accounts={accounts} />
        ))}
        {archived.length ? <SectionGroup title={t("settingsLists.accounts.archived")} accounts={archived} disabled /> : null}
      </ScrollView>
    </>
  );
}

function SectionGroup({ title, accounts, disabled }: { title: string; accounts: { id: string; name: string; type: string; label: string; currency: string; balance: number; color: string | null }[]; disabled?: boolean }) {
  return (
    <>
      <SectionHeader right={accounts.length > 1 ? <GroupTotal accounts={accounts} /> : undefined}>{title}</SectionHeader>
      <Card>
        {accounts.map((a, i) => (
          <Row key={a.id} title={acctName(a)} subtitle={disabled ? t("settingsLists.accounts.archivedType", { type: typeLabel(a.type) }) : a.label} icon={accountIcon(a.type)} iconFill={a.color}
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

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator }, disabled: { opacity: 0.45 },
  total: { flexDirection: "row", alignItems: "center", gap: 4 },
  totalItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  totalSep: { color: C.tertiary, fontSize: 13 },
  totalMoney: { fontSize: 13, fontWeight: "500", color: C.secondary },
}));
