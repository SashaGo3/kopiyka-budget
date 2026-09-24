import { Stack } from "expo-router";
import { screenContentStyle } from "@/constants/layout";

export default function Layout() {
  // `contentStyle` is where the iPad column is set: one place per stack, and the native header,
  // tab bar and sheets keep the full window (see constants/layout.ts).
  return <Stack screenOptions={{ headerBackButtonDisplayMode: "minimal", headerLargeTitleShadowVisible: false, contentStyle: screenContentStyle }} />;
}
