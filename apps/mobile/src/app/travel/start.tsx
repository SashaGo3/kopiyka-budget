import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { countryCurrency, formatMinor, rateOrFallback, toMinor } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import { db } from "@/db";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { startTravel, tripCurrency } from "@/lib/travel";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { DISMISS_MS } from "@/lib/nav";
import { newPickKey, usePickResult } from "@/store/pick";
import { cityName, countryCode, quickLocation } from "@/lib/location";

/**
 * Turn travel mode on, first half: the name (prefilled with the current city when location is on)
 * and the budget in the current account's currency. Confirming opens the calendar
 * (`/travel/dates`), and choosing the dates there is what starts it: the dates come back here, the
 * tag and the one-off budget are created, both sheets close and the earlier-purchases list opens.
 *
 * The amount is the Log sheet's calculator: the field shows what the sum comes to and the sum is
 * written out under it, so what is being typed is always on screen.
 *
 * The budget is in the destination's currency when the phone can tell where it is (and the user has
 * not chosen one): a daily allowance in the money on the menus is the number worth reading on the
 * watch. Payments in any currency count towards it, converted at the cached rates — so a currency
 * the rate source does not cover is warned about before it is taken, since nothing could be counted.
 */
export default function TravelStart() {
  const [currency, setCurrency] = useState(tripCurrency);
  const [chosen, setChosen] = useState(false);   // picked by hand: the location guess no longer moves it
  const chosenRef = useRef(false);               // the same, for the location lookup that lands later
  const curKey = useMemo(() => newPickKey("tripcur"), []);
  const [name, setName] = useState("");
  const [placeholder, setPlaceholder] = useState("Where to?");
  const nameRef = useRef<TextInput>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [expr, setExpr] = useState("");
  const exit = useDiscardGuard(useDirty([name, expr, chosen]));
  useEffect(() => {
    let alive = true;
    void quickLocation().then(async (c) => {
      if (!c) return;
      const [p, cc] = await Promise.all([cityName(c), countryCode(c)]);
      if (!alive) return;
      if (p) setPlaceholder(p);
      const local = countryCurrency(cc);
      if (local && !chosenRef.current) setCurrency(local);
    });
    return () => { alive = false; };
  }, []);
  // A currency picked by hand is checked against the rate source first: with no rate between it and
  // the accounts, every payment would sit in "not counted" and the budget would never move.
  usePickResult<string>(curKey, useCallback((c: string) => {
    const home = tripCurrency();
    chosenRef.current = true;
    setChosen(true);
    setCurrency(c);
    if (c === home) return;
    void rateOrFallback(db, home, c).then((r) => {
      if (r) return;
      Alert.alert(`No exchange rate for ${c}`, `Payments from your ${home} accounts could not be counted towards a ${c} budget. Keep it in ${home} instead?`, [
        { text: `Keep ${c}`, style: "cancel" },
        { text: `Use ${home}`, onPress: () => setCurrency(home) },
      ]);
    });
  }, []));
  const value = evalPartial(expr);
  const finalName = name.trim() || (placeholder !== "Where to?" ? placeholder : "");
  const valid = value !== null && value > 0 && !!finalName;
  const shown = value !== null ? formatMinor(toMinor(value, currency), currency) : "0";
  const key = useMemo(() => newPickKey("tripdates"), []);
  const next = () => {
    if (!valid) return;
    nameRef.current?.blur();
    router.push({ pathname: "/travel/dates", params: { key, name: finalName, currency, amount: String(toMinor(value!, currency)) } });
  };
  usePickResult<{ start: string; end: string }>(key, useCallback(({ start, end }: { start: string; end: string }) => {
    try {
      const { tag } = startTravel({ name: finalName, currency, amount_minor: toMinor(value ?? 0, currency), starts: start, ends: end });
      exit(() => {
        router.dismiss(2);
        setTimeout(() => router.push({ pathname: "/travel/backfill", params: { tag: tag.id, name: finalName } }), DISMISS_MS);
      });
    } catch (e) {
      Alert.alert("Could not start travel mode", (e as Error).message);
    }
  }, [finalName, currency, value, exit]));
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>Travel mode</Title>
          <Subtle>Every new expense gets the travel tag; the budget counts everything with it, whatever currency it was paid in.</Subtle>
          <View style={styles.nameRow}>
            <TextInput ref={nameRef} value={name} onChangeText={setName} placeholder={placeholder} placeholderTextColor={C.tertiary} style={styles.input}
              returnKeyType="done" blurOnSubmit onSubmitEditing={() => nameRef.current?.blur()} onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)} accessibilityLabel="Where you are going" />
            {nameFocused ? <Pressable onPress={() => nameRef.current?.blur()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done"><Text style={styles.nameDone}>Done</Text></Pressable> : null}
          </View>
          <View style={styles.amountRow}>
            <Text style={[styles.amount, !expr && { color: C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{shown}</Text>
            <Pressable onPress={() => router.push({ pathname: "/pick/currency", params: { key: curKey, selected: currency, title: "Budget currency" } })} hitSlop={8}
              style={styles.curPill} accessibilityRole="button" accessibilityLabel={`Budget currency: ${currency}. Tap to change.`}>
              <Text style={styles.cur}>{currency}</Text>
              <SymbolView name="chevron.down" size={11} tintColor={C.secondary} />
            </Pressable>
          </View>
          <CalcLine expr={expr} style={{ textAlign: "left" }} />
        </View>
      }
      bottom={
        <>
          {/* Typing on the keypad puts the name field's keyboard away: the two never share the sheet. */}
          <Keypad value={expr} onChange={(e) => { nameRef.current?.blur(); setExpr(e); }} allowSign={false} />
          <ConfirmBar amount={`${shown} ${currency}`} label={!finalName ? "Name it first" : valid ? "Tap to choose the dates" : "Enter the budget"} onPress={next} disabled={!valid} />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xs, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  input: { flex: 1, fontSize: 22, fontWeight: "600", color: C.label, paddingVertical: S.sm },
  nameDone: { color: C.tint, fontSize: 17, fontWeight: "700" },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: S.xs },
  amount: { fontSize: 44, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"], flexShrink: 1 },
  cur: { fontSize: 18, color: C.secondary, fontWeight: "600" },
  curPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.fill, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
});
