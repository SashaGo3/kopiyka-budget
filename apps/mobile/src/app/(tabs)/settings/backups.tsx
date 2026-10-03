import { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router } from "expo-router";
import { Card, Row, SectionHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime } from "@/lib/dates";
import { listBackups, restoreBackup, useBackupState, type BackupEntry } from "@/lib/backup";
import { errorText } from "@/lib/errors";
import { getLocale, t } from "@/i18n";

const fmtSize = (n: number) => (n >= 1_048_576 ? t("data.backups.sizeMb", { size: (n / 1_048_576).toLocaleString(getLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
  : n > 0 ? t("data.backups.sizeKb", { size: Math.max(1, Math.round(n / 1024)) }) : t("data.backups.notDownloaded"));
const timeOf = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Every iCloud backup by day, newest first; tapping one merges it into this phone. */
export default function BackupsScreen() {
  const backup = useBackupState();
  const [files, setFiles] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { void listBackups().then(setFiles).catch((e: Error) => { setFiles([]); Alert.alert(t("data.backups.listFailed"), e.message); }); }, []);
  useEffect(load, [load, backup.last?.at, backup.count]);

  const run = async (f: BackupEntry, mode: "merge" | "replace") => {
    setBusy(true);
    try { Alert.alert(mode === "replace" ? t("data.backups.replaced") : t("data.backups.restored"), await restoreBackup(f, mode)); router.back(); }
    catch (e) { Alert.alert(mode === "replace" ? t("data.backups.replaceFailed") : t("data.backups.restoreFailed"), errorText(e)); }
    finally { setBusy(false); }
  };

  // Two genuinely different things, so they are two buttons rather than one with a switch: merging
  // adds what the backup knows, replacing makes the phone *be* the backup — which is how you undo a
  // replace, and the only way a category you deleted since actually stays deleted.
  const restore = (f: BackupEntry) => Alert.alert(t("data.backups.restoreTitle"), t("data.backups.restoreMessage", { when: humanDayTime(f.day, timeOf(f.time)) }), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("data.backups.merge"), onPress: () => void run(f, "merge") },
    { text: t("data.backups.replaceEverything"), style: "destructive", onPress: () => Alert.alert(t("data.backups.replaceTitle"), t("data.backups.replaceMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("data.backups.replace"), style: "destructive", onPress: () => void run(f, "replace") },
    ]) },
  ]);

  const days = new Map<string, BackupEntry[]>();
  for (const f of files ?? []) (days.get(f.day) ?? days.set(f.day, []).get(f.day)!).push(f);
  return (
    <>
      <Stack.Screen options={{ title: t("data.backups.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={files === null} onRefresh={load} />}>
        {files && files.length === 0 ? <Text style={styles.empty}>{t("data.backups.empty")}</Text> : null}
        {[...days].map(([day, list]) => (
          <SectionHeader key={day}>{humanDayTime(day)}</SectionHeader>
        )).flatMap((header, i) => {
          const [day, list] = [...days][i]!;
          return [header, (
            <Card key={`${day}-card`}>
              {list.map((f, j) => (
                <Row key={f.name} icon={f.downloaded ? "doc.text" : "icloud.and.arrow.down"} iconColor={f.downloaded ? "#30D158" : "#0A84FF"} title={timeOf(f.time)} subtitle={fmtSize(f.size)} onPress={busy ? undefined : () => restore(f)} style={j ? styles.divider : undefined} />
              ))}
            </Card>
          )];
        })}
        <Text style={styles.hint}>{backup.icloud ? t("data.backups.hintICloud") : t("data.backups.hintLocal")}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.lg },
  empty: { color: C.secondary, fontSize: 15, paddingHorizontal: S.xl, marginTop: S.xl },
});
