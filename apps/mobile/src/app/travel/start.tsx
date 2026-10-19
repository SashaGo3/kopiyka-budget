import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { activeTrip, countryCurrency, formatMinor, rateOrFallback, toMinor, type TripKind } from "@kopiyka/core";
import { SymbolView } from "expo-symbols";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { db } from "@/db";
import { Keypad, CalcLine, ConfirmBar, evalPartial } from "@/components/Keypad";
import { SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { addPastTravel, startTravel, tripCurrency } from "@/lib/travel";
import { errorText } from "@/lib/errors";
import { nextDay } from "@/lib/filters";
import { todayLocal } from "@/lib/dates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { DISMISS_MS } from "@/lib/nav";
import { newPickKey, usePickResult } from "@/store/pick";
import { cityName, countryCode, quickLocation } from "@/lib/location";
import { t } from "@/i18n";

/**
 * Start a trip or an event, first half — the two differ only in words and defaults (core
 * `tripKind`), so one sheet asks for both. The kind is fixed by the button that opened it (`kind`
 * param; Settings has one for each), so there is no switch here. An event does not
 * take the city as its name: a birthday is not called "Kraków".
 *
 * Turn travel mode on, first half: the name (prefilled with the current city when location is on)
 * and the budget in the current account's currency. Confirming opens the calendar
 * (`/travel/dates`), and choosing the dates there is what starts it: the dates come back here, the
 * tag and the one-off budget are created, both sheets close and the earlier-purchases list opens.
 *
 * The amount is the Log sheet's calculator: the field shows what the sum comes to and the sum is
 * written out under it, so what is being typed is always on screen. It is optional: left empty, the
 * trip has no limit (core `tripLimited`) and only counts what was spent — a wedding you want the
 * total of, not a plan for.
 *
 * The budget is in the destination's currency when the phone can tell where it is (and the user has
 * not chosen one): a daily allowance in the money on the menus is the number worth reading on the
 * watch. Payments in any currency count towards it, converted at the cached rates — so a currency
 * the rate source does not cover is warned about before it is taken, since nothing could be counted.
 */
export default function TravelStart() {
  // Whether it is over is the dates' to say, not a switch: a last day before today adds it as
  // finished (born ended), anything reaching today or later is the running one — today's, or one
  // set up ahead. Only one trip runs at a time, so while one does (`past`), the calendar offers only
  // days that are over, and the sheet speaks of one that already happened.
  const p = useLocalSearchParams<{ kind?: TripKind }>();
  const [past] = useState(() => !!activeTrip(db));
  const kind: TripKind = p.kind === "event" ? "event" : "trip";
  const [currency, setCurrency] = useState(tripCurrency);
  // The local currency the phone's location suggested; only a trip happening now is in it.
  const [localCur, setLocalCur] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);   // picked by hand: the location guess no longer moves it
  const chosenRef = useRef(false);               // the same, for the location lookup that lands later
  const curKey = useMemo(() => newPickKey("tripcur"), []);
  const [name, setName] = useState("");
  // The city the phone is in, when it could tell; it is both the placeholder and the name if none is typed.
  const [city, setCity] = useState<string | null>(null);
  const placeCity = kind === "trip" && !past ? city : null;
  const placeholder = placeCity ?? (past ? t("travel.start.wherePast", { kind }) : t("travel.start.where", { kind }));
  const nameRef = useRef<TextInput>(null);
  const [expr, setExpr] = useState("");
  // While the name is being typed the keyboard has the bottom of the sheet, and the keypad under it
  // only showed its top row poking out above the keys: it steps aside and comes back when the keyboard
  // goes. Starts hidden, as the field is focused on open; if that focus never took, the keypad returns.
  const [naming, setNaming] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => { if (!nameRef.current?.isFocused()) setNaming(false); }, 600);
    return () => clearTimeout(id);
  }, []);
  const exit = useDiscardGuard(useDirty([name, expr, chosen]));
  // Where the phone is, asked once: it names a trip happening now and picks its currency. Not while
  // another one runs, since then this one is over and was somewhere else.
  useEffect(() => {
    if (past) return;
    let alive = true;
    void quickLocation().then(async (c) => {
      if (!c) return;
      const [p, cc] = await Promise.all([cityName(c), countryCode(c)]);
      if (!alive) return;
      if (p) setCity(p);
      setLocalCur(countryCurrency(cc) ?? null);
    });
    return () => { alive = false; };
  }, [past]);
  useEffect(() => {
    if (chosenRef.current || !localCur) return;
    setCurrency(localCur); // eslint-disable-line react-hooks/set-state-in-effect
  }, [localCur]);
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
  // Empty is "no limit"; anything typed has to come to a real amount.
  const limitless = !expr.trim();
  const valid = !!finalName && (limitless || (value !== null && value > 0));
  const shown = value !== null ? formatMinor(toMinor(value, currency), currency) : "0";
  const key = useMemo(() => newPickKey("tripdates"), []);
  const next = () => {
    if (!valid) return;
    nameRef.current?.blur();
    router.push({ pathname: "/travel/dates", params: { key, name: finalName, currency, amount: String(limitless ? 0 : toMinor(value!, currency)), kind, ...(past ? { past: "1" } : {}) } });
  };
  usePickResult<{ start: string; end: string }>(key, useCallback(({ start, end }: { start: string; end: string }) => {
    const over = end < todayLocal();
    try {
      const trip = { name: finalName, kind, currency, amount_minor: limitless ? 0 : toMinor(value ?? 0, currency), starts: start, ends: end };
      const { tag } = over ? addPastTravel(trip) : startTravel(trip);
      // A finished trip's purchases are looked for in its own days; a running one's in the months before it.
      const range = over ? { from: start, to: nextDay(end) } : {};
      exit(() => {
        router.dismiss(2);
        setTimeout(() => router.push({ pathname: "/travel/backfill", params: { tag: tag.id, name: finalName, kind, ...range } }), DISMISS_MS);
      });
    } catch (e) {
      Alert.alert(over ? t("travel.start.addFailed") : t("travel.start.startFailed", { kind }), errorText(e));
    }
  }, [finalName, currency, value, limitless, exit, past, kind]));
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>{past ? t("travel.start.pastTitle", { kind }) : t("travel.start.title", { kind })}</Title>
          <Subtle>{past ? t("travel.start.pastSubtitle") : t("travel.start.subtitle", { kind })}</Subtle>
          {past ? <Subtle>{t("travel.start.alreadyOverLocked")}</Subtle> : null}
          <View style={styles.nameRow}>
            {/* Focused on open: the name comes first, and a sheet that opens on a disabled button
                and a keypad does not say so (the keypad waits under the keyboard until it goes). */}
            <TextInput ref={nameRef} autoFocus value={name} onChangeText={setName} placeholder={placeholder} placeholderTextColor={C.tertiary} style={styles.input}
              onFocus={() => setNaming(true)} onBlur={() => setNaming(false)}
              returnKeyType="done" blurOnSubmit onSubmitEditing={() => nameRef.current?.blur()} accessibilityLabel={past ? t("travel.start.nameLabelPast", { kind }) : t("travel.start.nameLabel", { kind })} />
          </View>
          <View style={styles.amountRow}>
            <Text onPress={naming ? () => nameRef.current?.blur() : undefined} style={[styles.amount, limitless && { color: C.tertiary }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.2}>{limitless ? t("travel.start.noLimit") : shown}</Text>
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
          {/* The keyboard and the keypad never share the sheet: one goes while the other is up. */}
          {naming ? null : (
            <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOutDown.duration(160)} style={{ gap: S.md }}>
              <Keypad value={expr} onChange={setExpr} allowSign={false} />
              <ConfirmBar amount={limitless ? t("travel.start.noLimitHint") : `${shown} ${currency}`} label={!finalName ? t("travel.start.nameFirst") : valid ? t("travel.start.toDates") : t("travel.start.enterBudget")} onPress={next} disabled={!valid} />
            </Animated.View>
          )}
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
