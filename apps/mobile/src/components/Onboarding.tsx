import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FadeIn } from "@/components/ui";
import { C, S } from "@/constants/theme";

/** Shared chrome for the welcome flow: step dots, a big title, a line of context, the body, and the actions pinned at the bottom. */
export function OnboardingFrame({ step, title, subtitle, children, primary, secondary, scroll = true }: {
  step: 1 | 2 | 3 | 4; title: string; subtitle: string; children?: ReactNode;
  primary: { label: string; onPress: () => void; disabled?: boolean };
  secondary?: { label: string; onPress: () => void };
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = (
    <>
      <View style={styles.dots} accessibilityLabel={`Step ${step} of 4`}>
        {[1, 2, 3, 4].map((i) => <View key={i} style={[styles.dot, i === step && styles.dotOn, i < step && styles.dotDone]} />)}
      </View>
      <FadeIn><Text style={styles.title} maxFontSizeMultiplier={1.3}>{title}</Text></FadeIn>
      <FadeIn delay={80}><Text style={styles.subtitle}>{subtitle}</Text></FadeIn>
      <FadeIn delay={160} style={{ flex: 1 }}>{children}</FadeIn>
    </>
  );
  return (
    <View style={[styles.screen, { paddingTop: insets.top + S.lg }]}>
      {scroll ? <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">{body}</ScrollView> : <View style={[styles.content, { flex: 1 }]}>{body}</View>}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, S.lg) }]}>
        <Pressable onPress={primary.onPress} disabled={primary.disabled} accessibilityRole="button" accessibilityLabel={primary.label}
          style={({ pressed }) => [styles.primary, (pressed || primary.disabled) && { opacity: 0.5 }]}>
          <Text style={styles.primaryText} maxFontSizeMultiplier={1.3}>{primary.label}</Text>
        </Pressable>
        {secondary ? (
          <Pressable onPress={secondary.onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={secondary.label} style={styles.secondary}>
            <Text style={styles.secondaryText} maxFontSizeMultiplier={1.3}>{secondary.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: S.xl, gap: S.md, paddingBottom: S.lg },
  dots: { flexDirection: "row", gap: 6, marginBottom: S.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.fill2 },
  dotOn: { width: 22, backgroundColor: C.tint },
  dotDone: { backgroundColor: C.tint, opacity: 0.4 },
  title: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5, color: C.label },
  subtitle: { fontSize: 17, lineHeight: 24, color: C.secondary },
  footer: { paddingHorizontal: S.xl, paddingTop: S.md, gap: S.sm, backgroundColor: C.bg },
  primary: { height: 54, borderRadius: 16, backgroundColor: C.tint, alignItems: "center", justifyContent: "center" },
  primaryText: { color: C.onTint, fontSize: 17, fontWeight: "700" },
  secondary: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: C.secondary, fontSize: 16, fontWeight: "600" },
});
