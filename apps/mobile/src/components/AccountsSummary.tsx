import { StyleSheet, Text, View } from "react-native";
import { sumInBase } from "@kopiyka/core";
import { Money, Chip, ChipRow } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { getBaseCurrency, setBaseCurrency, useRates } from "@/lib/rates";
import { useState } from "react";
import { t } from "@/i18n";

/** Net worth per currency plus a converted total in the base currency. */
export function NetWorth({ totals }: { totals: { currency: string; minor: number }[] }) {
  const [base, setBase] = useState(getBaseCurrency());
  const { rateFor, loading } = useRates(totals.map((x) => x.currency), base);
  const sum = sumInBase(totals, base, rateFor);
  const currencies = [...new Set(totals.map((x) => x.currency))];
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t("period.netWorth.title")}</Text>
      <Money minor={sum.minor} currency={base} style={styles.big} />
      {sum.missing.length ? <Text style={styles.warn}>{loading ? t("period.netWorth.fetching", { currencies: sum.missing.join(", ") }) : t("period.netWorth.noRate", { currencies: sum.missing.join(", ") })}</Text> : null}
      <View style={styles.lines}>
        {totals.map((x) => <Money key={x.currency} minor={x.minor} currency={x.currency} style={styles.line} />)}
      </View>
      {currencies.length > 1 ? (
        <ChipRow>
          {currencies.map((c) => <Chip key={c} label={c} active={c === base} onPress={() => { setBaseCurrency(c); setBase(c); }} />)}
        </ChipRow>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { paddingHorizontal: S.xl, paddingTop: S.md, paddingBottom: S.sm, gap: 4 },
  label: { color: C.secondary, fontSize: 14 },
  big: { fontSize: 34, fontWeight: "700" },
  warn: { color: C.orange, fontSize: 12 },
  lines: { flexDirection: "row", flexWrap: "wrap", gap: S.md, marginTop: 2, marginBottom: S.sm },
  line: { fontSize: 15, color: C.secondary },
}));
