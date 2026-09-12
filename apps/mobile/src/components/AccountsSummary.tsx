import { StyleSheet, Text, View } from "react-native";
import { sumInBase } from "@kopiyka/core";
import { Money, Chip, ChipRow } from "@/components/ui";
import { C, S } from "@/constants/theme";
import { getBaseCurrency, setBaseCurrency, useRates } from "@/lib/rates";
import { useState } from "react";

/** Net worth per currency plus a converted total in the base currency. */
export function NetWorth({ totals }: { totals: { currency: string; minor: number }[] }) {
  const [base, setBase] = useState(getBaseCurrency());
  const { rateFor, loading } = useRates(totals.map((t) => t.currency), base);
  const sum = sumInBase(totals, base, rateFor);
  const currencies = [...new Set(totals.map((t) => t.currency))];
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Net worth</Text>
      <Money minor={sum.minor} currency={base} style={styles.big} />
      {sum.missing.length ? <Text style={styles.warn}>{loading ? `Fetching ${sum.missing.join(", ")} rate…` : `No rate yet for ${sum.missing.join(", ")}. Connect to the internet once.`}</Text> : null}
      <View style={styles.lines}>
        {totals.map((t) => <Money key={t.currency} minor={t.minor} currency={t.currency} style={styles.line} />)}
      </View>
      {currencies.length > 1 ? (
        <ChipRow>
          {currencies.map((c) => <Chip key={c} label={c} active={c === base} onPress={() => { setBaseCurrency(c); setBase(c); }} />)}
        </ChipRow>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.sm, gap: 4 },
  label: { color: C.secondary, fontSize: 14 },
  big: { fontSize: 34, fontWeight: "700" },
  warn: { color: C.orange, fontSize: 12 },
  lines: { flexDirection: "row", flexWrap: "wrap", gap: S.md, marginTop: 2, marginBottom: S.sm },
  line: { fontSize: 15, color: C.secondary },
});
