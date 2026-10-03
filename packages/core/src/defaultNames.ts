/**
 * Names the app wrote into your data for you — the first account ("Main", from onboarding) and the
 * group every account starts in (`DEFAULT_ACCOUNT_GROUP`, "Personal") — and how they are shown.
 *
 * The same arrangement as a ready-made category (DATA.md rules 16 and 17): **a default name is shown
 * in the app's language for as long as the stored value is still one of that default's names, in any
 * language** (case and spacing aside). Rename "Main" to "Monobank" and it is yours, shown as written.
 * Nothing is rewritten — the stored value stays what it was, so no `updated_at` moves and no merge
 * is won by a row nobody touched.
 *
 * Display only. Grouping compares the stored `group_name` (`group:` scopes, the pickers' sections),
 * so an account in "Personal" and one in "Особисті" typed by hand are two groups that happen to read
 * the same on a Ukrainian phone — which is what they are.
 *
 * The names are in packages/i18n/locales/<lang>/preset.json under `preset.account.name` and
 * `preset.accountGroup.name`, so Swift reads them the same way (`KPPreset.name(_, preset: "account")`).
 */
import type { Account } from "./models";
import { isPresetName, presetName } from "./presets";

export const ACCOUNT_PRESET = "account";
export const ACCOUNT_GROUP_PRESET = "accountGroup";

/** The account name to show in `lang`: the default's, while the stored name is still a default; else as stored. */
export function accountName(a: Pick<Account, "name">, lang: string): string {
  return shown(ACCOUNT_PRESET, a.name, lang);
}

/**
 * The group name to show in `lang`. An empty group stays empty — the screens that list one give it a
 * label of their own ("Accounts", "Other").
 */
export function accountGroupName(group: string | null | undefined, lang: string): string {
  return group?.trim() ? shown(ACCOUNT_GROUP_PRESET, group, lang) : "";
}

function shown(preset: string, stored: string, lang: string): string {
  if (!isPresetName(preset, stored)) return stored;
  return presetName(preset, lang) ?? stored;
}
