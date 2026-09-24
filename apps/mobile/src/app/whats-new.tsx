import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { noteText } from "@kopiyka/core";
import { BigButton, Card, ModalHeader } from "@/components/ui";
import { markWhatsNewSeen, releasesToRead } from "@/lib/whatsNew";
import { C, R, S } from "@/constants/theme";

/**
 * What changed since this phone last looked.
 *
 * It is dismissed by reading it, so the mark is set on the way out rather than on the way in: a
 * sheet that stamps itself as read the moment it appears would swallow the notes if the app were
 * killed while it was on screen.
 *
 * Usually one release. More than one is someone who skipped a version, and each keeps its own
 * heading rather than being merged, because "this arrived in the update you skipped" is worth
 * knowing and a merged list quietly rewrites history.
 */
const SECTIONS: { key: "added" | "improved" | "fixed"; title: string; icon: SFSymbol }[] = [
  { key: "added", title: "Added", icon: "plus.circle.fill" },
  { key: "improved", title: "Improved", icon: "arrow.up.circle.fill" },
  { key: "fixed", title: "Fixed", icon: "wrench.and.screwdriver.fill" },
];

export default function WhatsNew() {
  // Read once on mount: marking it seen must not empty the list under the reader's feet.
  const [releases] = useState(releasesToRead);
  const close = () => { markWhatsNewSeen(); router.back(); };
  return (
    <View style={{ flex: 1, backgroundColor: C.bgGrouped }}>
      {/* No Done up here: the one at the bottom is where a reader arrives, and two buttons for the
          same thing on one short sheet is one too many. */}
      <ModalHeader title="What's new" />
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {releases.map((r, i) => (
          <View key={r.version}>
            <View style={styles.head}>
              <Text style={styles.version}>Version {r.version}</Text>
              {i > 0 ? <Text style={styles.skipped}>you skipped this one</Text> : null}
            </View>
            <Card style={styles.card}>
              {SECTIONS.map(({ key, title, icon }) => {
                const lines = r[key];
                if (!lines?.length) return null;
                return (
                  <View key={key} style={styles.section}>
                    <View style={styles.sectionHead}>
                      <SymbolView name={icon} size={14} tintColor={C.tint} />
                      <Text style={styles.sectionTitle}>{title}</Text>
                    </View>
                    {lines.map((note) => {
                      const text = noteText(note);
                      const symbol = typeof note === "string" ? undefined : note.icon;
                      return (
                        <View key={text} style={styles.item}>
                          {symbol
                            ? <View style={styles.icon}><SymbolView name={symbol as SFSymbol} size={17} tintColor={C.tint} /></View>
                            : <Text style={styles.bullet}>·</Text>}
                          <Text style={styles.line}>{text}</Text>
                        </View>
                      );
                    })}
                  </View>
                );
              })}
            </Card>
          </View>
        ))}
      </ScrollView>
      <View style={styles.bar}><BigButton label="Done" onPress={close} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", gap: S.sm, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: 6 },
  version: { fontSize: 20, fontWeight: "700", color: C.label },
  skipped: { fontSize: 13, color: C.tertiary },
  card: { marginHorizontal: S.lg, borderRadius: R.card, padding: S.lg, gap: S.lg },
  section: { gap: 10 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4 },
  item: { flexDirection: "row", gap: S.sm },
  bullet: { fontSize: 15, color: C.tertiary, lineHeight: 21, width: 24, textAlign: "center" },
  icon: { width: 24, height: 21, alignItems: "center", justifyContent: "center" },
  line: { flex: 1, fontSize: 15, color: C.label, lineHeight: 21 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: S.xxl, paddingTop: S.sm, backgroundColor: C.bgGrouped },
});
