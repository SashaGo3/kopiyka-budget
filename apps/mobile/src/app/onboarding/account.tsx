import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { createAccount, formatMinor, listRows, save, toMinor, type Account, type AccountType } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { OnboardingFrame } from "@/components/Onboarding";
import { Keypad, CalcLine, evalPartial } from "@/components/Keypad";
import { C, S, themed } from "@/constants/theme";
import { currencyName, isKnownCurrency, suggestedCurrency } from "@/lib/currencies";
import { countryCode, locationStatus, quickLocation } from "@/lib/location";
import { newPickKey, usePickResult } from "@/store/pick";
import { pickAndImport } from "@/lib/importers";
import { errorText } from "@/lib/errors";
import { setOnboarded } from "@/lib/onboarding";
import { setCurrentAccount } from "@/lib/settings";
import { t } from "@/i18n";

/**
 * Step 4: the main account with what is on it right now (becomes the opening balance).
 *
 * The currency is guessed rather than asked for: the phone's region already says what money is
 * spent here (`suggestedCurrency`), and on a phone whose location permission has been granted —
 * the step before this one, a reinstall, a restore — the country it is actually in wins over a
 * region setting somebody moved away from and never changed. Either way it is a default with the
 * picker one tap away, and the guess stops the moment the user picks for themselves.
 */
export default function OnboardingAccount() {
  const [name, setName] = useState(() => t("preset.account.name"));
  const [currency, setCurrency] = useState<string>(() => suggestedCurrency());
  const [chosenByHand, setChosenByHand] = useState(false);
  const [curKey] = useState(() => newPickKey("obcur"));
  usePickResult<string>(curKey, (v: string) => { setChosenByHand(true); setCurrency(v); });
  useEffect(() => {
    if (chosenByHand) return;
    let alive = true;
    void (async () => {
      if ((await locationStatus()) !== "granted") return;
      const fix = await quickLocation();
      if (!fix || !alive) return;
      const country = await countryCode(fix);
      const better = country ? suggestedCurrency(country) : null;
      if (alive && better && isKnownCurrency(better)) setCurrency((cur) => (chosenByHand ? cur : better));
    })();
    return () => { alive = false; };
  }, [chosenByHand]);
  const type: AccountType = "bank";
  const [expr, setExpr] = useState("");
  const [busy, setBusy] = useState(false);
  // An empty keypad means zero: an account can start with nothing on it. `evalPartial`, as on the
  // entry sheet: the big number is where the sum stands, and the sum is written out under it.
  const value = expr ? evalPartial(expr) : 0;
  const valid = name.trim().length > 0 && value !== null;
  const shown = value !== null && expr ? formatMinor(toMinor(value, currency), currency) : expr || "0";
  // Back from the next step and Continue again edits the account this step made, rather than adding
  // a second one beside it. This screen stays mounted under the next step, so a ref carries it.
  const made = useRef<Account | null>(null);
  const next = () => {
    if (!valid) return;
    const fields = { name: name.trim(), currency, type, opening_balance_minor: toMinor(value ?? 0, currency) };
    const acc = mutate((d) => (made.current ? save(d, "accounts", { ...made.current, ...fields }) : createAccount(d, fields)));
    made.current = acc;
    setCurrentAccount(acc.id);
    router.push("/onboarding/categories");
  };
  const restore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const summary = await pickAndImport({ confirm: false });
      if (!summary) return;
      setOnboarded();
      const hasAccounts = listRows(db, "accounts", "deleted=0").length > 0;
      Alert.alert(t("onboarding.restore.done"), summary, [{ text: t("onboarding.restore.continue"), onPress: () => { if (hasAccounts) router.replace("/transactions"); } }]);
    } catch (e) { Alert.alert(t("onboarding.restore.failed"), errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <OnboardingFrame step={4} title={t("onboarding.account.title")} subtitle={t("onboarding.account.subtitle")}
      primary={{ label: expr ? t("onboarding.account.continueWith", { amount: shown, currency }) : t("onboarding.account.continueZero"), onPress: next, disabled: !valid }}
      secondary={{ label: busy ? t("onboarding.restore.busy") : t("onboarding.account.restore"), onPress: () => void restore() }}>
      <View style={styles.form}>
        <TextInput value={name} onChangeText={setName} placeholder={t("onboarding.account.namePlaceholder")} placeholderTextColor={C.tertiary} style={styles.input} returnKeyType="done" accessibilityLabel={t("onboarding.account.namePlaceholder")} />
        <View style={styles.balance}>
          <Pressable onPress={() => router.push({ pathname: "/pick/currency", params: { key: curKey, selected: currency } })} style={styles.currencyRow} accessibilityRole="button" accessibilityLabel={t("onboarding.account.currencyA11y", { currency })}>
            <Text style={styles.balanceLabel}>{t("onboarding.account.balanceIn")}</Text>
            <Text style={styles.currencyText}>{currency} · {currencyName(currency)}</Text>
            <SymbolView name="chevron.down" size={12} tintColor={C.tertiary} />
          </Pressable>
          <Text style={styles.balanceValue} numberOfLines={1} adjustsFontSizeToFit>{shown} <Text style={styles.balanceCur}>{currency}</Text></Text>
          <CalcLine expr={expr} style={{ textAlign: "left" }} />
        </View>
      </View>
      <View style={{ height: S.md }} />
      {/* What is on the first account is money you have; a card in debt can be added later, where ± is. */}
      <Keypad value={expr} onChange={setExpr} allowSign={false} />
    </OnboardingFrame>
  );
}

const styles = themed(() => StyleSheet.create({
  form: { gap: S.sm, marginHorizontal: -S.xl },
  currencyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  currencyText: { fontSize: 15, fontWeight: "600", color: C.tint },
  input: { marginHorizontal: S.xl, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: S.md, height: 50, fontSize: 18, color: C.label },
  balance: { marginHorizontal: S.xl, backgroundColor: C.card, borderRadius: 14, padding: S.md, gap: 2 },
  balanceLabel: { fontSize: 13, color: C.secondary },
  balanceValue: { fontSize: 36, fontWeight: "700", color: C.label },
  balanceCur: { fontSize: 18, color: C.secondary, fontWeight: "600" },
}));
