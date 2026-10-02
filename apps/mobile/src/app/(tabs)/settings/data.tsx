import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router, useFocusEffect } from "expo-router";
import { File, Paths } from "expo-file-system";
import { eraseAll, exportBackupJson, exportGeneric, listRows } from "@kopiyka/core";
import { db } from "@/db";
import { mutate, useQuery } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { Card, Row, SectionHeader, ToggleRow } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { todayLocal } from "@/lib/dates";
import { BACKUP_POLICY, applyRetention, backupNow, backupWhen, joinList, lastBackupLine, mirrorPhotos, photoBackupState, pullFromCloud, setBackupEnabled, setSyncEnabled, useBackupState, type PhotoBackupState } from "@/lib/backup";
import { bundleFile, importBundle } from "@/lib/bundle";
import { errorText } from "@/lib/errors";
import * as DocumentPicker from "expo-document-picker";
import type { ImportMode } from "@kopiyka/core";
import { BACKUP_KEEP_DAYS_OPTIONS, getBackupKeepDays, setBackupKeepDays } from "@/lib/settings";
import { pickAndImport } from "@/lib/importers";
import { t } from "@/i18n";

type ExportKind = "backup" | "generic";


/** Data management: automatic iCloud backups, export everything on this phone, or import a backup into it. */
/** "3 transactions, 1 account and 47 categories" — empty kinds are left out, so a fresh phone does not
 *  get told it is about to lose "0 tags". Returns "" when there is nothing to count. */
function countList(parts: [number, (count: number) => string][]): string {
  return joinList(parts.filter(([n]) => n > 0).map(([n, say]) => say(n)));
}

