import { TransactionsScreen } from "./(tabs)/transactions/index";

/**
 * Search, pushed from the Transactions header onto the root stack — a screen of its own, over the
 * tab bar rather than inside it: the same list across every month, with the search field focused.
 * A category or tag editor's "show transactions" opens it too, filtered to that one and titled after it.
 */
export default function SearchScreen() {
  return <TransactionsScreen isSearch />;
}
