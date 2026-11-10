import { TransactionList, useTransactions } from "@/components/TransactionList";
import { Empty } from "@/components/ui";
import { t } from "@/i18n";

/**
 * Payments marked "Split later" (`to_split`, core/people.ts): the dinner paid in a hurry, waiting
 * for a quiet minute. Tapping one opens its entry, where Split does the rest and clears the mark.
 */
export default function ToSplit() {
  const rows = useTransactions("t.to_split=1 AND t.transfer_id IS NULL", [], 500);
  return <TransactionList rows={rows} empty={<Empty title={t("people.toSplit.empty")} hint={t("people.toSplit.emptyHint")} />} />;
}
