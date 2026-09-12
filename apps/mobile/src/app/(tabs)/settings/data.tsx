import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { File, Paths } from "expo-file-system";
import { exportBackupJson, exportGeneric, listRows } from "@kopiyka/core";
import { compactDatabase, databaseFileSize, db } from "@/db";
import { useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { BACKUP_POLICY, backupNow, lastBackupLine, mirrorPhotos, photoBackupState, setBackupEnabled, useBackupState, type PhotoBackupState } from "@/lib/backup";
import { bundleFile, importBundle } from "@/lib/bundle";
import * as DocumentPicker from "expo-document-picker";
import type { ImportMode } from "@kopiyka/core";
import { BACKUP_PER_DAY_OPTIONS, getBackupPerDay, setBackupPerDay } from "@/lib/settings";
import { pickAndImport } from "@/lib/importers";

type ExportKind = "backup" | "generic";

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`);

/** Data management: automatic iCloud backups, export everything on this phone, or import a backup into it. */
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
  const counts = useQuery((d) => ({
    tx: d.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0`)?.n ?? 0,
    accounts: listRows(d, "accounts").length,
  }));

  const perDay = useQuery(() => getBackupPerDay());
  const perDayKey = useMemo(() => newPickKey("backupperday"), []);
  usePickResult<string>(perDayKey, useCallback((v: string) => setBackupPerDay(Number(v)), []));
  const pickPerDay = () => router.push({ pathname: "/pick/option", params: { key: perDayKey, title: "Backups per day", selected: String(perDay),
    options: JSON.stringify(BACKUP_PER_DAY_OPTIONS.map((n) => ({ value: String(n), label: `${n} a day` }))) } });

  const [dbSize, setDbSize] = useState(() => databaseFileSize());
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
  const compact = async () => {
    setBusy(true);
    try {
      const before = dbSize;
      const after = compactDatabase();
      setDbSize(after);
      Alert.alert("Database compacted", `${fmtBytes(before)} → ${fmtBytes(after)}`);
    } catch (e) { Alert.alert("Compact failed", (e as Error).message); }
    finally { setBusy(false); }
  };

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
          <Row icon="clock.arrow.circlepath" iconColor="#30D158" title="Restore from a backup" subtitle={backup.count ? `${backup.count} backup${backup.count === 1 ? "" : "s"}, ${backup.today} today` : "Nothing to restore yet"} onPress={() => router.push("/settings/backups")} style={styles.divider} />
          <Row icon="photo.on.rectangle" iconColor="#FF9F0A" title="Receipt photos" subtitle={photoLine}
            onPress={!photos?.pending || !photos.icloud || backup.busy ? undefined : () => { void mirrorPhotos(500).then(refreshPhotos); }} style={styles.divider} />
          <Row icon="square.stack.3d.up" iconColor="#0A84FF" title="Backups per day" subtitle={`${perDay} · the day's first backup plus the newest ones`} onPress={pickPerDay} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>A backup is written shortly after each change and at least once a day. Each day keeps its first backup plus the newest ones, {perDay} in all, for {BACKUP_POLICY.keepDays} days. Files live in Files → iCloud Drive → Kopiyka → Backups and open on any of your devices.</Text>

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

        <SectionHeader>Storage</SectionHeader>
        <Card>
          <Row icon="arrow.down.right.and.arrow.up.left" iconColor="#8E8E93" title="Compact database" subtitle={fmtBytes(dbSize)} onPress={off?.(compact)} />
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
});
