import { router } from "expo-router";
import { OnboardingFrame } from "@/components/Onboarding";
import { ThemePicker } from "@/components/ThemePicker";
import { t } from "@/i18n";

/**
 * Step 2: the colour theme, right after the language on the welcome screen — both are about how the
 * app looks and reads rather than what goes into it. Nothing to decide here is required: Continue
 * keeps whatever is ticked, the default included. A tap re-mounts the app in the new colours, and
 * the root layout brings it back to this step (src/lib/theme.ts).
 */
export default function OnboardingTheme() {
  return (
    <OnboardingFrame step={2} title={t("onboarding.theme.title")} subtitle={t("onboarding.theme.subtitle")}
      primary={{ label: t("onboarding.continue"), onPress: () => router.push("/onboarding/location") }}>
      <ThemePicker from="/onboarding/theme" />
    </OnboardingFrame>
  );
}
