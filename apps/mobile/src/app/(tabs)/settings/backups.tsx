import { useCallback, useEffect, useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, Text } from "react-native";
import { Stack, router } from "expo-router";
import { Card, Row, SectionHeader } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { humanDayTime } from "@/lib/dates";
import { listBackups, restoreBackup, useBackupState, type BackupEntry } from "@/lib/backup";

const fmtSize = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : n > 0 ? `${Math.max(1, Math.round(n / 1024))} KB` : "in iCloud, not downloaded yet");
const timeOf = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Every iCloud backup by day, newest first; tapping one merges it into this phone. */
export default function BackupsScreen() {
  const backup = useBackupState();
  const [files, setFiles] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { void listBackups().then(setFiles).catch((e: Error) => { setFiles([]); Alert.alert("Cannot list backups", e.message); }); }, []);
  useEffect(load, [load, backup.last?.at, backup.count]);

  const run = async (f: BackupEntry, mode: "merge" | "replace") => {
    setBusy(true);
    try { Alert.alert(mode === "replace" ? "Phone replaced" : "Backup restored", await restoreBackup(f, mode)); router.back(); }
    catch (e) { Alert.alert(mode === "replace" ? "Replace failed" : "Restore failed", (e as Error).message); }
    finally { setBusy(false); }
  };

  // Two genuinely different things, so they are two buttons rather than one with a switch: merging
  // adds what the backup knows, replacing makes the phone *be* the backup — which is how you undo a
  // replace, and the only way a category you deleted since actually stays deleted.
  const restore = (f: BackupEntry) => Alert.alert("Restore this backup?", `${humanDayTime(f.day)} at ${timeOf(f.time)}\n\nMerge keeps everything on this phone and adds what the backup knows; newer rows win.\n\nReplace everything makes the phone exactly this backup — anything added since is deleted.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Merge", onPress: () => void run(f, "merge") },
    { text: "Replace everything", style: "destructive", onPress: () => Alert.alert("Replace everything?", "Every account, category, tag and transaction not in this backup is deleted from this phone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Replace", style: "destructive", onPress: () => void run(f, "replace") },
    ]) },
  ]);

  const days = new Map<string, BackupEntry[]>();
  for (const f of files ?? []) (days.get(f.day) ?? days.set(f.day, []).get(f.day)!).push(f);
  return (
    <>
      <Stack.Screen options={{ title: "Backups" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={files === null} onRefresh={load} />}>
        {files && files.length === 0 ? <Text style={styles.empty}>No backups yet. They appear here after the first change, or use “Back up now”.</Text> : null}
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
        <Text style={styles.hint}>{backup.icloud ? "Stored in iCloud Drive → Kopiyka → Backups. Backups made on another device show up here too." : "iCloud is off on this phone: backups stay in the app's folder (Files → On My iPhone → Kopiyka)."}</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  hint: { color: C.tertiary, fontSize: 13, paddingHorizontal: S.xl, marginTop: S.lg },
  empty: { color: C.secondary, fontSize: 15, paddingHorizontal: S.xl, marginTop: S.xl },
});
