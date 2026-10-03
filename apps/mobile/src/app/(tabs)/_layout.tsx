import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useQuery } from "@/store";
import { C } from "@/constants/theme";
import { t } from "@/i18n";

export default function TabsLayout() {
  // Entries waiting in the Pending queue — the same number the app icon carries. On the tab because
  // that is where they are dealt with, and because a badge needs no permission to be read here.
  const pending = useQuery((db) => db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM transactions WHERE deleted=0 AND pending=1`)?.n ?? 0);
  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={C.tint}>
      <NativeTabs.Trigger name="transactions">
        <NativeTabs.Trigger.Icon sf={{ default: "list.bullet.rectangle.portrait", selected: "list.bullet.rectangle.portrait.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.transactions")}</NativeTabs.Trigger.Label>
        {pending ? <NativeTabs.Trigger.Badge>{String(pending)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="budgets">
        <NativeTabs.Trigger.Icon sf={{ default: "chart.pie", selected: "chart.pie.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.budgets")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="insights">
        <NativeTabs.Trigger.Icon sf={{ default: "sparkles.rectangle.stack", selected: "sparkles.rectangle.stack.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.insights")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <NativeTabs.Trigger.Label>{t("tabs.settings")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search">
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
        <NativeTabs.Trigger.Label>{t("tabs.search")}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
