import { Stack } from "expo-router";
import { screenContentStyle } from "@/constants/layout";

export default function OnboardingLayout() {
  // A theme picked on step 2 re-mounts the step's content, not the flow (src/lib/theme.ts). The edge
  // swipe goes back a step, like the Back button on each (components/Onboarding.tsx).
  // No side inset here: onboarding has no bars, so on the folded iPhone Duo only the camera and the
  // clock sit in the side strip, and OnboardingFrame keeps just its title clear of them.
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right", contentStyle: screenContentStyle }} />;
}
