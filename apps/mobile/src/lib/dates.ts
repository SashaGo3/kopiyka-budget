/** Local-time ISO with offset, Budget Flow style but with a colon: 2026-09-07T14:32:37+02:00 */
export function localIso(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const oh = pad(Math.floor(Math.abs(off) / 60)), om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

export function todayLocal(d = new Date()): string {
  return localIso(d).slice(0, 10);
}

/** First day of the month containing `day` and of the next month, as YYYY-MM-DD. */
export function monthBounds(day: string): { start: string; end: string; label: string } {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { start, end, label };
}

export function shiftMonth(day: string, delta: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function dayLabel(iso: string, today = todayLocal()): string {
  const day = iso.slice(0, 10);
  if (day === today) return "Today";
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (day === todayLocal(y)) return "Yesterday";
  const d = new Date(day + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function timeLabel(iso: string): string {
  return iso.slice(11, 16);
}

/** Combine a YYYY-MM-DD day with the current wall-clock time. */
export function dayWithNow(day: string): string {
  const now = new Date();
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return localIso(new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()));
}

/** Same calendar day as `iso`, with the time set to `HH:MM` (seconds 00, local offset). */
export function withTime(iso: string, hhmm: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  return localIso(new Date(y, m - 1, d, hh, mm, 0));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "22 Sep at 11:17"; "13 Jul 2027 at 16:02" in other years or when `withYear` is set (yearly rules). */
export function humanDayTime(day: string, time?: string | null, today = todayLocal(), withYear = false): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const sameYear = y === Number(today.slice(0, 4));
  const base = `${d} ${MONTHS[m - 1]}${sameYear && !withYear ? "" : ` ${y}`}`;
  return time ? `${base} at ${time}` : base;
}

/** "15 Aug – 14 Sep" for a period [start, end). */
export function periodLabel(start: string, end: string): string {
  const last = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)) - 1));
  const f = (s: string) => `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
  return `${f(start)} – ${f(last.toISOString().slice(0, 10))}`;
}

export function monthPill(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;
}
