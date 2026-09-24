import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { File, Paths } from "expo-file-system";
import { eraseAll, exportBackupJson, exportGeneric, listRows } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { BACKUP_POLICY, applyRetention, backupNow, lastBackupLine, mirrorPhotos, photoBackupState, pullFromCloud, setBackupEnabled, setSyncEnabled, useBackupState, type PhotoBackupState } from "@/lib/backup";
import { bundleFile, importBundle } from "@/lib/bundle";
import * as DocumentPicker from "expo-document-picker";
import type { ImportMode } from "@kopiyka/core";
import { BACKUP_KEEP_DAYS_OPTIONS, getBackupKeepDays, setBackupKeepDays } from "@/lib/settings";
import { pickAndImport } from "@/lib/importers";

type ExportKind = "backup" | "generic";


/** Data management: automatic iCloud backups, export everything on this phone, or import a backup into it. */
/** "3 transactions, 1 account and 47 categories" — empty kinds are left out, so a fresh phone does not
 *  get told it is about to lose "0 tags". Returns "" when there is nothing to count. */
function countList(parts: [number, string, string?][]): string {
  const said = parts.filter(([n]) => n > 0).map(([n, one, many]) => `${n} ${n === 1 ? one : many ?? `${one}s`}`);
  if (said.length < 2) return said[0] ?? "";
  return `${said.slice(0, -1).join(", ")} and ${said[said.length - 1]}`;
}

