/** Pick a Kopiyka backup file and import it, merged or replacing everything. Shared by Settings and the welcome flow. */
import { Alert } from "react-native";
import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { importBackup, type ImportMode } from "@kopiyka/core";
import { mutate } from "@/store";

const JSON_TYPES = ["public.json", "application/json", "public.plain-text", "text/plain"];

/**
 * Import a backup file the user picked. `replace` makes the file the whole truth — every row it does
 * not mention is deleted — which is what a restructured export needs and what a plain restore must
 * never do. The caller is responsible for taking a copy of the current data first; see `data.tsx`.
 */
export async function pickAndImport(opts: { confirm?: boolean; mode?: ImportMode } = {}): Promise<string | null> {
  const replace = opts.mode === "replace";
  const picked = await DocumentPicker.getDocumentAsync({ type: JSON_TYPES, copyToCacheDirectory: true, multiple: false });
  const asset = picked.assets?.[0];
  if (picked.canceled || !asset) return null;
  const text = await new File(asset.uri).text();
  if (opts.confirm !== false) {
    const ok = await new Promise<boolean>((resolve) => Alert.alert(
      "Import backup?",
      replace
        ? `${asset.name}\n\nEverything on this phone is replaced by this file. Rows it does not mention are deleted, and its version of a row wins even if yours is newer.`
        : `${asset.name}\n\nRows are merged by id: newer ones replace what is on this phone, nothing is deleted.`,
      [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) }, { text: "Import", onPress: () => resolve(true) }],
    ));
    if (!ok) return null;
  }
  const r = mutate((d) => importBackup(d, text, { mode: opts.mode }));
  const n = Object.values(r.imported).reduce((a, b) => a + b, 0);
  const tail = replace ? `${n} rows in total, ${r.removed} removed.` : `${n} rows in total, ${r.skipped} already up to date.`;
  return `${r.imported.transactions} transactions, ${r.imported.accounts} accounts, ${r.imported.categories} categories, ${r.imported.tags} tags${r.imported.recurring_rules ? `, ${r.imported.recurring_rules} recurring rules` : ""}${r.imported.budgets ? `, ${r.imported.budgets} budgets` : ""} · ${tail}`;
}
