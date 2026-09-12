/** bun:sqlite adapter. Import from "@kopiyka/core/drivers/bun" only in Bun. */
import { Database } from "bun:sqlite";
import type { Row, SqlDriver, SqlParam } from "../db";

export function openBunDb(path = ":memory:"): SqlDriver & { raw: Database; close(): void } {
  const raw = new Database(path, { create: true });
  raw.run("PRAGMA journal_mode = WAL");
  raw.run("PRAGMA foreign_keys = ON");
  raw.run("PRAGMA busy_timeout = 5000");
  let depth = 0;
  return {
    raw,
    run: (sql, params = []) => { raw.query(sql).run(...(params as never[])); },
    all: <T extends Row>(sql: string, params: SqlParam[] = []) => raw.query(sql).all(...(params as never[])) as T[],
    get: <T extends Row>(sql: string, params: SqlParam[] = []) => (raw.query(sql).get(...(params as never[])) ?? undefined) as T | undefined,
    transaction: <T>(fn: () => T): T => {
      if (depth > 0) return fn();
      depth++;
      try { return raw.transaction(fn)(); } finally { depth--; }
    },
    close: () => raw.close(),
  };
}
