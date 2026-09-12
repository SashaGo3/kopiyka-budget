import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { File, Paths } from "expo-file-system";
import { Card, DeleteRow, Empty, Row, SectionHeader } from "@/components/ui";
import { C, Fonts, S } from "@/constants/theme";
import { APP_VERSION } from "@/constants/app";
import { clearLastCrash, readLastCrash, type CrashRecord } from "@/lib/crashlog";
import { bootTrace } from "@/lib/boot";

/** Version + the last uncaught JS error captured by lib/crashlog.ts, so a TestFlight crash leaves something to look at besides the native log. */
export default function Diagnostics() {
  const [crash, setCrash] = useState<CrashRecord | null>(() => readLastCrash());
  const [trace] = useState(() => bootTrace());

  const share = async () => {
    if (!crash) return;
    try {
      // expo-sharing is only needed for this one tap, not to paint the screen.
      const Sharing = require("expo-sharing") as typeof import("expo-sharing"); // eslint-disable-line @typescript-eslint/no-require-imports
      const f = new File(Paths.cache, "last-crash.json");
      f.write(JSON.stringify(crash, null, 2));
      await Sharing.shareAsync(f.uri, { mimeType: "application/json", UTI: "public.json", dialogTitle: "last-crash.json" });
    } catch (e) { Alert.alert("Share failed", (e as Error).message); }
  };
  const clear = () => { clearLastCrash(); setCrash(null); };

  return (
    <>
      <Stack.Screen options={{ title: "Diagnostics" }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 80 }}>
        <SectionHeader>App</SectionHeader>
        <Card><Row title="Version" subtitle={APP_VERSION} /></Card>

        <SectionHeader>Last launch</SectionHeader>
        <Card>
          {trace.map((r, i) => (
            <Row key={r.label} title={r.label} subtitle={r.deltaMs != null ? `+${r.deltaMs} ms` : "not reached this launch"} style={i ? styles.divider : undefined} />
          ))}
        </Card>

        <SectionHeader>Last crash</SectionHeader>
        {crash ? (
          <>
            <Card>
              <Row title={crash.fatal ? "Fatal error" : "Error"} subtitle={new Date(crash.at).toLocaleString()} />
              <Row title="Message" subtitle={crash.message} style={styles.divider} />
              <Row title="App version" subtitle={crash.version} style={styles.divider} />
            </Card>
            {crash.stack ? (
              <Card style={styles.stackCard}>
                <Text style={styles.stack} selectable>{crash.stack.split("\n").slice(0, 30).join("\n")}</Text>
              </Card>
            ) : null}
            <Card style={{ marginTop: S.md }}>
              <Row icon="square.and.arrow.up" title="Share" onPress={() => void share()} />
            </Card>
            <View style={{ marginTop: S.xl }}><DeleteRow label="Clear" onPress={clear} /></View>
          </>
        ) : (
          <Card><Empty title="No crashes recorded" hint="Nothing has been logged since install, or since the last Clear." /></Card>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  stackCard: { padding: S.md },
  stack: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 16, color: C.secondary },
});