export default function DataScreen() {
  const [busy, setBusy] = useState(false);
  const backup = useBackupState();
  const lastLine = lastBackupLine(backup.last?.at);
  const kept = { last: lastLine, count: backup.count };
  const backupSubtitle = !backup.supported ? t("data.needsNative")
    : backup.error ? t("data.icloud.failed", { error: backup.error })
    : backup.busy ? t("data.icloud.backingUp")
    : !backup.enabled ? t("data.icloud.off")
    : backup.icloud ? (backup.dirty ? t("data.icloud.statePending", kept) : t("data.icloud.state", kept))
    : backup.dirty ? t("data.icloud.statePendingLocal", kept) : t("data.icloud.stateLocal", kept);
  const runBackup = async () => {
    const f = await backupNow();
    const size = ((f?.size ?? 0) / 1024).toFixed(0);
    if (f) Alert.alert(t("data.icloud.backedUp"), backup.icloud ? t("data.icloud.backedUpICloud", { name: f.name, size }) : t("data.icloud.backedUpLocal", { name: f.name, size }));
    else if (!backup.supported) Alert.alert(t("data.backupsNeedNative"));
  };
  /**
   * Auto-sync reads the same container the backups go to, so it can only say something useful once
   * it has looked: "checked, nothing new" is the answer on almost every poll and is the one that
   * needs saying, because silence here looks exactly like a feature that is not working.
   */
  const syncSubtitle = !backup.supported ? t("data.needsNative")
    : !backup.sync ? t("data.icloud.mergeOff")
    : !backup.icloud ? t("data.icloud.mergeNoICloud")
    : backup.syncing ? t("data.icloud.merging")
    : backup.lastSync
      ? (backup.lastSync.rows ? t("data.icloud.merged", { count: backup.lastSync.rows, when: backupWhen(backup.lastSync.at) }) : t("data.icloud.mergedNothing", { when: backupWhen(backup.lastSync.at) }))
      : t("data.icloud.mergeWhen");
  const checkNow = async () => {
    const rows = await pullFromCloud("manual");
    Alert.alert(rows ? t("data.icloud.mergedTitle") : t("data.icloud.nothingNewTitle"), rows
      ? t("data.icloud.mergedMessage", { count: rows })
      : t("data.icloud.nothingNewMessage"));
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
    const doomed = countList([
      [counts.tx, (count) => t("data.count.transactions", { count })], [counts.accounts, (count) => t("data.count.accounts", { count })],
      [counts.categories, (count) => t("data.count.categories", { count })], [counts.tags, (count) => t("data.count.tags", { count })],
    ]);
    Alert.alert(t("data.reset.lastChance"), doomed ? t("data.reset.doomed", { list: doomed }) : t("data.reset.everything"), [
      { text: t("data.reset.keep"), style: "cancel" },
      // A wiped phone is a first launch again: eraseAll clears the `onboarded` flag, and the welcome
      // flow replaces the tabs so the user is not left on an empty Settings screen.
      { text: t("data.reset.eraseEverything"), style: "destructive", onPress: () => { mutate((d) => eraseAll(d, { everywhere: false })); router.replace("/onboarding"); } },
    ]);
  };
  const resetAll = () => Alert.alert(t("data.reset.confirmTitle"), t("data.reset.confirmMessage"), [
    { text: t("common.cancel"), style: "cancel" },
    // The first alert has to finish dismissing before the second opens, or iOS drops it (same as pickDay).
    { text: t("data.reset.erase"), style: "destructive", onPress: () => setTimeout(confirmReset, 350) },
  ]);


  // The storage dial. Shortening the window deletes what now falls outside it immediately: the
  // reason for shortening it is to get the space back, and waiting for the next backup to do it
  // would leave the screen claiming a number of files that is not what iCloud is holding.
  const keepDays = useQuery(() => getBackupKeepDays());
  const keepKey = useMemo(() => newPickKey("backupkeepdays"), []);
  usePickResult<string>(keepKey, useCallback((v: string) => { setBackupKeepDays(Number(v)); void applyRetention(); }, []));
  const pickKeepDays = () => router.push({ pathname: "/pick/option", params: { key: keepKey, title: t("data.icloud.keep"), selected: String(keepDays),
    options: JSON.stringify(BACKUP_KEEP_DAYS_OPTIONS.map((n) => ({ value: String(n), label: n >= 30 && n % 30 === 0 ? t("data.icloud.keepMonths", { days: n, months: n / 30 }) : t("data.icloud.keepDays", { count: n }) }))) } });

  // Photos do not travel inside a backup — they are mirrored beside it, a few after each one — so the
  // only honest way to say "everything is safe" is to count them.
  const [photos, setPhotos] = useState<PhotoBackupState | null>(null);
  const refreshPhotos = useCallback(() => { void photoBackupState().then(setPhotos).catch(() => setPhotos(null)); }, []);
  useEffect(refreshPhotos, [refreshPhotos]);
  useFocusEffect(refreshPhotos);
  const photoLine = !photos || !photos.local ? t("data.icloud.photosNone")
    : !photos.icloud ? t("data.icloud.photosNoICloud", { count: photos.local })
    : photos.pending ? t("data.icloud.photosPending", { done: photos.local - photos.pending, total: photos.local, left: photos.pending })
    : t("data.icloud.photosAll", { count: photos.local });

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
    } catch (e) { Alert.alert(t("data.export.failed"), (e as Error).message); }
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
    } catch (e) { Alert.alert(t("data.export.failed"), (e as Error).message); }
    finally { setBusy(false); }
  };

  const importBundleFile = async (mode: ImportMode) => {
    setBusy(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["public.zip-archive", "application/zip"], copyToCacheDirectory: true, multiple: false });
      const asset = picked.assets?.[0];
      if (picked.canceled || !asset) return;
      const ok = await new Promise<boolean>((resolve) => Alert.alert(mode === "replace" ? t("data.import.bundleReplaceTitle") : t("data.import.bundleTitle"),
        mode === "replace" ? t("data.import.bundleReplace", { name: asset.name }) : t("data.import.bundleMerge", { name: asset.name }),
        [{ text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) }, { text: mode === "replace" ? t("data.import.replaceButton") : t("data.import.confirm"), style: mode === "replace" ? "destructive" : "default", onPress: () => resolve(true) }]));
      if (!ok) return;
      const safety = mode === "replace" ? await backupNow("before-replace") : null;
      const { summary } = importBundle(new File(asset.uri).bytesSync(), mode);
      Alert.alert(t("data.import.bundleDone"), safety ? t("data.import.savedAs", { summary, name: safety.name }) : summary);
      refreshPhotos();
    } catch (e) { Alert.alert(t("data.import.failed"), errorText(e)); }
    finally { setBusy(false); }
  };

  const importAs = async () => {
    setBusy(true);
    try {
      const summary = await pickAndImport();
      if (summary) Alert.alert(t("data.import.done"), summary);
    } catch (e) { Alert.alert(t("data.import.failed"), errorText(e)); }
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
        const go = await new Promise<boolean>((resolve) => Alert.alert(t("data.import.noCopyTitle"),
          t("data.import.noCopyMessage"),
          [{ text: t("common.cancel"), style: "cancel", onPress: () => resolve(false) }, { text: t("data.import.replaceAnyway"), style: "destructive", onPress: () => resolve(true) }]));
        if (!go) return;
      }
      const summary = await pickAndImport({ mode: "replace" });
      if (!summary) return;
      Alert.alert(t("data.import.replacedTitle"), safety ? t("data.import.replacedSavedAs", { summary, name: safety.name }) : summary);
    } catch (e) { Alert.alert(t("data.import.replaceFailed"), errorText(e)); }
    finally { setBusy(false); refreshPhotos(); }
  };

  const off = busy ? undefined : (fn: () => Promise<void>) => () => void fn();
  return (
    <>
      <Stack.Screen options={{ title: t("data.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }}>
        <SectionHeader>{t("data.icloud.section")}</SectionHeader>
        <Card>
          <ToggleRow icon="icloud" iconColor="#0A84FF" title={t("data.icloud.backUp")} subtitle={backupSubtitle} value={backup.enabled && backup.supported} onChange={setBackupEnabled} />
          <Row icon="arrow.clockwise.icloud" iconColor="#0A84FF" title={backup.busy ? t("data.icloud.backingUp") : t("data.icloud.backUpNow")} onPress={backup.busy || !backup.supported ? undefined : () => void runBackup()} style={styles.divider} />
          <ToggleRow icon="arrow.triangle.2.circlepath" iconColor="#5E5CE6" title={t("data.icloud.merge")} subtitle={syncSubtitle} value={backup.sync && backup.supported} onChange={setSyncEnabled} style={styles.divider} />
          {backup.sync && backup.supported ? (
            <Row icon="icloud.and.arrow.down" iconColor="#5E5CE6" title={backup.syncing ? t("data.icloud.merging") : t("data.icloud.checkNow")} onPress={backup.syncing ? undefined : () => void checkNow()} style={styles.divider} />
          ) : null}
          <Row icon="clock.arrow.circlepath" iconColor="#30D158" title={t("data.icloud.restore")} subtitle={backup.count ? t("data.icloud.restoreCount", { count: backup.count, today: backup.today }) : t("data.icloud.restoreNone")} onPress={() => router.push("/settings/backups")} style={styles.divider} />
          <Row icon="photo.on.rectangle" iconColor="#FF9F0A" title={t("data.icloud.photos")} subtitle={photoLine}
            onPress={!photos?.pending || !photos.icloud || backup.busy ? undefined : () => { void mirrorPhotos(500).then(refreshPhotos); }} style={styles.divider} />
          <Row icon="square.stack.3d.up" iconColor="#0A84FF" title={t("data.icloud.keep")} subtitle={t("data.icloud.keepState", { days: keepDays, files: backup.count })} onPress={pickKeepDays} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>{t("data.icloud.hintPolicy", { perDay: BACKUP_POLICY.perDay })}</Text>
        <Text style={styles.hint}>{t("data.icloud.hintMerge")}</Text>

        <SectionHeader>{t("data.export.section")}</SectionHeader>
        <Card>
          <Row icon="square.and.arrow.up" title={t("data.export.json")} subtitle={t("data.export.jsonSubtitle")} onPress={off?.(() => exportAs("backup"))} />
          <Row icon="doc.zipper" iconColor="#5E5CE6" title={t("data.export.bundle")} subtitle={photos?.local ? t("data.export.bundleSubtitleCount", { count: photos.local }) : t("data.export.bundleSubtitle")} onPress={off?.(exportBundle)} style={styles.divider} />
          <Row icon="tablecells" iconColor="#FF9F0A" title={t("data.export.csv")} subtitle={t("data.export.csvSubtitle")} onPress={off?.(() => exportAs("generic"))} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>{t("data.export.hint", { transactions: counts.tx, accounts: counts.accounts })}</Text>

        <SectionHeader>{t("data.import.section")}</SectionHeader>
        <Card>
          <Row icon="square.and.arrow.down" iconColor="#30D158" title={t("data.import.json")} subtitle={t("data.import.jsonSubtitle")} onPress={off?.(() => importAs())} />
          <Row icon="doc.zipper" iconColor="#5E5CE6" title={t("data.import.bundle")} subtitle={t("data.import.bundleSubtitle")} onPress={off?.(() => importBundleFile("merge"))} style={styles.divider} />
          <Row icon="arrow.triangle.2.circlepath" iconColor="#FF3B30" title={t("data.import.replace")} destructive
            subtitle={t("data.import.replaceSubtitle")}
            onPress={off ? () => Alert.alert(t("data.import.replaceFrom"), t("data.import.replaceFromMessage"), [
              { text: t("common.cancel"), style: "cancel" },
              { text: t("data.import.replaceBundle"), onPress: () => void importBundleFile("replace") },
              { text: t("data.import.replaceJson"), onPress: () => void replaceEverything() },
            ]) : undefined} style={styles.divider} />
        </Card>
        <Text style={styles.hint}>{t("data.import.hint")}</Text>

        <SectionHeader>{t("data.reset.section")}</SectionHeader>
        <Card>
          <Row icon="trash" iconColor="#FF3B30" title={t("data.reset.title")} subtitle={t("data.reset.subtitle")} destructive onPress={resetAll} />
        </Card>
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.sm },
}));
