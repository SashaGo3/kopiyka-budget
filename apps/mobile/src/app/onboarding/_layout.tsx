import { Stack } from "expo-router";
import { screenContentStyle } from "@/constants/layout";
import { themeKeyedLayout } from "@/components/ThemeKeyed";

export default function OnboardingLayout() {
  // A theme picked on step 2 re-mounts the step's content, not the flow (src/lib/theme.ts). The edge
  // swipe goes back a step, like the Back button on each (components/Onboarding.tsx).
  return <Stack screenLayout={themeKeyedLayout} screenOptions={{ headerShown: false, animation: "slide_from_right", contentStyle: screenContentStyle }} />;
}
