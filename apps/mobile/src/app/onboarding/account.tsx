import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { router } from "expo-router";
import { createAccount, formatMinor, listRows, toMinor, type AccountType } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { OnboardingFrame } from "@/components/Onboarding";
import { Keypad, evalExpr } from "@/components/Keypad";
import { C, S } from "@/constants/theme";
import { currencyName, isKnownCurrency, suggestedCurrency } from "@/lib/currencies";
import { countryCode, locationStatus, quickLocation } from "@/lib/location";
import { newPickKey, usePickResult } from "@/store/pick";
import { pickAndImport } from "@/lib/importers";
import { setOnboarded } from "@/lib/onboarding";
import { setCurrentAccount } from "@/lib/settings";

/**
 * Step 2: the main account with what is on it right now (becomes the opening balance).
 *
 * The currency is guessed rather than asked for: the phone's region already says what money is
 * spent here (`suggestedCurrency`), and on the rare phone whose location permission is already
 * granted — a reinstall, a restore — the country it is actually in wins over a region setting
 * somebody moved away from and never changed. Either way it is a default with the picker one tap
 * away, and the guess stops the moment the user picks for themselves.
 */
export default function OnboardingAccount() {
  const [name, setName] = useState("Main");
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
  // An empty keypad means zero: an account can start with nothing on it.
  const value = expr ? evalExpr(expr.replace(/−/g, "-")) : 0;
  const valid = name.trim().length > 0 && value !== null;
  const shown = value !== null && expr ? formatMinor(toMinor(value, currency), currency) : expr || "0";
  const next = () => {
    if (!valid) return;
    const acc = mutate((d) => createAccount(d, { name: name.trim(), currency, type, opening_balance_minor: toMinor(value ?? 0, currency) }));
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
      Alert.alert("Backup restored", summary, [{ text: "Continue", onPress: () => { if (hasAccounts) router.replace("/transactions"); } }]);
    } catch (e) { Alert.alert("Could not restore", (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <OnboardingFrame step={2} title="Your main account" subtitle="What is on it right now becomes the opening balance. More accounts can be added later in Settings."
      primary={{ label: expr ? `Continue with ${shown} ${currency}` : "Continue with 0", onPress: next, disabled: !valid }}
      secondary={{ label: busy ? "Restoring…" : "I have a backup to restore", onPress: () => void restore() }}>
      <View style={styles.form}>
        <TextInput value={name} onChangeText={setName} placeholder="Account name" placeholderTextColor={C.tertiary} style={styles.input} returnKeyType="done" accessibilityLabel="Account name" />
        <View style={styles.balance}>
          <Pressable onPress={() => router.push({ pathname: "/pick/currency", params: { key: curKey, selected: currency } })} style={styles.currencyRow} accessibilityRole="button" accessibilityLabel={`Currency: ${currency}`}>
            <Text style={styles.balanceLabel}>Balance now in</Text>
            <Text style={styles.currencyText}>{currency} · {currencyName(currency)}</Text>
            <SymbolView name="chevron.down" size={12} tintColor={C.tertiary} />
          </Pressable>
          <Text style={styles.balanceValue} numberOfLines={1} adjustsFontSizeToFit>{shown} <Text style={styles.balanceCur}>{currency}</Text></Text>
        </View>
      </View>
      <View style={{ height: S.md }} />
      <Keypad value={expr} onChange={setExpr} onToggleSign={() => setExpr((o) => (o.startsWith("−") ? o.slice(1) : "−" + o))} />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  form: { gap: S.sm, marginHorizontal: -S.xl },
  currencyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  currencyText: { fontSize: 15, fontWeight: "600", color: C.tint },
  input: { marginHorizontal: S.xl, backgroundColor: C.card, borderRadius: 14, paddingHorizontal: S.md, height: 50, fontSize: 18, color: C.label },
  balance: { marginHorizontal: S.xl, backgroundColor: C.card, borderRadius: 14, padding: S.md, gap: 2 },
  balanceLabel: { fontSize: 13, color: C.secondary },
  balanceValue: { fontSize: 36, fontWeight: "700", color: C.label },
  balanceCur: { fontSize: 18, color: C.secondary, fontWeight: "600" },
});
