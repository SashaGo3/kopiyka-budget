import Papa from "papaparse";

export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const res = Papa.parse<Record<string, string>>(clean, { header: true, skipEmptyLines: true });
  return res.data;
}

export function toCsv(rows: Record<string, string | number | boolean | null>[], columns: string[]): string {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => r[c] ?? "")) }, { newline: "\n" });
}
