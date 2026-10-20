import { Stack } from "expo-router";
import { screenContentStyle } from "@/constants/layout";

export default function OnboardingLayout() {
  // A theme picked on step 2 re-mounts the step's content, not the flow (src/lib/theme.ts). The edge
  // swipe goes back a step, like the Back button on each (components/Onboarding.tsx).
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", contentStyle: screenContentStyle }} />;
}
