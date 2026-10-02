/**
 * What an alert says when something failed. Errors core throws on purpose carry a code
 * (`KopiykaError`, packages/core/src/errors.ts) and are said in the app's language; anything else is
 * the system's own message, shown as it stands because it is all there is to go on.
 */
import { kopiykaError } from "@kopiyka/core";
import { t } from "@/i18n";

export function errorText(e: unknown): string {
  switch (kopiykaError(e)?.code) {
    case "not_a_backup": return t("data.import.notBackup");
    case "bundle_without_backup": return t("data.import.bundleNoBackup");
    case "trip_running": return t("travel.error.running");
    case "trip_name_required": return t("travel.error.nameRequired");
    case "trip_not_found": return t("travel.error.notFound");
    default: return e instanceof Error ? e.message : String(e);
  }
}
