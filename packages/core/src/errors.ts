/**
 * Errors core throws on purpose, for a person to read. The message is English and for logs; what
 * the app shows is chosen by `code` (apps/mobile/src/lib/errors.ts), so a Ukrainian phone never
 * gets an English sentence out of an alert. A failure without a code is a bug or the system's own
 * error, and is shown as it stands.
 */
export type KopiykaErrorCode =
  | "not_a_backup"          // importBackup: not JSON, or not a file this app wrote
  | "bundle_without_backup" // unpackBundle: a ZIP with no backup.json in it
  | "trip_running"          // startTrip: travel mode is already on
  | "trip_name_required"    // startTrip / addPastTrip: an empty name
  | "trip_not_found"        // endTrip: the trip's budget is gone
  | "return_not_possible";  // applyReturn: `detail` is checkReturn's reason

export class KopiykaError extends Error {
  readonly code: KopiykaErrorCode;
  readonly detail?: string;
  constructor(code: KopiykaErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "KopiykaError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The code of an error core threw on purpose, or null. Read off the object rather than with
 * `instanceof`, which a transpiled subclass of Error does not always survive.
 */
export function kopiykaError(e: unknown): { code: KopiykaErrorCode; detail?: string } | null {
  if (!e || typeof e !== "object" || (e as { name?: unknown }).name !== "KopiykaError") return null;
  const { code, detail } = e as KopiykaError;
  return typeof code === "string" ? { code, detail } : null;
}
