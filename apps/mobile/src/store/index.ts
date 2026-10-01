/**
 * Tiny reactive layer over the synchronous DB: every write bumps a version;
 * useQuery re-runs its selector when the version changes. Fast, no cache layer.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { db } from "@/db";
import type { SqlDriver } from "@kopiyka/core";

let version = 0;
const listeners = new Set<() => void>();
const afterWrite = new Set<() => void>();

let uiScheduled = false, sideScheduled = false;
/** Long enough for a sheet dismissal to finish before widgets, watch and notifications are rebuilt. */
const SIDE_EFFECT_DELAY_MS = 300;
/**
 * Bump the version now (any render from here on sees fresh data), but notify subscribers on the
 * next tick so a navigation started by the same tap (closing the Log sheet) commits first, and run
 * side effects (widgets, watch, notifications, sync) once the dismissal animation is over. Bursts of writes coalesce.
 */
export function notifyChange(): void {
  refreshQueries();
  if (!sideScheduled) { sideScheduled = true; setTimeout(() => { sideScheduled = false; for (const f of afterWrite) f(); }, SIDE_EFFECT_DELAY_MS); }
}

/**
 * Re-read the database without claiming anything was written: the queries run again, and the
 * after-write side effects do not. For a reader that may have missed a write it did not cause —
 * pull to refresh — where `notifyChange` would mark the database dirty and have the phone write a
 * backup about nothing.
 */
export function refreshQueries(): void {
  version++;
  if (!uiScheduled) { uiScheduled = true; setTimeout(() => { uiScheduled = false; for (const l of listeners) l(); }, 0); }
}

/** Run a write and notify subscribers. Nested calls only notify once. */
let writing = 0;
export function mutate<T>(fn: (db: SqlDriver) => T): T {
  writing++;
  try { return fn(db); } finally { writing--; if (writing === 0) notifyChange(); }
}

/** Register a side effect that runs after each write batch (sync, widgets, notifications). */
export function onAfterWrite(fn: () => void): () => void {
  afterWrite.add(fn);
  return () => { afterWrite.delete(fn); };
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getVersion() { return version; }

export function useDbVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

/** Synchronous query hook. `select` runs on the JS thread; keep queries indexed and small. */
export function useQuery<T>(select: (db: SqlDriver) => T, deps: unknown[] = []): T {
  const v = useDbVersion();
  // Deps are folded into one string so a changing array length never trips React's hook checks.
  const key = JSON.stringify(deps);
  const [state, setState] = useState(() => select(db));
  const run = useCallback(select, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setState(run(db)); }, [v, run]);
  return state;
}
