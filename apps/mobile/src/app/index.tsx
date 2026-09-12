import { Redirect } from "expo-router";
import { needsOnboarding } from "@/lib/onboarding";

/**
 * "/" lands on the Transactions home tab, or on the welcome flow the first time.
 *
 * A launch URL never reaches this screen: `+native-intent` resolves the root URL to the same two
 * destinations, because routing through here would leave this screen's replacement stacked on top
 * of the root Stack's `(tabs)` anchor — two tab screens for the rest of the session.
 */
export default function Index() {
  return <Redirect href={needsOnboarding() ? "/onboarding" : "/transactions"} />;
}
