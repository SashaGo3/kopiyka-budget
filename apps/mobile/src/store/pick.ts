/**
 * Return values from picker sheets to their caller without global state leaks:
 * the caller opens `/pick/category?key=K`, the picker calls resolvePick(K, value).
 */
import { useEffect } from "react";

type Handler = (value: unknown) => void;
const handlers = new Map<string, Handler>();
let n = 0;

export function newPickKey(prefix = "pick"): string { return `${prefix}-${++n}`; }
export function resolvePick(key: string, value: unknown): void { handlers.get(key)?.(value); }

export function usePickResult<T>(key: string, onResult: (v: T) => void): void {
  useEffect(() => {
    handlers.set(key, onResult as Handler);
    return () => { handlers.delete(key); };
  }, [key, onResult]);
}
