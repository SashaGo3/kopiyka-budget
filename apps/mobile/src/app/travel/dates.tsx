import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { daysBetween, defaultTripEnd, formatMinor, getRow, save, tripKind, type Budget } from "@kopiyka/core";
import { db } from "@/db";
import { mutate } from "@/store";
import { ConfirmBar } from "@/components/Keypad";
import { RangeCalendar } from "@/components/RangeCalendar";
import { Chip, ChipRow, SheetFrame, Subtle, Title } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { humanDayTime, todayLocal } from "@/lib/dates";
import { useDirty, useDiscardGuard } from "@/lib/discard";
import { resolvePick } from "@/store/pick";
import { prevDay } from "@/lib/filters";
import { t } from "@/i18n";

/**
 * When the travel is: the second step of starting travel mode, and the way to move the dates of the
 * one already running.
 *
 * Starting: the name and the budget come from `/travel/start`, and confirming the dates is what
 * starts it — there is no separate "are you sure" after this, the dates were the last question.
 * They go back to the start sheet (`key`), which creates the trip and closes both.
 *
 * Adding: any days. A last day before today adds it as already over; anything reaching today or
 * later makes it the running one — set up ahead when it starts later, and then it tags nothing
 * until its first day (core `activeTripTagId`). While another one runs (`past`) only days that are
 * over can be picked, since two cannot run at once.
 *
 * Editing (`budget`): the same calendar on that trip's own span, saved over it. One that has ended
 * stays wholly in the past.
 */
export default function TravelDates() {
  const p = useLocalSearchParams<{ key?: string; name?: string; currency?: string; amount?: string; budget?: string; past?: string; kind?: string }>();
  const today = todayLocal();
  const editing = p.budget ? getRow(db, "budgets", p.budget) ?? null : null;
  const kind = tripKind(editing ?? { kind: p.kind });
  // Another trip is running, so this one can only be over: every day before today.
  const onlyOver = p.past === "1" && !editing;
  const yesterday = prevDay(today);
  // An ended one stays over: its last day today at the latest. Otherwise nothing caps the range.
  const maxDay = onlyOver ? yesterday : editing?.ended ? today : undefined;
  const past = onlyOver || !!editing?.ended;
  const first = onlyOver ? yesterday : today;
  const [start, setStart] = useState(editing?.starts ?? first);
  const [end, setEnd] = useState<string | null>(editing ? editing.ended ?? editing.ends ?? editing.starts : defaultTripEnd(first));
  const [jump, setJump] = useState(0);
  const exit = useDiscardGuard(useDirty([start, end]) && !!editing);   // remounts the calendar on the month Today lands in
  const days = end ? daysBetween(start, end) + 1 : null;
  const amount = Number(p.amount) || 0;
  // An event is usually one day: a tap is the whole of it, and a later tap stretches it. A trip
  // keeps the calendar's own first-day-then-last-day.
  const pick = (s: string, e: string | null) => {
    if (kind === "event" && e === null) {
      if (end === start && s > start && (!maxDay || s <= maxDay)) { setEnd(s); return; }
      setStart(s); setEnd(s); return;
    }
    setStart(s); setEnd(e);
  };
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
          <Title>{editing ? t("travel.dates.title", { kind }) : p.name ? (past ? t("travel.dates.whenWasName", { name: p.name }) : t("travel.dates.whenIsName", { name: p.name })) : past ? t("travel.dates.whenWas") : t("travel.dates.whenIs")}</Title>
          <Subtle>{end ? t("travel.dates.span", { from: humanDayTime(start), to: humanDayTime(end), count: days ?? 0 }) : t("travel.dates.tapLast")}</Subtle>
        </View>
      }
      bottom={
        <>
          {onlyOver ? null : (
            <ChipRow>
              <Chip icon="calendar" label={t("common.today")} active={start === today}
                onPress={() => { setStart(today); setEnd((e) => (e && e >= today ? e : null)); setJump((j) => j + 1); }} />
            </ChipRow>
          )}
          <RangeCalendar key={jump} start={start} end={end} maxStart={maxDay} maxEnd={maxDay} onChange={pick} />
          <Text style={styles.hint}>{[kind === "event" ? t("travel.dates.hintEvent") : t("travel.dates.hintPast"), editing ? null : onlyOver ? t("travel.dates.onlyOver") : t("travel.dates.overOrNot", { kind })].filter(Boolean).join(" ")}</Text>
          <ConfirmBar amount={editing ? (end ? t("travel.days", { count: days ?? 0 }) : t("travel.dates.pickLast")) : `${amount ? `${formatMinor(amount, currency)} ${currency}` : t("travel.start.noLimit")}${days ? ` · ${t("travel.days", { count: days })}` : ""}`}
            label={!end ? t("travel.dates.tapLastCalendar") : editing ? t("travel.dates.save") : end < today ? t("travel.dates.add") : start > today ? t("travel.dates.setUp", { kind }) : t("travel.dates.start", { kind })} onPress={confirm} disabled={!end} />
        </>
      }
    />
  );
}

const styles = themed(() => StyleSheet.create({
  top: { paddingHorizontal: S.xl, paddingTop: S.xl, paddingBottom: S.xs, gap: 4 },
  hint: { fontSize: 13, color: C.tertiary, textAlign: "center", paddingHorizontal: S.xl },
}));
