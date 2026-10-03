import { Stack } from "expo-router";
import { screenContentStyle } from "@/constants/layout";
import { themeKeyedLayout } from "@/components/ThemeKeyed";

export default function Layout() {
  // `contentStyle` is where the iPad column is set: one place per stack, and the native header,
  // tab bar and sheets keep the full window (see constants/layout.ts). `screenLayout` re-mounts each
  // screen's content on a theme switch while the stack itself stays (src/lib/theme.ts).
  return <Stack screenLayout={themeKeyedLayout} screenOptions={{ headerBackButtonDisplayMode: "minimal", headerLargeTitleShadowVisible: false, contentStyle: screenContentStyle }} />;
}
