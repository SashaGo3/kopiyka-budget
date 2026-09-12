import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { defaultTripEnd, formatMinor, toMinor } from "@kopiyka/core";
import { newPickKey, usePickResult } from "@/store/pick";
import { Keypad, ConfirmBar, evalExpr } from "@/components/Keypad";
import { Chip, ChipRow, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { startTravel, tripCurrency } from "@/lib/travel";
import { cityName, quickLocation } from "@/lib/location";

/**
 * Turn travel mode on: name (prefilled with the current city when location is on), the
 * planned last day, and the budget in the current account's currency. Starting the trip
 * creates the tag and the one-off budget, then offers to tag earlier purchases.
 */
export default function TravelStart() {
  const currency = useMemo(() => tripCurrency(), []);
  const [name, setName] = useState("");
  const [placeholder, setPlaceholder] = useState("Where to?");
  const nameRef = useRef<TextInput>(null);
  const [nameFocused, setNameFocused] = useState(false);
  const [expr, setExpr] = useState("");
  const [ends, setEnds] = useState(() => defaultTripEnd(todayLocal()));
  const key = useMemo(() => newPickKey("tripend"), []);
  usePickResult<string>(key, useCallback((d: string) => setEnds(d < todayLocal() ? todayLocal() : d), []));
  useEffect(() => {
    let alive = true;
    void quickLocation().then(async (c) => { if (!c) return; const p = await cityName(c); if (alive && p) setPlaceholder(p); });
    return () => { alive = false; };
  }, []);
  const value = evalExpr(expr);
  const valid = value !== null && value > 0 && (name.trim().length > 0 || placeholder !== "Where to?");
  const days = Math.round((new Date(ends + "T12:00:00").getTime() - new Date(todayLocal() + "T12:00:00").getTime()) / 86_400_000) + 1;
  const commit = () => {
    if (!valid) return;
    const finalName = name.trim() || placeholder;
    try {
      const { tag } = startTravel({ name: finalName, currency, amount_minor: toMinor(value!, currency), ends });
      router.replace({ pathname: "/travel/backfill", params: { tag: tag.id, name: finalName } });
    } catch (e) {
      Alert.alert("Could not start the trip", (e as Error).message);
    }
  };
  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>Travel mode</Title>
          <Subtle>Every new expense gets the trip tag; the budget counts everything with it, in any currency.</Subtle>
          <View style={styles.nameRow}>
            <TextInput ref={nameRef} value={name} onChangeText={setName} placeholder={placeholder} placeholderTextColor={C.tertiary} style={styles.input}
              returnKeyType="done" blurOnSubmit onSubmitEditing={() => nameRef.current?.blur()} onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)} accessibilityLabel="Trip name" />
            {nameFocused ? <Pressable onPress={() => nameRef.current?.blur()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Done"><Text style={styles.nameDone}>Done</Text></Pressable> : null}
          </View>
          <Title style={styles.amount}>{expr || "0"} <Subtle style={{ fontSize: 18 }}>{currency}</Subtle></Title>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="calendar" label={`Until ${humanDayTime(ends)} · ${days} day${days === 1 ? "" : "s"}`} active onPress={() => router.push({ pathname: "/pick/date", params: { key, selected: ends } })} />
          </ChipRow>
          <Keypad value={expr} onChange={(e) => { Keyboard.dismiss(); setExpr(e); }} allowSign={false} />
          <ConfirmBar amount={`${value !== null ? formatMinor(toMinor(value, currency), currency) : "0"} ${currency}`} label="Tap to start the trip" onPress={commit} disabled={!valid} />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.md, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: S.sm },
  input: { flex: 1, fontSize: 22, fontWeight: "600", color: C.label, paddingVertical: S.sm },
  nameDone: { color: C.tint, fontSize: 17, fontWeight: "700" },
  amount: { fontSize: 44, marginTop: S.xs },
});
