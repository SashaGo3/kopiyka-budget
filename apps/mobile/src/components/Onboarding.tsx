import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useNavigation } from "expo-router";
import { SymbolView } from "expo-symbols";
import { ButtonText, ClearOfSides, FadeIn, Tap } from "@/components/ui";
import { C, R, S, themed } from "@/constants/theme";
import { t } from "@/i18n";
import { useKeptScroll } from "@/lib/keptScroll";

/** Welcome, theme, location, account, categories. */
const STEPS = [1, 2, 3, 4, 5] as const;

/**
 * Shared chrome for the welcome flow: step dots, a big title, a line of context, the body, and the
 * actions pinned at the bottom. Every step after the first has Back to the one before it (and the
 * edge swipe does the same, onboarding/_layout.tsx); the first has nothing behind it.
 */
export function OnboardingFrame({ step, title, subtitle, children, primary, secondary, scroll = true, compact = false }: {
  step: 1 | 2 | 3 | 4 | 5; title: string; subtitle: string; children?: ReactNode;
  primary: { label: string; onPress: () => void; disabled?: boolean };
  secondary?: { label: string; onPress: () => void };
  scroll?: boolean;
  /** A short screen (the folded iPhone Duo): smaller title and buttons, tighter gaps, so a step that
   *  must not scroll (the keypad) still fits whole. */
  compact?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  // A step reached by `replace` (the welcome screen skipping ahead) has nothing to go back to.
  const canBack = step > 1 && navigation.canGoBack();
  // If picking a theme ever re-mounts the step, the list stays where it was (lib/keptScroll.ts).
  const kept = useKeptScroll(`onboarding.${step}`);
  const body = (
    <>
      {/* The title block only: the folded iPhone Duo's camera and clock are beside it, nothing below. */}
      <ClearOfSides style={{ gap: S.md }}>
      <View style={styles.head}>
        {canBack ? (
          <Tap onPress={() => router.back()} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.back")} style={styles.back}>
            <SymbolView name="chevron.left" size={13} tintColor={C.tint} />
            <ButtonText style={styles.backText} maxFontSizeMultiplier={1.3}>{t("common.back")}</ButtonText>
          </Tap>
        ) : null}
        <View style={styles.dots} accessibilityLabel={t("onboarding.stepA11y", { step, count: STEPS.length })}>
          {STEPS.map((i) => <View key={i} style={[styles.dot, i === step && styles.dotOn, i < step && styles.dotDone]} />)}
        </View>
      </View>
      <FadeIn><Text style={[styles.title, compact && styles.titleCompact]} maxFontSizeMultiplier={1.3}>{title}</Text></FadeIn>
      <FadeIn delay={80}><Text style={[styles.subtitle, compact && styles.subtitleCompact]}>{subtitle}</Text></FadeIn>
      </ClearOfSides>
      <FadeIn delay={160} style={{ flex: 1 }}>{children}</FadeIn>
    </>
  );
  return (
    <View style={[styles.screen, { paddingTop: insets.top + S.lg }]}>
      {scroll ? <ScrollView {...kept} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">{body}</ScrollView> : <View style={[styles.content, compact && styles.contentCompact, { flex: 1 }]}>{body}</View>}
      <View style={[styles.footer, compact && styles.footerCompact, { paddingBottom: Math.max(insets.bottom, compact ? S.sm : S.lg) }]}>
        <Pressable onPress={primary.onPress} disabled={primary.disabled} accessibilityRole="button" accessibilityLabel={primary.label}
          style={({ pressed }) => [styles.primary, compact && styles.primaryCompact, (pressed || primary.disabled) && { opacity: 0.5 }]}>
          <ButtonText style={styles.primaryText} maxFontSizeMultiplier={1.3}>{primary.label}</ButtonText>
        </Pressable>
        {secondary ? (
          <Tap onPress={secondary.onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={secondary.label} style={[styles.secondary, compact && styles.secondaryCompact]}>
            <ButtonText style={styles.secondaryText} maxFontSizeMultiplier={1.3}>{secondary.label}</ButtonText>
          </Tap>
        ) : null}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: S.xl, gap: S.md, paddingBottom: S.lg },
  head: { flexDirection: "row", alignItems: "center", gap: S.md, marginBottom: S.sm, minHeight: 28 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: C.fill, borderRadius: R.pill, paddingHorizontal: S.md, paddingVertical: S.xs, minHeight: 32 },
  backText: { color: C.tint, fontSize: 15, fontWeight: "600" },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.fill2 },
  dotOn: { width: 22, backgroundColor: C.tint },
  dotDone: { backgroundColor: C.tint, opacity: 0.4 },
  title: { fontSize: 34, fontWeight: "800", letterSpacing: -0.5, color: C.label },
  subtitle: { fontSize: 17, lineHeight: 24, color: C.secondary },
  footer: { paddingHorizontal: S.xl, paddingTop: S.md, gap: S.sm, backgroundColor: C.bg },
  // Compact (a short screen): every point that is not a key goes, and the keys keep theirs.
  contentCompact: { gap: S.sm, paddingBottom: S.sm },
  titleCompact: { fontSize: 28 },
  subtitleCompact: { fontSize: 15, lineHeight: 20 },
  footerCompact: { paddingTop: S.sm, gap: 0 },
  primaryCompact: { minHeight: 46 },
  secondaryCompact: { height: 40 },
  primary: { minHeight: 54, borderRadius: R.md, backgroundColor: C.tint, alignItems: "center", justifyContent: "center" },
  primaryText: { color: C.onTint, fontSize: 17, fontWeight: "700" },
  secondary: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: C.secondary, fontSize: 17, fontWeight: "600" },
}));
