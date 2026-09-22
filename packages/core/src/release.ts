/**
 * What changed, and which of it you have not been told about yet.
 *
 * The notes themselves live in the app (`apps/mobile/src/constants/releases.ts`) because they are
 * copy, not data. What lives here is the only part with a decision in it: given what this install
 * last saw and what it is running now, which entries are news. That is worth testing, and it is
 * the sort of thing that is quietly wrong for a year otherwise.
 */

export interface Release {
  /** Marketing version, exactly as `app.json` spells it. */
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  added?: string[];
  improved?: string[];
  fixed?: string[];
}

/**
 * -1, 0 or 1, comparing dotted numeric versions. Missing parts count as 0, so "1.1" and "1.1.0"
 * are the same version and "1.9" is older than "1.10" — which a string compare gets backwards.
 * Anything non-numeric in a part is treated as 0 rather than throwing: a version nobody can parse
 * should not stop the app starting.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split("."), pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10) || 0;
    const nb = Number.parseInt(pb[i] ?? "0", 10) || 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

export interface ReleaseQuery {
  /** The version this install was last told about, or null if it has never been told anything. */
  seen: string | null;
  /** What it is running now. */
  current: string;
  /** True on an install that has not been set up yet. */
  fresh: boolean;
}

/**
 * The releases worth showing, newest first.
 *
 * Three cases, and the middle one is the one that needs saying:
 *
 * - **A fresh install** is told nothing. Everything is new to someone who has never used it, and a
 *   changelog in front of the welcome flow is an obstacle, not a greeting.
 * - **An install that has never recorded a version** is an upgrade from a build before any of this
 *   existed. It is shown the current release only. Its true answer is "everything since whenever
 *   you installed", which nothing knows, and guessing would mean a wall of history for someone who
 *   has been up to date all along.
 * - **Otherwise**, everything newer than what it last saw.
 *
 * A release newer than the running build is never shown, so notes can be written ahead of the
 * release they describe without leaking out of a TestFlight build.
 */
export function releasesSince(releases: Release[], o: ReleaseQuery): Release[] {
  if (o.fresh) return [];
  const shipped = releases.filter((r) => compareVersions(r.version, o.current) <= 0);
  const news = o.seen === null
    ? shipped.filter((r) => compareVersions(r.version, o.current) === 0)
    : shipped.filter((r) => compareVersions(r.version, o.seen!) > 0);
  return [...news].sort((a, b) => compareVersions(b.version, a.version));
}

/** Does a release actually say anything? An entry with three empty lists is not worth a sheet. */
export function hasNotes(r: Release): boolean {
  return (r.added?.length ?? 0) + (r.improved?.length ?? 0) + (r.fixed?.length ?? 0) > 0;
}
