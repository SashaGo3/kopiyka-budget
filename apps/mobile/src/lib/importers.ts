/** Pick a Kopiyka backup file and import it, merged or replacing everything. Shared by Settings and the welcome flow. */
import { Alert } from "react-native";
import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { importBackup, type ImportMode } from "@kopiyka/core";
import { mutate } from "@/store";
import { importSummary } from "@/lib/backup";
import { t } from "@/i18n";

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
      t("data.import.confirmTitle"),
      replace ? t("data.import.confirmReplace", { name: asset.name }) : t("data.import.confirmMerge", { name: asset.name }),
      [{ text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) }, { text: t("data.import.confirm"), onPress: () => resolve(true) }],
    ));
    if (!ok) return null;
  }
  const r = mutate((d) => importBackup(d, text, { mode: opts.mode }));
  return importSummary(r, opts.mode);
}
