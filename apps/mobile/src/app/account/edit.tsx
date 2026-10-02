import { useCallback, useMemo, useState } from "react";
import { newPickKey, usePickResult } from "@/store/pick";
import { Alert, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { DEFAULT_ACCOUNT_GROUP, accountBalanceMinor, createAccount, formatMinor, getRow, remove, save, toMinor, fromMinor, type Account, type AccountType } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, SheetFrame, Subtle, Title, ChipRow, DeleteRow } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { currencyName } from "@/lib/currencies";
import { getCurrentAccount, setCurrentAccount } from "@/lib/settings";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { t } from "@/i18n";
import { acctName, groupName } from "@/lib/names";

const TYPES: AccountType[] = ["bank", "cash", "card", "savings", "investment", "other"];
const typeLabel = (v: AccountType) => t(`account.type.${v}`);

/**
 * New account: the keypad sets the opening balance. Existing account: the keypad shows the
 * balance as it is now and edits *that*; saving moves the opening balance by the difference,
 * so every transaction stays as it was. The prefilled number behaves like a selected value:
 * typing a digit replaces it, ⌫ and the operators work on it. Accounts are archived rather
 * than deleted (see `archive`).
 */
export default function AccountEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = id === "new" ? null : getRow(db, "accounts", id) ?? null;
  // A default name ("Main") is edited as it is shown, in the app's language; left alone, it goes
  // back as stored, so it keeps following the language (DATA.md rule 17).
  const shownName = existing ? acctName(existing) : null;
  const [name, setName] = useState(shownName ?? "");
  const [currency, setCurrency] = useState(existing?.currency ?? "PLN");
  const [type, setType] = useState<AccountType>(existing?.type ?? "bank");
  const [group, setGroup] = useState(existing?.group_name || DEFAULT_ACCOUNT_GROUP);   // an account always belongs to one
  const balanceNow = useMemo(() => (existing ? accountBalanceMinor(db, existing.id) : 0), [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [amount, setAmount] = useState(existing ? String(fromMinor(balanceNow, existing.currency)).replace("-", "−") : "");
  const [untouched, setUntouched] = useState(!!existing);
  const keys = useMemo(() => ({ name: newPickKey("aname"), group: newPickKey("agroup"), currency: newPickKey("acur") }), []);
  usePickResult<string>(keys.currency, useCallback((v: string) => setCurrency(v), []));
  usePickResult<string>(keys.name, useCallback((v: string) => setName(v), []));
  usePickResult<string>(keys.group, useCallback((v: string) => setGroup(v), []));
  const [inNet, setInNet] = useState(existing ? existing.include_in_net_worth === 1 : true);
  const [current, setCurrent] = useState(!!existing && getCurrentAccount() === existing.id);
  // Closing with changes asks first (lib/discard.ts); saving, deleting and converting leave through `leave`.
  const exit = useDiscardGuard(useDirty([name, currency, type, group, amount, inNet, current]));
  const leave = useCallback(() => exit(() => router.back()), [exit]);
  const value = evalExpr(amount.replace(/−/g, "-")) ?? 0;
  const valid = name.trim().length > 0;
  const nameToSave = () => (existing && name.trim() === shownName?.trim() ? existing.name : name.trim());

  // First digit typed into the prefilled balance replaces it; anything else (⌫, C, an operator) edits it.
  const onKeypad = (next: string) => {
    if (untouched) {
      setUntouched(false);
      const typed = next.length === amount.length + 1 && next.startsWith(amount) ? next.slice(-1) : null;
      if (typed && /[0-9.]/.test(typed)) { setAmount(typed === "." ? "0." : typed); return; }
    }
    setAmount(next);
  };
  const toggleSign = () => { setUntouched(false); setAmount((o) => (o.startsWith("−") ? o.slice(1) : "−" + o)); };

  const commit = () => {
    if (!valid) return;
    const saved = mutate((d) => {
      const opening = existing ? existing.opening_balance_minor + (toMinor(value, currency) - balanceNow) : toMinor(value, currency);
      const base = { name: nameToSave(), currency, type, group_name: group.trim() || DEFAULT_ACCOUNT_GROUP, opening_balance_minor: opening, include_in_net_worth: inNet ? 1 : 0 } as const;
      return existing ? save(d, "accounts", { ...existing, ...base } as Account) : createAccount(d, base);
    });
    if (current) setCurrentAccount(saved.id); else if (getCurrentAccount() === saved.id) setCurrentAccount("");
    leave();
  };
  // Accounts are archived, not deleted: the transactions stay, the account drops out of pickers,
  // Budgets and net worth and is listed as disabled under Accounts. Deleting is only offered while empty.
  const txCount = useMemo(() => (existing ? db.get<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE deleted=0 AND account_id=?", [existing.id])?.n ?? 0 : 0), [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const setArchived = (on: boolean) => {
    if (!existing) return;
    mutate((d) => save(d, "accounts", { ...existing, archived: on ? 1 : 0 } as Account));
    if (on && getCurrentAccount() === existing.id) setCurrentAccount("");
    leave();
  };
  const archive = () => existing && Alert.alert(t("account.archive.title"), t("account.archive.body", { count: txCount }), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("account.archive.confirm"), style: "destructive", onPress: () => setArchived(true) },
  ]);
  const del = () => existing && Alert.alert(t("account.delete.title"), t("account.delete.body"), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => { mutate((d) => remove(d, "accounts", existing.id)); exit(() => router.dismissAll()); } },
  ]);
  const pickName = () => router.push({ pathname: "/pick/text", params: { key: keys.name, title: t("account.nameTitle"), value: name } });
  const shown = `${amount || "0"} ${currency}`;
  const changed = existing ? toMinor(value, currency) !== balanceNow : false;

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>{name || (existing ? t("account.editTitle") : t("account.newTitle"))}</Title>
          <Text style={styles.balanceLabel}>{existing ? t("account.balanceNow") : t("account.openingBalance")}</Text>
          <Text style={[styles.balance, untouched && { color: C.tint }]} numberOfLines={1} adjustsFontSizeToFit accessibilityLabel={existing ? t("account.balanceA11y", { amount: shown }) : t("account.openingA11y", { amount: shown })}>{shown}</Text>
          <Subtle>
            {existing
              ? changed ? t("account.openingBecomes", { amount: `${formatMinor(existing.opening_balance_minor + (toMinor(value, currency) - balanceNow), currency)} ${currency}` }) : untouched ? t("account.typeToReplace") : t("account.openingIs", { amount: `${formatMinor(existing.opening_balance_minor, currency)} ${currency}` })
              : `${group ? `${groupName(group)} · ` : ""}${typeLabel(type)}`}
          </Subtle>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="coloncurrencysign.circle" label={`${currency} · ${currencyName(currency)}`} active onPress={() => router.push({ pathname: "/pick/currency", params: { key: keys.currency, selected: currency } })} />
            {TYPES.map((v) => <Chip key={v} label={typeLabel(v)} active={v === type} onPress={() => setType(v)} />)}
            <Chip label={inNet ? t("account.inNetWorth") : t("account.excluded")} icon={inNet ? "checkmark.circle" : "circle"} onPress={() => setInNet((v) => !v)} />
            <Chip label={t("account.current")} icon={current ? "star.fill" : "star"} active={current} onPress={() => setCurrent((v) => !v)} />
          </ChipRow>
          {current ? <Subtle style={{ paddingHorizontal: S.xl }}>{t("account.currentHint")}</Subtle> : null}
          <ChipRow>
            <Chip icon="textformat" label={name || t("account.name")} active={!!name} onPress={pickName} />
            <Chip icon="folder" label={groupName(group)} active onPress={() => router.push({ pathname: "/pick/group", params: { key: keys.group, selected: group } })} />
          </ChipRow>
          <Keypad value={amount} onChange={onKeypad} onToggleSign={toggleSign} />
          {/* Nameless is not a dead end: the bar opens the name field instead of sitting there greyed out. */}
          <ConfirmBar amount={shown} label={valid ? (existing ? (changed ? t("account.confirm.setBalance") : t("account.confirm.save")) : t("account.confirm.add")) : t("account.confirm.name")} onPress={valid ? commit : pickName} />
          {existing ? (existing.archived ? <DeleteRow icon="tray.and.arrow.up" label={t("account.unarchive")} onPress={() => setArchived(false)} /> : <DeleteRow icon="archivebox" label={t("account.archive.row")} onPress={archive} />) : null}
          {existing && txCount === 0 ? <DeleteRow label={t("account.delete.row")} onPress={del} /> : null}
        </>
      }
    />
  );
}

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: 4 },
  balanceLabel: { fontSize: 13, color: C.secondary, marginTop: S.sm },
  balance: { fontSize: 34, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"] },
}));
