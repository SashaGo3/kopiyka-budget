import type { Frequency } from "@kopiyka/core";

/**
 * Cadence choices, shared by the add wizard and the rule editor so both offer the same list.
 * The presets cover almost everything; "Custom…" opens a unit + count pair for the rest
 * (every 5 days, every 9 months), which the presets would otherwise make impossible to express.
 */
export const REPEATS: { value: string; label: string; freq: Frequency; interval: number }[] = [
  { value: "daily/1", label: "Every day", freq: "daily", interval: 1 },
  { value: "weekly/1", label: "Every week", freq: "weekly", interval: 1 },
  { value: "weekly/2", label: "Every 2 weeks", freq: "weekly", interval: 2 },
  { value: "monthly/1", label: "Every month", freq: "monthly", interval: 1 },
  { value: "monthly/2", label: "Every 2 months", freq: "monthly", interval: 2 },
  { value: "monthly/3", label: "Every 3 months", freq: "monthly", interval: 3 },
  { value: "monthly/6", label: "Every 6 months", freq: "monthly", interval: 6 },
  { value: "yearly/1", label: "Every year", freq: "yearly", interval: 1 },
];

export const CUSTOM = "custom";

/** The presets plus the escape hatch, for a `/pick/option` list. */
export const REPEAT_OPTIONS = [...REPEATS.map(({ value, label }) => ({ value, label })), { value: CUSTOM, label: "Custom…", subtitle: "Any number of days, weeks, months or years" }];

export const REPEAT_UNITS: { value: Frequency; label: string; plural: string }[] = [
  { value: "daily", label: "Days", plural: "days" },
  { value: "weekly", label: "Weeks", plural: "weeks" },
  { value: "monthly", label: "Months", plural: "months" },
  { value: "yearly", label: "Years", plural: "years" },
];

/** How many of a unit to allow: enough to be useful, short enough to stay one scroll. */
export function repeatCounts(freq: Frequency): { value: string; label: string }[] {
  const max = freq === "daily" ? 30 : freq === "weekly" ? 12 : freq === "monthly" ? 24 : 10;
  const unit = REPEAT_UNITS.find((u) => u.value === freq)!;
  return Array.from({ length: max }, (_, i) => {
    const n = i + 1;
    return { value: String(n), label: n === 1 ? `Every ${unit.plural.replace(/s$/, "")}` : `Every ${n} ${unit.plural}` };
  });
}

export function repeatValue(freq: Frequency, interval: number): string {
  return `${freq}/${interval}`;
}

export function parseRepeat(value: string): { freq: Frequency; interval: number } | null {
  const [f, i] = value.split("/");
  const unit = REPEAT_UNITS.find((u) => u.value === f);
  const n = Number(i);
  return unit && Number.isFinite(n) && n > 0 ? { freq: unit.value, interval: n } : null;
}

/** "Every month", "Every 5 days" — the preset label when there is one, otherwise built from the pair. */
export function repeatLabel(freq: Frequency, interval: number): string {
  const preset = REPEATS.find((r) => r.freq === freq && r.interval === interval);
  if (preset) return preset.label;
  const unit = REPEAT_UNITS.find((u) => u.value === freq);
  return unit ? `Every ${interval} ${unit.plural}` : `Every ${interval} ${freq}`;
}
