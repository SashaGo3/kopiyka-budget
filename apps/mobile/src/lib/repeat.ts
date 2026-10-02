import type { Frequency } from "@kopiyka/core";
import { t } from "@/i18n";

/**
 * Cadence choices, shared by the add wizard and the rule editor so both offer the same list.
 * The presets cover almost everything; "Custom…" opens a unit + count pair for the rest
 * (every 5 days, every 9 months), which the presets would otherwise make impossible to express.
 *
 * Labels are functions rather than constants: a list built at import keeps the language the app
 * started in (src/i18n).
 */
const PRESETS: { freq: Frequency; interval: number }[] = [
  { freq: "daily", interval: 1 },
  { freq: "weekly", interval: 1 },
  { freq: "weekly", interval: 2 },
  { freq: "monthly", interval: 1 },
  { freq: "monthly", interval: 2 },
  { freq: "monthly", interval: 3 },
  { freq: "monthly", interval: 6 },
  { freq: "yearly", interval: 1 },
];

export function repeats(): { value: string; label: string; freq: Frequency; interval: number }[] {
  return PRESETS.map((p) => ({ value: repeatValue(p.freq, p.interval), label: repeatLabel(p.freq, p.interval), ...p }));
}

export const CUSTOM = "custom";

/** The presets plus the escape hatch, for a `/pick/option` list. */
export function repeatOptions(): { value: string; label: string; subtitle?: string }[] {
  return [...repeats().map(({ value, label }) => ({ value, label })), { value: CUSTOM, label: t("recurring.repeat.custom"), subtitle: t("recurring.repeat.customSubtitle") }];
}

const UNITS: Frequency[] = ["daily", "weekly", "monthly", "yearly"];

/** The units of a custom cadence, for a `/pick/option` list ("Days", "Weeks", …). */
export function repeatUnits(): { value: Frequency; label: string }[] {
  return UNITS.map((value) => ({ value, label: t(`recurring.repeat.unit.${value}`) }));
}

/** "How many weeks?" — the title of the count step of a custom cadence. */
export function repeatCountTitle(freq: Frequency): string {
  return t(`recurring.repeat.howMany.${freq}`);
}

/** How many of a unit to allow: enough to be useful, short enough to stay one scroll. */
export function repeatCounts(freq: Frequency): { value: string; label: string }[] {
  const max = freq === "daily" ? 30 : freq === "weekly" ? 12 : freq === "monthly" ? 24 : 10;
  return Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: repeatLabel(freq, i + 1) }));
}

export function repeatValue(freq: Frequency, interval: number): string {
  return `${freq}/${interval}`;
}

export function parseRepeat(value: string): { freq: Frequency; interval: number } | null {
  const [f, i] = value.split("/");
  const unit = UNITS.find((u) => u === f);
  const n = Number(i);
  return unit && Number.isFinite(n) && n > 0 ? { freq: unit, interval: n } : null;
}

/** "Every month", "Every 5 days" — "Щомісяця", "Кожні 5 днів". */
export function repeatLabel(freq: Frequency, interval: number): string {
  switch (freq) {
    case "daily": return t("recurring.repeat.every.daily", { count: interval });
    case "weekly": return t("recurring.repeat.every.weekly", { count: interval });
    case "monthly": return t("recurring.repeat.every.monthly", { count: interval });
    case "yearly": return t("recurring.repeat.every.yearly", { count: interval });
    default: return `${interval} × ${String(freq)}`;
  }
}
