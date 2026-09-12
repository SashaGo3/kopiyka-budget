/**
 * Minimal synchronous SQL driver interface. Implemented by bun:sqlite on the
 * Mac server and by expo-sqlite on the phone. Everything in core is written
 * against this so business logic is shared verbatim.
 */
export type SqlParam = string | number | null | Uint8Array;
export type Row = Record<string, unknown>;

export interface SqlDriver {
  run(sql: string, params?: SqlParam[]): void;
  all<T extends Row = Row>(sql: string, params?: SqlParam[]): T[];
  get<T extends Row = Row>(sql: string, params?: SqlParam[]): T | undefined;
  transaction<T>(fn: () => T): T;
}

export function nowMs(): number {
  return Date.now();
}
