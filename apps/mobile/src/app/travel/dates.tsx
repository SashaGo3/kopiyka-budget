import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { daysBetween, defaultTripEnd, formatMinor, getRow, save, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { ConfirmBar } from "@/components/Keypad";
import { RangeCalendar } from "@/components/RangeCalendar";
import { Chip, ChipRow, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { resolvePick } from "@/store/pick";
import { t } from "@/i18n";

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
  const p = useLocalSearchParams<{ key?: string; name?: string; currency?: string; amount?: string; budget?: string; past?: string }>();
  const today = todayLocal();
  const editing = p.budget ? getRow(db, "budgets", p.budget) ?? null : null;
  // A trip that is over — recorded after the fact, or ended — lies wholly in the past: its last day
  // can be today at the latest, like its first.
  const past = p.past === "1" || !!editing?.ended;
  const [start, setStart] = useState(editing?.starts ?? today);
  const [end, setEnd] = useState<string | null>(editing ? editing.ended ?? editing.ends ?? editing.starts : defaultTripEnd(today));
  const [jump, setJump] = useState(0);
  const exit = useDiscardGuard(useDirty([start, end]) && !!editing);   // remounts the calendar on the month Today lands in
  const days = end ? daysBetween(start, end) + 1 : null;
  const amount = Number(p.amount) || 0;
  const currency = p.currency ?? "EUR";

  const confirm = () => {
    if (!end) return;
    if (editing) {
      mutate((d) => save(d, "budgets", { ...editing, starts: start, ends: end, ...(editing.ended ? { ended: end } : {}) } as Budget));
      exit(() => router.back());
      return;
    }
    exit(() => resolvePick(p.key ?? "", { start, end }));
  };

  return (
    <SheetFrame
      top={
        <View style={styles.top}>
          <Title>{editing ? t("travel.dates.title") : p.name ? (past ? t("travel.dates.whenWasName", { name: p.name }) : t("travel.dates.whenIsName", { name: p.name })) : past ? t("travel.dates.whenWas") : t("travel.dates.whenIs")}</Title>
          <Subtle>{end ? t("travel.dates.span", { from: humanDayTime(start), to: humanDayTime(end), count: days ?? 0 }) : t("travel.dates.tapLast")}</Subtle>
        </View>
      }
      bottom={
        <>
          <ChipRow>
            <Chip icon="calendar" label={t("common.today")} active={start === today}
              onPress={() => { setStart(today); setEnd((e) => (e && e >= today ? e : null)); setJump((j) => j + 1); }} />
          </ChipRow>
          <RangeCalendar key={jump} start={start} end={end} maxStart={today} maxEnd={past ? today : undefined} onChange={(s, e) => { setStart(s); setEnd(e); }} />
          <Text style={styles.hint}>{past ? t("travel.dates.hintPast") : t("travel.dates.hint")}</Text>
          <ConfirmBar amount={editing ? (end ? t("travel.days", { count: days ?? 0 }) : t("travel.dates.pickLast")) : `${formatMinor(amount, currency)} ${currency}${days ? ` · ${t("travel.days", { count: days })}` : ""}`}
            label={!end ? t("travel.dates.tapLastCalendar") : editing ? t("travel.dates.save") : past ? t("travel.dates.add") : t("travel.dates.start")} onPress={confirm} disabled={!end} />
        </>
      }
    />
  );
}

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xs, gap: 4 },
  hint: { fontSize: 13, color: C.tertiary, textAlign: "center", paddingHorizontal: S.xl },
}));
