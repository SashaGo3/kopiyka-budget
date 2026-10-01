/**
 * Telling you what changed, once, after an update.
 *
 * The rules it follows are in core (`releasesSince`); what lives here is where the answer is kept
 * and when it is allowed to interrupt.
 *
 * `whats_new_seen` is deliberately **not** in `BACKUP_META_KEYS` (DATA.md rule 7). It describes
 * this install — which version this phone has been told about — the same way `onboarded` does.
 * Carrying it to another device would mean a phone that has not been updated yet is told it has
 * already read the notes for a version it is not running.
 */
import { compareVersions, getMeta, hasNotes, releasesSince, setMeta, type Release } from "@kopiyka/core";
import { router } from "expo-router";
import { db } from "@/db";
import { APP_MARKETING_VERSION } from "@/constants/app";
import { RELEASES } from "@/constants/releases";
import { needsOnboarding } from "@/lib/onboarding";
import { launchHadTarget } from "@/lib/boot";

const KEY = "whats_new_seen";

/** What this install has not been told about yet, newest first. */
export function pendingReleases(): Release[] {
  return releasesSince(RELEASES, { seen: getMeta(db, KEY) ?? null, current: APP_MARKETING_VERSION, fresh: needsOnboarding() });
}

/**
 * What the sheet shows. Opened by itself after an update that is the pending list; opened from
 * Settings by someone who has already read it — and an empty sheet would be a worse answer than
 * the notes again — it is the newest release this build actually runs.
 */
export function releasesToRead(): Release[] {
  const pending = pendingReleases().filter(hasNotes);
  if (pending.length) return pending;
  const shipped = RELEASES.filter((r) => hasNotes(r) && compareVersions(r.version, APP_MARKETING_VERSION) <= 0);
  return shipped.slice(0, 1);
}

/**
 * Remember that this version's notes have been seen. Stamped with the **running** version rather
 * than the newest entry in the file, so a release that adds no notes still moves the mark on and a
 * later one does not reach back past it.
 */
export function markWhatsNewSeen(): void {
  setMeta(db, KEY, APP_MARKETING_VERSION);
}

/**
 * Called once the app has painted. A fresh install is stamped silently: it is told nothing (there
 * is nothing it has missed), and stamping now means its *next* update is news rather than "we have
 * never told you anything, so here is the current release".
 */
export function maybeShowWhatsNew(): void {
  if (needsOnboarding()) return;
  const pending = pendingReleases();
  if (!pending.length) { markWhatsNewSeen(); return; }
  if (launchHadTarget()) return; // not now, but not stamped either — it is still news next time
  router.push("/whats-new");
}
