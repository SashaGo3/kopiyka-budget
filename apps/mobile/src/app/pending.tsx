import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, Pressable, SectionList, StyleSheet, Text, View, type ColorValue } from "react-native";
import { Stack, router, useIsFocused } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { approvePending, getRow, listRows, remove, save } from "@kopiyka/core";
import { mutate } from "@/store";
import { newPickKey, usePickResult } from "@/store/pick";
import { groupByDay, rowCategory, useTransactions, type TxRow } from "@/components/TransactionList";
import { BarButton, BottomBar } from "@/components/BottomBar";
import { AmountPill, ButtonText, CategoryIcon, Empty, Money } from "@/components/ui";
import { C, S, themed } from "@/constants/theme";
import { timeLabel } from "@/lib/dates";
import { Trans, t } from "@/i18n";
import { acctName } from "@/lib/names";

/**
 * The queue behind the Pending row on Transactions: everything a Shortcut automation or a receipt
 * scan wrote without asking. A card payment is only an authorisation until the bank settles it, so
 * nothing here is final until it is approved.
 *
 * Approving is one tap per row and the only thing the row's own buttons do besides setting the
 * category and deleting. The category is the field these rows arrive without: a notification names
 * a shop, not a category, and since 2026-09 nothing guesses one from the shop's name — a wrong
 * category hides a row, a blank one asks for exactly this screen. Anything else — the amount,
 * the account, tags, the date — is a tap on the row itself, which opens the normal entry sheet;
 * saving there approves the row as well, unless its Pending chip is turned back on.
 *
 * Emptying the queue closes the screen: with nothing left to check there is nothing to look at, and
 * the row that led here is gone from Transactions too. Only after it *becomes* empty, and only while
 * this screen is the one on top — approving the last entry from its own sheet must pop the sheet,
 * not this screen out from under it.
 */
export default function PendingScreen() {
  const legs = useTransactions("t.pending=1", [], 500);
  // A transfer is one thing to look at, not two: its first leg stands for it, the other rides along.
  const { rows, partners } = useMemo(() => {
    const partners = new Map<string, TxRow>();
    const shown = new Set<string>();
    const rows: TxRow[] = [];
    for (const tx of legs) {
      if (!tx.transfer_id) { rows.push(tx); continue; }
      if (shown.has(tx.transfer_id)) { partners.set(tx.transfer_id, tx); continue; }
      shown.add(tx.transfer_id);
      rows.push(tx);
    }
    return { rows, partners };
  }, [legs]);
  const sections = useMemo(() => groupByDay(rows), [rows]);
  const base = rows[0]?.currency ?? "";
  const focused = useIsFocused();
  const had = useRef(false);
  useEffect(() => {
    if (rows.length) { had.current = true; return; }
    if (had.current && focused && router.canGoBack()) router.back();
  }, [rows.length, focused]);
  // One shared picker key; the row it was opened for is remembered beside it (a ref, not state:
  // the answer comes back as a side effect, and nothing re-renders because of it).
  const catKey = useMemo(() => newPickKey("pendingcat"), []);
  const editing = useRef<string | null>(null);
  usePickResult<string | null>(catKey, useCallback((id: string | null) => {
    const rowId = editing.current;
    editing.current = null;
    if (rowId) mutate((d) => { const tx = getRow(d, "transactions", rowId); if (tx) save(d, "transactions", { ...tx, category_id: id }); });
  }, []));

  // Both legs of a transfer at once, and each approval teaches the accounts the digits their bank
  // prints for them (core `approvePending`).
  const approve = (ids: string[]) => mutate((d) => { approvePending(d, ids); });
  const approveAll = () => approve(rows.map((tx) => tx.id));
  const pickCategory = (tx: TxRow) => {
    editing.current = tx.id;
    router.push({ pathname: "/pick/category", params: { key: catKey, kind: tx.amount_minor > 0 ? "income" : "expense", selected: tx.category_id ?? "" } });
  };
  const del = (tx: TxRow) => Alert.alert(tx.transfer_id ? t("transfer.deleteTitle") : t("pending.deleteTitle"), tx.transfer_id ? undefined : tx.payee ?? undefined, [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("common.delete"), style: "destructive", onPress: () => mutate((d) => {
      // Half a transfer left behind would move one balance and not the other.
      const ids = tx.transfer_id ? listRows(d, "transactions", "deleted=0 AND transfer_id=?", [tx.transfer_id]).map((l) => l.id) : [tx.id];
      for (const id of ids) remove(d, "transactions", id);
    }) },
  ]);

  // Same-currency accounts only: mixing currencies into one number would be a lie.
  const total = rows.reduce((a, tx) => (tx.currency === base && !tx.transfer_id ? a + tx.amount_minor : a), 0);

  return (
    <>
      <Stack.Screen options={{ title: t("pending.title"), headerLargeTitle: true, headerBackTitle: t("common.back") }} />
      <SectionList
        sections={sections}
        keyExtractor={(tx) => tx.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: 200 }}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={rows.length ? (
          <Text style={styles.intro}>
            {total
              ? <Trans k="pending.introSum" vars={{ count: rows.length }} tags={{ sum: () => <Money minor={Math.abs(total)} currency={base} style={styles.introSum} /> }} />
              : t("pending.intro", { count: rows.length })}
          </Text>
        ) : null}
        ListEmptyComponent={<Empty title={t("pending.emptyTitle")} hint={t("pending.emptyHint")} />}
        renderSectionHeader={({ section }) => <Text style={styles.sh}>{section.title}</Text>}
        renderItem={({ item, index, section }) => (
          <PendingItem tx={item} partner={item.transfer_id ? partners.get(item.transfer_id) ?? null : null} first={index === 0} last={index === section.data.length - 1}
            onApprove={() => approve([item.id])} onCategory={() => pickCategory(item)} onDelete={() => del(item)} />
        )}
      />
      {rows.length ? (
        <BottomBar>
          <BarButton icon="checkmark.circle" label={t("pending.approveAll", { count: rows.length })} active onPress={approveAll} a11y={t("pending.approveAllA11y", { count: rows.length })} />
        </BottomBar>
      ) : null}
    </>
  );
}

