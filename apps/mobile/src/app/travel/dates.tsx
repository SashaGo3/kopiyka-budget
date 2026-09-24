import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { daysBetween, defaultTripEnd, formatMinor, getRow, save, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { ConfirmBar } from "@/components/Keypad";
import { RangeCalendar } from "@/components/RangeCalendar";
import { Chip, ChipRow, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { resolvePick } from "@/store/pick";

/**
 * When the travel is: the second step of starting travel mode, and the way to move the dates of the
 * one already running.
 *
 * Starting: the name and the budget come from `/travel/start`, and confirming the dates is what
 * starts it — there is no separate "are you sure" after this, the dates were the last question.
 * They go back to the start sheet (`key`), which creates the trip and closes both.
 *
 * Editing (`budget`): the same calendar on that trip's own span, saved over it. The first day can be
 * today at the latest either way — a trip that has not begun yet would put its tag on everything
 * logged at home in the meantime.
 */
export default function TravelDates() {
  const p = useLocalSearchParams<{ key?: string; name?: string; currency?: string; amount?: string; budget?: string }>();
  const today = todayLocal();
  const editing = p.budget ? getRow(db, "budgets", p.budget) ?? null : null;
  const [start, setStart] = useState(editing?.starts ?? today);
  const [end, setEnd] = useState<string | null>(editing ? editing.ends ?? editing.starts : defaultTripEnd(today));
  const [jump, setJump] = useState(0);
  const exit = useDiscardGuard(useDirty([start, end]) && !!editing);   // remounts the calendar on the month Today lands in
  const days = end ? daysBetween(start, end) + 1 : null;
  const amount = Number(p.amount) || 0;
  const currency = p.currency ?? "EUR";

  const confirm = () => {
    if (!end) return;
    if (editing) {
      mutate((d) => save(d, "budgets", { ...editing, starts: start, ends: end } as Budget));
      exit(() => router.back());
      return;
    }
    exit(() => resolvePick(p.key ?? "", { start, end }));
  };

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>{editing ? "Travel dates" : p.name ? `When is ${p.name}?` : "When is it?"}</Title>
          <Subtle>{end ? `${humanDayTime(start)} → ${humanDayTime(end)} · ${days} day${days === 1 ? "" : "s"}` : "Now tap the last day"}</Subtle>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="calendar" label="Today" active={start === today}
              onPress={() => { setStart(today); setEnd((e) => (e && e >= today ? e : null)); setJump((j) => j + 1); }} />
          </ChipRow>
          <RangeCalendar key={jump} start={start} end={end} maxStart={today} onChange={(s, e) => { setStart(s); setEnd(e); }} />
          <Text style={styles.hint}>Tap the first day, then the last. It can start today at the latest, and end whenever you like.</Text>
          <ConfirmBar amount={editing ? (end ? `${days} day${days === 1 ? "" : "s"}` : "Pick the last day") : `${formatMinor(amount, currency)} ${currency}${days ? ` · ${days} day${days === 1 ? "" : "s"}` : ""}`}
            label={!end ? "Tap the last day on the calendar" : editing ? "Tap to save the dates" : "Tap to start travel mode"} onPress={confirm} disabled={!end} />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xs, gap: 4 },
  hint: { fontSize: 13, color: C.tertiary, textAlign: "center", paddingHorizontal: S.xl },
});