export default function DataScreen() {
  const [busy, setBusy] = useState(false);
  const backup = useBackupState();
  const lastLine = lastBackupLine(backup.last?.at);
  const backupSubtitle = !backup.supported ? "Needs the native build"
    : backup.error ? `Failed: ${backup.error}`
    : backup.busy ? "Backing up…"
    : !backup.enabled ? "Off · nothing is copied anywhere"
    : `${lastLine} · ${backup.count} kept${backup.dirty ? " · changes pending" : ""}${backup.icloud ? "" : " · iCloud is off on this phone, kept in the app's folder"}`;
  const runBackup = async () => {
    const f = await backupNow();
    if (f) Alert.alert("Backed up", `${f.name}\n${(f.size / 1024).toFixed(0)} KB${backup.icloud ? " · uploading to iCloud Drive" : " · saved on this phone"}`);
    else if (!backup.supported) Alert.alert("Backups need the native build");
  };
  /**
   * Auto-sync reads the same container the backups go to, so it can only say something useful once
   * it has looked: "checked, nothing new" is the answer on almost every poll and is the one that
   * needs saying, because silence here looks exactly like a feature that is not working.
   */
  const syncSubtitle = !backup.supported ? "Needs the native build"
    : !backup.sync ? "Off · backups from your other devices are ignored"
    : !backup.icloud ? "iCloud is off on this phone, so there is nothing to merge"
    : backup.syncing ? "Merging…"
    : backup.lastSync
      ? `${backup.lastSync.rows ? `${backup.lastSync.rows} row${backup.lastSync.rows === 1 ? "" : "s"} merged` : "Nothing new"} · checked ${lastBackupLine(backup.lastSync.at).replace("Last backup ", "")}`
      : "Checked when you open the app and every few minutes";
  const checkNow = async () => {
    const rows = await pullFromCloud("manual");
    Alert.alert(rows ? "Merged" : "Nothing new", rows
      ? `${rows} row${rows === 1 ? "" : "s"} came in from another device. Nothing was deleted: rows already newer here were kept.`
      : "No backup in iCloud that this phone has not already taken in.");
  };

  const counts = useQuery((d) => ({
    tx: d.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0`)?.n ?? 0,
    accounts: listRows(d, "accounts").length,
    categories: listRows(d, "categories").length,
    tags: listRows(d, "tags").length,
  }));
  // Erasing asks twice. The first tap is easy to make by accident on a row like this one; the second
  // prompt counts out loud what is about to go, so agreeing to it takes actually reading the numbers.
  const confirmReset = () => {
    const doomed = countList([[counts.tx, "transaction"], [counts.accounts, "account"], [counts.categories, "category", "categories"], [counts.tags, "tag"]]);
    Alert.alert("Last chance", doomed ? `${doomed} will be deleted from this phone.` : "Everything on this phone will be deleted.", [
      { text: "Keep my data", style: "cancel" },
      // A wiped phone is a first launch again: eraseAll clears the `onboarded` flag, and the welcome
      // flow replaces the tabs so the user is not left on an empty Settings screen.
      { text: "Erase everything", style: "destructive", onPress: () => { mutate((d) => eraseAll(d, { everywhere: false })); router.replace("/onboarding"); } },
    ]);
  };
  const resetAll = () => Alert.alert("Erase this phone?", "This cannot be undone. iCloud backups are kept; you can restore one afterwards.", [
    { text: "Cancel", style: "cancel" },
    // The first alert has to finish dismissing before the second opens, or iOS drops it (same as pickDay).
    { text: "Erase", style: "destructive", onPress: () => setTimeout(confirmReset, 350) },
  ]);


  // The storage dial. Shortening the window deletes what now falls outside it immediately: the
  // reason for shortening it is to get the space back, and waiting for the next backup to do it
  // would leave the screen claiming a number of files that is not what iCloud is holding.
  const keepDays = useQuery(() => getBackupKeepDays());
  const keepKey = useMemo(() => newPickKey("backupkeepdays"), []);
  usePickResult<string>(keepKey, useCallback((v: string) => { setBackupKeepDays(Number(v)); void applyRetention(); }, []));
  const pickKeepDays = () => router.push({ pathname: "/pick/option", params: { key: keepKey, title: "Keep backups for", selected: String(keepDays),
    options: JSON.stringify(BACKUP_KEEP_DAYS_OPTIONS.map((n) => ({ value: String(n), label: n >= 30 && n % 30 === 0 ? `${n} days · ${n / 30} month${n === 30 ? "" : "s"}` : `${n} days` }))) } });

  // Photos do not travel inside a backup — they are mirrored beside it, a few after each one — so the
  // only honest way to say "everything is safe" is to count them.
  const [photos, setPhotos] = useState<PhotoBackupState | null>(null);
  const refreshPhotos = useCallback(() => { void photoBackupState().then(setPhotos).catch(() => setPhotos(null)); }, []);
  useEffect(refreshPhotos, [refreshPhotos]);
  useFocusEffect(refreshPhotos);
  const photoLine = !photos || !photos.local ? "No photos attached to transactions yet"
    : !photos.icloud ? `${photos.local} on this phone · turn iCloud on to back them up`
    : photos.pending ? `${photos.local - photos.pending} of ${photos.local} copied · ${photos.pending} still to go`
    : `All ${photos.local} copied to iCloud`;

  const exportAs = async (kind: ExportKind) => {
    setBusy(true);
    try {
      const day = todayLocal();
      const [text, name, mime, uti] = kind === "backup"
        ? [exportBackupJson(db), `Kopiyka-backup-${day}.json`, "application/json", "public.json"]
        : [exportGeneric(db), `Kopiyka-${day}.csv`, "text/csv", "public.comma-separated-values-text"];
      const f = new File(Paths.cache, name);
      f.write(text);
      // expo-sharing is only needed for this one tap, not to paint the screen.
      const Sharing = require("expo-sharing") as typeof import("expo-sharing"); // eslint-disable-line @typescript-eslint/no-require-imports
      await Sharing.shareAsync(f.uri, { mimeType: mime, UTI: uti, dialogTitle: name });
    } catch (e) { Alert.alert("Export failed", (e as Error).message); }
    finally { setBusy(false); }
  };

  /** The whole phone as one shareable file: the backup and the photos its rows point at. */
  const exportBundle = async () => {
    setBusy(true);
    try {
      const { file, photos, size } = bundleFile(todayLocal());
      const Sharing = require("expo-sharing") as typeof import("expo-sharing"); // eslint-disable-line @typescript-eslint/no-require-imports
      await Sharing.shareAsync(file.uri, { mimeType: "application/zip", UTI: "public.zip-archive", dialogTitle: file.name });
      if (__DEV__) console.log(`[bundle] ${file.name} ${(size / 1024).toFixed(0)} KB, ${photos} photos`);
    } catch (e) { Alert.alert("Export failed", (e as Error).message); }
    finally { setBusy(false); }
  };

  const importBundleFile = async (mode: ImportMode) => {
    setBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["public.zip-archive", "application/zip"], copyToCacheDirectory: true, multiple: false });
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset) return;
      const ok = await new Promise<boolean>((resolve) => Alert.alert(mode === "replace" ? "Replace everything with this bundle?" : "Import this bundle?",
        mode === "replace"
          ? `${asset.name}\n\nEverything on this phone is replaced by the bundle. Rows it does not mention are deleted. A copy of what you have now is saved first.`
          : `${asset.name}\n\nRows are merged by id and the photos are added; nothing is deleted.`,
        [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) }, { text: mode === "replace" ? "Replace" : "Import", style: mode === "replace" ? "destructive" : "default", onPress: () => resolve(true) }]));
      if (!ok) return;
      const safety = mode === "replace" ? await backupNow("before-replace") : null;
      const { summary } = importBundle(new File(asset.uri).bytesSync(), mode);
      Alert.alert("Bundle imported", `${summary}${safety ? `\n\nYour previous data was saved as ${safety.name}.` : ""}`);
      refreshPhotos();
    } catch (e) { Alert.alert("Import failed", (e as Error).message); }
    finally { setBusy(false); }
  };

  const importAs = async () => {
    setBusy(true);
    try {
      const summary = await pickAndImport();
      if (summary) Alert.alert("Backup imported", summary);
    } catch (e) { Alert.alert("Import failed", (e as Error).message); }
    finally { setBusy(false); }
  };

  /**
   * Hand the phone over to an edited export. The whole feature is the copy taken first: a replace
   * deletes everything the file does not mention, so the way back has to exist *before* it runs, and
   * the user has to be told its name while they can still act on it.
   */
  const replaceEverything = async () => {
    setBusy(true);
    try {
      const safety = await backupNow("before-replace");
      if (!safety && backup.supported) {
        const go = await new Promise<boolean>((resolve) => Alert.alert("Could not save a copy first",
          "The backup that would let you undo this could not be written. Replacing now means there is no way back.",
          [{ text: "Cancel", style: "cancel", onPress: () => resolve(false) }, { text: "Replace anyway", style: "destructive", onPress: () => resolve(true) }]));
        if (!go) return;
      }
      const summary = await pickAndImport({ mode: "replace" });
      if (!summary) return;
      Alert.alert("Everything replaced", `${summary}${safety ? `\n\nYour previous data was saved as ${safety.name}. To go back: Restore from a backup → that file → Replace everything.` : ""}`);
    } catch (e) { Alert.alert("Replace failed", (e as Error).message); }
    finally { setBusy(false); refreshPhotos(); }
  };

  const off = busy ? undefined : (fn: () => Promise<void>) => () => void fn();
  return (
    <>
      <Stack.Screen options={{ title: "Data management" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <SectionHeader>iCloud</SectionHeader>
        <Card>
          <ToggleRow icon="icloud" iconColor="#0A84FF" title="Back up to iCloud" subtitle={backupSubtitle} value={backup.enabled && backup.supported} onChange={setBackupEnabled} />
          <Row icon="arrow.clockwise.icloud" iconColor="#0A84FF" title={backup.busy ? "Backing up…" : "Back up now"} onPress={backup.busy || !backup.supported ? undefined : () => void runBackup()} style={styles.divider} />
          <ToggleRow icon="arrow.triangle.2.circlepath" iconColor="#5E5CE6" title="Merge from other devices" subtitle={syncSubtitle} value={backup.sync && backup.supported} onChange={setSyncEnabled} style={styles.divider} />
          {backup.sync && backup.supported ? (
            <Row icon="icloud.and.arrow.down" iconColor="#5E5CE6" title={backup.syncing ? "Merging…" : "Check iCloud now"} onPress={backup.syncing ? undefined : () => void checkNow()} style={styles.divider} />
          ) : null}
          <Row icon="clock.arrow.circlepath" iconColor="#30D158" title="Restore from a backup" subtitle={backup.count ? `${backup.count} backup${backup.count === 1 ? "" : "s"}, ${backup.today} today` : "Nothing to restore yet"} onPress={() => router.push("/settings/backups")} style={styles.divider} />
          <Row icon="photo.on.rectangle" iconColor="#FF9F0A" title="Receipt photos" subtitle={photoLine}
            onPress={!photos?.pending || !photos.icloud || backup.busy ? undefined : () => { void mirrorPhotos(500).then(refreshPhotos); }} style={styles.divider} />
          <Row icon="square.stack.3d.up" iconColor="#0A84FF" title="Keep backups for" subtitle={`${keepDays} days · ${backup.count} file${backup.count === 1 ? "" : "s"} in iCloud now`} onPress={pickKeepDays} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>A backup is written shortly after each change and at least once a day. Each day keeps its first backup plus the newest ones, up to {BACKUP_POLICY.perDay} in all, and days outside the window above are deleted — that window is what decides how much of your iCloud storage this uses. Files live in Files → iCloud Drive → Kopiyka → Backups and open on any of your devices.</Text>
        <Text style={styles.hint}>Your other devices back up to the same place, so merging is how an iPhone and an iPad stay level: each takes in what the other wrote, in the background, while you carry on. Nothing is ever deleted by it — where both changed the same thing, the newer edit wins — and a backup you have not merged is never deleted to make room. One exception to know about: “Replace everything” below is local, so rows it removes can come back from another device’s next backup. Replace on each device, or turn merging off while you do it.</Text>

        <SectionHeader>Export</SectionHeader>
        <Card>
          <Row icon="square.and.arrow.up" title="Full backup (JSON)" subtitle="Everything: accounts, categories, tags, transactions, recurring rules, budgets, exchange rates, preferences" onPress={off?.(() => exportAs("backup"))} />
          <Row icon="doc.zipper" iconColor="#5E5CE6" title="Bundle (ZIP)" subtitle={`The backup and ${photos?.local ? `all ${photos.local} receipt photo${photos.local === 1 ? "" : "s"}` : "any receipt photos"} in one file — everything, portable`} onPress={off?.(exportBundle)} style={styles.divider} />
          <Row icon="tablecells" iconColor="#FF9F0A" title="Transactions CSV" subtitle="One row per transaction with parent and child category, tags, notes, transfer id" onPress={off?.(() => exportAs("generic"))} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>{counts.tx} transactions in {counts.accounts} accounts. Share to Files, AirDrop, Mail, or straight into another app.</Text>

        <SectionHeader>Import</SectionHeader>
        <Card>
          <Row icon="square.and.arrow.down" iconColor="#30D158" title="Kopiyka backup (JSON)" subtitle="A full backup from this app" onPress={off?.(() => importAs())} />
          <Row icon="doc.zipper" iconColor="#5E5CE6" title="Bundle (ZIP)" subtitle="A bundle exported from this app: the backup and its receipt photos together" onPress={off?.(() => importBundleFile("merge"))} style={styles.divider} />
          <Row icon="arrow.triangle.2.circlepath" iconColor="#FF3B30" title="Replace everything with a file" destructive
            subtitle="For an export you have restructured elsewhere: the file becomes the whole database and anything missing from it is deleted. A copy of what you have now is saved first."
            onPress={off ? () => Alert.alert("Replace from what?", "A bundle carries the photos as well; a JSON file is the data only.", [
              { text: "Cancel", style: "cancel" },
              { text: "Bundle (ZIP)", onPress: () => void importBundleFile("replace") },
              { text: "Backup (JSON)", onPress: () => void replaceEverything() },
            ]) : undefined} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>Imported rows are merged by id; the next iCloud backup includes them. Coming from another app? See the migration guide in the repository.</Text>

        <SectionHeader>Start over</SectionHeader>
        <Card>
          <Row icon="trash" iconColor="#FF3B30" title="Reset all data" subtitle="Delete every account, category, tag, budget and transaction" destructive onPress={resetAll} />
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
});