const sourceLabel = (source: string | null): string | undefined => {
  switch (source) {
    case "shortcut": case "shortcut-guess": case "shortcut-transfer": return t("pending.source.shortcut");
    case "receipt": return t("pending.source.receipt");
    case "watch": return t("pending.source.watch");
    case "siri": return t("pending.source.siri");
    default: return undefined;
  }
};

/** A category nobody has agreed to: the automation guessed it from the shop's name (see KopiykaIntents). */
const GUESSED = "shortcut-guess";

function PendingItem({ tx, partner, first, last, onApprove, onCategory, onDelete }: {
  tx: TxRow; partner: TxRow | null; first: boolean; last: boolean; onApprove: () => void; onCategory: () => void; onDelete: () => void;
}) {
  if (tx.transfer_id) return <PendingTransfer tx={tx} partner={partner} first={first} last={last} onApprove={onApprove} onDelete={onDelete} />;
  const names = rowCategory(tx);
  const catLabel = names.name ?? names.parent;
  const title = tx.payee || (tx.notes ? tx.notes.split("\n")[0]! : "") || catLabel || t("common.noCategory");
  // Where it came from matters here more than anywhere else in the app: a Shortcut authorisation
  // and a scanned receipt are both guesses in different ways, and that's worth a glance before approving.
  const origin = sourceLabel(tx.source);
  const where = [acctName({ name: tx.account_name }), tx.place, origin].filter(Boolean).join(" · ");
  const categorised = !!(tx.category_name || tx.parent_name);
  // A guessed category is shown, because a row that is nearly right is quicker to confirm than an
  // empty one — but it is shown in the tint colour and says so, because approving it as it stands
  // files a decision nobody made. Confirming the row clears the queue and the doubt with it.
  const guessed = categorised && tx.source === GUESSED;
  return (
    <View style={[styles.card, first && styles.first, last && styles.last, !first && styles.divider]}>
      <Pressable style={styles.head} accessibilityRole="button" accessibilityLabel={t("pending.editA11y", { title })}
        onPress={() => router.push({ pathname: "/transaction/[id]", params: { id: tx.id } })}>
        <CategoryIcon name={tx.category_name ?? tx.parent_name ?? "?"} icon={tx.cat_icon ?? tx.parent_icon} color={tx.cat_color ?? tx.parent_color} size={34} />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.sub} numberOfLines={1}>{where}{where ? " · " : ""}{timeLabel(tx.date)}</Text>
        </View>
        <AmountPill minor={tx.amount_minor} currency={tx.currency} />
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
      <View style={styles.actions}>
        <Action icon="checkmark.circle.fill" label={t("pending.approve")} color={C.green} onPress={onApprove} grow />
        <Action icon={categorised ? "folder.fill" : "folder.badge.plus"} color={categorised && !guessed ? C.secondary : C.tint} onPress={onCategory}
          label={guessed ? t("pending.guess", { category: catLabel ?? "" }) : catLabel ?? t("pending.category")}
          a11y={guessed ? t("pending.guessA11y", { category: catLabel ?? "" }) : categorised ? t("pending.changeA11y", { category: catLabel ?? "" }) : t("pending.setCategory")} grow />
        <Action icon="trash" label={t("common.delete")} color={C.red} onPress={onDelete} />
      </View>
    </View>
  );
}

