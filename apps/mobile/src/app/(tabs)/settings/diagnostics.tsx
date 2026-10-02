import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { File, Paths } from "expo-file-system";
import { Card, DeleteRow, Empty, Row, SectionHeader } from "@/components/ui";
import { C, Fonts, S, themed } from "@/constants/theme";
import { APP_VERSION } from "@/constants/app";
import { clearLastCrash, readLastCrash, type CrashRecord } from "@/lib/crashlog";
import { bootTrace } from "@/lib/boot";
import { getLocale, t } from "@/i18n";

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
    } catch (e) { Alert.alert(t("data.diagnostics.shareFailed"), (e as Error).message); }
  };
  const clear = () => { clearLastCrash(); setCrash(null); };

  return (
    <>
      <Stack.Screen options={{ title: t("data.diagnostics.title") }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: 80 }}>
        <SectionHeader>{t("data.diagnostics.app")}</SectionHeader>
        <Card><Row title={t("data.diagnostics.version")} subtitle={APP_VERSION} /></Card>

        <SectionHeader>{t("data.diagnostics.lastLaunch")}</SectionHeader>
        <Card>
          {trace.map((r, i) => (
            <Row key={r.label} title={r.label} subtitle={r.deltaMs != null ? `+${r.deltaMs} ms` : t("data.diagnostics.notReached")} style={i ? styles.divider : undefined} />
          ))}
        </Card>

        <SectionHeader>{t("data.diagnostics.lastCrash")}</SectionHeader>
        {crash ? (
          <>
            <Card>
              <Row title={crash.fatal ? t("data.diagnostics.fatal") : t("data.diagnostics.error")} subtitle={new Date(crash.at).toLocaleString(getLocale())} />
              <Row title={t("data.diagnostics.errorMessage")} subtitle={crash.message} style={styles.divider} />
              <Row title={t("data.diagnostics.appVersion")} subtitle={crash.version} style={styles.divider} />
            </Card>
            {crash.stack ? (
              <Card style={styles.stackCard}>
                <Text style={styles.stack} selectable>{crash.stack.split("\n").slice(0, 30).join("\n")}</Text>
              </Card>
            ) : null}
            <Card style={{ marginTop: S.md }}>
              <Row icon="square.and.arrow.up" title={t("data.diagnostics.share")} onPress={() => void share()} />
            </Card>
            <View style={{ marginTop: S.xl }}><DeleteRow label={t("data.diagnostics.clear")} onPress={clear} /></View>
          </>
        ) : (
          <Card><Empty title={t("data.diagnostics.noCrashes")} hint={t("data.diagnostics.noCrashesHint")} /></Card>
        )}
      </ScrollView>
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  stackCard: { padding: S.md },
  stack: { fontFamily: Fonts.mono, fontSize: 12, lineHeight: 16, color: C.secondary },
}));
