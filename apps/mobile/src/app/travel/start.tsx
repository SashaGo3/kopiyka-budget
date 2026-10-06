import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { countryCurrency, formatMinor, rateOrFallback, toMinor, type TripKind } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import { db } from "@/db";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { Segmented, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { addPastTravel, startTravel, tripCurrency } from "@/lib/travel";
import { errorText } from "@/lib/errors";
import { nextDay } from "@/lib/filters";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { DISMISS_MS } from "@/lib/nav";
import { newPickKey, usePickResult } from "@/store/pick";
import { cityName, countryCode, quickLocation } from "@/lib/location";
import { t } from "@/i18n";

/**
 * Start a trip or an event, first half — the two differ only in words and defaults (core
 * `tripKind`), so one sheet asks for both, with the kind switchable at the top. An event does not
 * take the city as its name: a birthday is not called "Kraków".
 *
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
  // `past`: recording a trip that already happened (Settings → Travel → Add a past travel). Same two
  // sheets, but the location is not where it was, the dates are in the past, and nothing is switched on.
  const p = useLocalSearchParams<{ past?: string; kind?: TripKind }>();
  const past = p.past === "1";
  const [kind, setKind] = useState<TripKind>(p.kind === "event" ? "event" : "trip");
  const [currency, setCurrency] = useState(tripCurrency);
  const [chosen, setChosen] = useState(false);   // picked by hand: the location guess no longer moves it
  const chosenRef = useRef(false);               // the same, for the location lookup that lands later
  const curKey = useMemo(() => newPickKey("tripcur"), []);
  const [name, setName] = useState("");
  // The city the phone is in, when it could tell; it is both the placeholder and the name if none is typed.
  const [city, setCity] = useState<string | null>(null);
  const placeCity = kind === "trip" ? city : null;
  const placeholder = placeCity ?? (past ? t("travel.start.wherePast", { kind }) : t("travel.start.where", { kind }));
  const nameRef = useRef<TextInput>(null);
  const [expr, setExpr] = useState("");
  const exit = useDiscardGuard(useDirty([name, expr, chosen, kind]));
  useEffect(() => {
    if (past) return;
    let alive = true;
    void quickLocation().then(async (c) => {
      if (!c) return;
      const [p, cc] = await Promise.all([cityName(c), countryCode(c)]);
      if (!alive) return;
      if (p) setCity(p);
      const local = countryCurrency(cc);
      if (local && !chosenRef.current) setCurrency(local);
    });
    return () => { alive = false; };
  }, [past]);
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
      Alert.alert(t("travel.start.noRateTitle", { currency: c }), t("travel.start.noRateBody", { home, currency: c }), [
        { text: t("travel.start.keep", { currency: c }), style: "cancel" },
        { text: t("travel.start.use", { currency: home }), onPress: () => setCurrency(home) },
      ]);
    });
  }, []));
  const value = evalPartial(expr);
  const finalName = name.trim() || placeCity || "";
  const valid = value !== null && value > 0 && !!finalName;
  const shown = value !== null ? formatMinor(toMinor(value, currency), currency) : "0";
  const key = useMemo(() => newPickKey("tripdates"), []);
  const next = () => {
    if (!valid) return;
    nameRef.current?.blur();
    router.push({ pathname: "/travel/dates", params: { key, name: finalName, currency, amount: String(toMinor(value!, currency)), kind, ...(past ? { past: "1" } : {}) } });
  };
  usePickResult<{ start: string; end: string }>(key, useCallback(({ start, end }: { start: string; end: string }) => {
    try {
      const trip = { name: finalName, kind, currency, amount_minor: toMinor(value ?? 0, currency), starts: start, ends: end };
      const { tag } = past ? addPastTravel(trip) : startTravel(trip);
      // A past trip's purchases are looked for in its own days; a new one's in the months before it.
      const range = past ? { from: start, to: nextDay(end) } : {};
      exit(() => {
        router.dismiss(2);
        setTimeout(() => router.push({ pathname: "/travel/backfill", params: { tag: tag.id, name: finalName, kind, ...range } }), DISMISS_MS);
      });
    } catch (e) {
      Alert.alert(past ? t("travel.start.addFailed") : t("travel.start.startFailed", { kind }), errorText(e));
    }
  }, [finalName, currency, value, exit, past, kind]));
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Segmented value={kind} onChange={setKind} options={[{ value: "trip", label: t("travel.kind.trip") }, { value: "event", label: t("travel.kind.event") }]} />
          <Title>{past ? t("travel.start.pastTitle", { kind }) : t("travel.start.title", { kind })}</Title>
          <Subtle>{past ? t("travel.start.pastSubtitle") : t("travel.start.subtitle", { kind })}</Subtle>
          <View style={styles.nameRow}>
            <TextInput ref={nameRef} value={name} onChangeText={setName} placeholder={placeholder} placeholderTextColor={C.tertiary} style={styles.input}
              returnKeyType="done" blurOnSubmit onSubmitEditing={() => nameRef.current?.blur()} accessibilityLabel={past ? t("travel.start.nameLabelPast", { kind }) : t("travel.start.nameLabel", { kind })} />
          </View>
          <View style={styles.amountRow}>
            <Text style={[styles.amount, !expr && { color: C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{shown}</Text>
            <Pressable onPress={() => router.push({ pathname: "/pick/currency", params: { key: curKey, selected: currency, title: t("travel.start.currency") } })} hitSlop={8}
              style={styles.curPill} accessibilityRole="button" accessibilityLabel={t("travel.start.currencyLabel", { currency })}>
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
          <ConfirmBar amount={`${shown} ${currency}`} label={!finalName ? t("travel.start.nameFirst") : valid ? t("travel.start.toDates") : t("travel.start.enterBudget")} onPress={next} disabled={!valid} />
        </>
      }
    />
  );
}

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xs, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  input: { flex: 1, fontSize: 22, fontWeight: "600", color: C.label, paddingVertical: S.sm },
  amountRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: S.xs },
  amount: { fontSize: 44, fontWeight: "700", color: C.label, fontVariant: ["tabular-nums"], flexShrink: 1 },
  cur: { fontSize: 18, color: C.secondary, fontWeight: "600" },
  curPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: C.fill, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 },
}));