/**
 * A transfer the automation read out of two bank notifications (or one, with the other account known
 * by its number): from where to where, both amounts, and a tap to correct it on the transfer sheet.
 * Approving it approves both legs.
 */
function PendingTransfer({ tx, partner, first, last, onApprove, onDelete }: {
  tx: TxRow; partner: TxRow | null; first: boolean; last: boolean; onApprove: () => void; onDelete: () => void;
}) {
  const out = tx.amount_minor < 0 ? tx : partner ?? tx;
  const inn = out === tx ? partner : tx;
  const route = [acctName({ name: out.account_name }), inn ? acctName({ name: inn.account_name }) : "?"].join(" → ");
  // An amount the app could not know (no rate for the other side) is 0 and has to be typed.
  const unknown = !inn || inn.amount_minor === 0 || out.amount_minor === 0;
  const edit = () => router.push({ pathname: "/transfer/[id]", params: { id: tx.transfer_id! } });
  return (
    <View style={[styles.card, first && styles.first, last && styles.last, !first && styles.divider]}>
      <Pressable style={styles.head} accessibilityRole="button" accessibilityLabel={t("pending.transfer.editA11y", { route })} onPress={edit}>
        <View style={styles.transferIcon}><SymbolView name="arrow.left.arrow.right" size={15} tintColor={C.secondary} /></View>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>{t("pending.transfer.title")}</Text>
          <Text style={styles.sub} numberOfLines={2}>{route} · {timeLabel(tx.date)}</Text>
        </View>
        <View style={styles.amounts}>
          <AmountPill minor={out.amount_minor} currency={out.currency} neutral />
          {inn && inn.currency !== out.currency ? <AmountPill minor={inn.amount_minor} currency={inn.currency} neutral /> : null}
        </View>
        <SymbolView name="chevron.right" size={12} tintColor={C.tertiary} />
      </Pressable>
      <View style={styles.actions}>
        {unknown
          ? <Action icon="pencil" label={t("pending.transfer.fill")} color={C.tint} onPress={edit} grow />
          : <Action icon="checkmark.circle.fill" label={t("pending.approve")} color={C.green} onPress={onApprove} grow />}
        <Action icon="pencil" label={t("pending.transfer.edit")} color={C.secondary} onPress={edit} />
        <Action icon="trash" label={t("common.delete")} color={C.red} onPress={onDelete} />
      </View>
    </View>
  );
}

function Action({ icon, label, a11y, color, onPress, grow }: { icon: SFSymbol; label: string; a11y?: string; color: ColorValue; onPress: () => void; grow?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label}
      style={({ pressed }) => [styles.action, grow && { flex: 1 }, pressed && { backgroundColor: C.fill }]}>
      <SymbolView name={icon} size={16} tintColor={color} />
      {grow ? <ButtonText style={[styles.actionText, { color }]}>{label}</ButtonText> : null}
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  intro: { color: C.secondary, fontSize: 14, lineHeight: 20, paddingHorizontal: S.xl, paddingTop: S.sm, paddingBottom: S.md },
  introSum: { color: C.label, fontSize: 14, fontWeight: "700" },
  sh: { fontSize: 20, fontWeight: "700", color: C.label, paddingHorizontal: S.xl, paddingTop: S.lg, paddingBottom: S.sm },
  card: { marginHorizontal: S.lg, backgroundColor: C.card, overflow: "hidden" },
  first: { borderTopLeftRadius: 14, borderTopRightRadius: 14 },
  last: { borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  head: { flexDirection: "row", alignItems: "center", gap: S.sm, paddingHorizontal: S.md, paddingTop: 10, paddingBottom: 8 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 17, color: C.label },
  sub: { fontSize: 13, color: C.secondary },
  actions: { flexDirection: "row", alignItems: "stretch", gap: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.separator },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: S.md },
  actionText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  transferIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  amounts: { alignItems: "flex-end", gap: 4 },
}));
