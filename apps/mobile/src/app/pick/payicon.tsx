import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { ICON_CATALOG, guessLogo, searchIcons, searchLogos, type Logo } from "@kopiyka/core";
import { resolvePick } from "@/store/pick";
import { LogoTile } from "@/components/PaymentIcon";
import { C, S, themed } from "@/constants/theme";
import { domainOf, domainsIn, siteIcon } from "@/lib/siteIcon";
import { iconFromPhotos } from "@/lib/iconImage";
import { t } from "@/i18n";

const COLS = 7;
/** How long typing has to pause before a typed site is asked. */
const ONLINE_DELAY_MS = 450;

/** Anything an emoji keyboard types: a pictograph, or a flag's regional letters. */
const EMOJI = (() => {
  try { return new RegExp("[\\p{Extended_Pictographic}\\p{Regional_Indicator}]", "u"); }
  catch { return /[☀-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/; }
})();

/** A website's own icon, already fetched and shrunk. */
type Web = { domain: string; uri: string };
type Cell = { kind: "logo"; logo: Logo } | { kind: "sf"; name: string } | { kind: "web"; web: Web } | { kind: "photo" };
type Line = { kind: "head"; title: string; busy?: boolean } | { kind: "row"; cells: Cell[] };

function rows(cells: Cell[]): Line[] {
  const out: Line[] = [];
  for (let i = 0; i < cells.length; i += COLS) out.push({ kind: "row", cells: cells.slice(i, i + COLS) });
  return out;
}

const cellKey = (c: Cell) => c.kind === "logo" ? `logo:${c.logo.slug}` : c.kind === "sf" ? `sf:${c.name}` : c.kind === "photo" ? "photo"
  : `site:${c.web.domain}`;

/**
 * What a recurring payment is drawn with (`recurring_rules.icon`, core's logos.ts), as one grid of
 * icons to tap: pictures (a crop from Photos, a website's own icon), the built-in brand marks, then
 * the category symbols. Resolves the stored form — `logo:<slug>`, `img:<data URI>`,
 * `emoji:<text>`, `sf:<name>`, `category` — or "" for Automatic, which is NULL.
 *
 * The search field filters the marks and symbols on the phone; a web address typed into it is asked
 * for its own icon once typing pauses. With nothing typed, a site written in the payment's names
 * (E-BOK.VANTAGERENT.PL) is asked instead. Nothing else leaves the phone, and the foot of the list
 * says so (lib/siteIcon.ts). App Store icons are deliberately not offered: Apple's Search API terms
 * allow its artwork only to promote the app, beside a store badge.
 */
export default function PickPaymentIcon() {
  const { key, selected, payee, match } = useLocalSearchParams<{ key: string; selected?: string; payee?: string; match?: string }>();
  const [q, setQ] = useState("");
  const [emoji, setEmoji] = useState("");
  const guess = useMemo(() => guessLogo(payee, match), [payee, match]);
  const ql = q.trim();
  const choose = (value: string) => { resolvePick(key, value); router.back(); };

  // Website icons: the site typed, or with nothing typed the sites the payment's names spell out.
  const [web, setWeb] = useState<{ items: Web[]; busy: boolean }>({ items: [], busy: false });
  const [taking, setTaking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const typedSite = domainOf(ql);
    const domains = typedSite ? [typedSite] : ql ? [] : domainsIn(payee, match).slice(0, 2);
    if (!domains.length) { setWeb({ items: [], busy: false }); return; }
    let alive = true;
    setWeb((w) => ({ ...w, busy: true }));
    const timer = setTimeout(async () => {
      const sites = await Promise.all(domains.map((domain) => siteIcon(domain).then((uri) => (uri ? { domain, uri } : null)).catch(() => null)));
      if (!alive) return;
      // Two spellings of one site (vantagerent.pl, e-bok.vantagerent.pl) often answer with one icon.
      const items = sites.filter((s): s is Web => !!s).filter((s, i, all) => all.findIndex((o) => o.uri === s.uri) === i);
      setWeb({ items, busy: false });
    }, ql ? ONLINE_DELAY_MS : 0);
    return () => { alive = false; clearTimeout(timer); };
  }, [ql, payee, match]);

  const take = async (cell: Cell) => {
    setFailed(false);
    if (cell.kind === "logo" || cell.kind === "sf") { choose(cellKey(cell)); return; }
    setTaking(cellKey(cell));
    try {
      const uri = cell.kind === "photo" ? await iconFromPhotos() : cell.web.uri;
      if (uri) choose(`img:${uri}`);
    } catch { setFailed(true); }
    setTaking(null);
  };

  const lines = useMemo<Line[]>(() => {
    const online = domainOf(ql);
    const pictures: Cell[] = [{ kind: "photo" }, ...web.items.map((w): Cell => ({ kind: "web", web: w }))];
    const logos = online ? [] : searchLogos(ql).map((logo): Cell => ({ kind: "logo", logo }));
    const symbols = online ? [] : (ql ? searchIcons(ql) : ICON_CATALOG).map((i): Cell => ({ kind: "sf", name: i.name }));
    return [
      { kind: "head", title: t("pick.payIcon.pictures"), busy: web.busy }, ...rows(pictures),
      ...(logos.length ? [{ kind: "head" as const, title: t("pick.payIcon.logos") }, ...rows(logos)] : []),
      ...(symbols.length ? [{ kind: "head" as const, title: t("pick.payIcon.symbols") }, ...rows(symbols)] : []),
    ];
  }, [ql, web]);

  const onEmoji = (text: string) => {
    setEmoji(text);
    // The emoji keyboard types a whole emoji at once, so the first one is the answer.
    const chars = Array.from(text.trim());
    if (chars.some((c) => EMOJI.test(c))) choose(`emoji:${chars.slice(0, 8).join("")}`);
  };
  const option = (label: string, value: string, left: React.ReactNode) => (
    <Pressable onPress={() => choose(value)} style={styles.optRow} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: (selected ?? "") === value }}>
      {left}
      <Text style={styles.optText} numberOfLines={1}>{label}</Text>
      {(selected ?? "") === value ? <SymbolView name="checkmark" size={16} tintColor={C.tint} /> : null}
    </Pressable>
  );
  const label = (c: Cell) => c.kind === "logo" ? c.logo.title : c.kind === "sf" ? c.name.replace(/\./g, " ") : c.kind === "photo" ? t("pick.payIcon.photo")
    : c.web.domain;

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: C.bgGrouped }}
      data={lines}
      keyExtractor={(l, i) => (l.kind === "head" ? `h${l.title}` : `r${i}`)}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingHorizontal: S.lg, paddingBottom: 60 }}
      ListHeaderComponent={
        <View>
          <View style={styles.search}>
            <SymbolView name="magnifyingglass" size={16} tintColor={C.tertiary} />
            <TextInput value={q} onChangeText={setQ} placeholder={t("pick.payIcon.search")} placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} autoCapitalize="none" clearButtonMode="while-editing" accessibilityLabel={t("pick.payIcon.search")} />
          </View>
          {!ql ? (
            <>
              {option(guess ? t("pick.payIcon.automaticFound", { name: guess.title }) : t("pick.automatic"), "",
                guess ? <LogoTile logo={guess} size={28} /> : <View style={styles.optIcon}><SymbolView name="wand.and.stars" size={14} tintColor={C.tertiary} /></View>)}
              {option(t("pick.payIcon.category"), "category", <View style={styles.optIcon}><SymbolView name="folder" size={14} tintColor={C.tertiary} /></View>)}
              <View style={styles.optRow}>
                <View style={styles.optIcon}><SymbolView name="face.smiling" size={14} tintColor={C.tertiary} /></View>
                <TextInput value={emoji} onChangeText={onEmoji} placeholder={t("pick.payIcon.emoji")} placeholderTextColor={C.tertiary} style={styles.input} autoCorrect={false} accessibilityLabel={t("pick.payIcon.emoji")} />
              </View>
            </>
          ) : null}
          {failed ? <Text style={styles.hint}>{t("pick.payIcon.photoFailed")}</Text> : null}
        </View>
      }
      ListFooterComponent={<View style={{ marginTop: S.lg, gap: S.sm }}><Text style={styles.hint}>{t("pick.payIcon.webHint")}</Text><Text style={styles.hint}>{t("pick.payIcon.credit")}</Text></View>}
      renderItem={({ item }) => {
        if (item.kind === "head") return <View style={styles.headRow}><Text style={styles.group}>{item.title}</Text>{item.busy ? <ActivityIndicator size="small" /> : null}</View>;
        return (
          <View style={styles.row}>
            {item.cells.map((cell) => {
              const k = cellKey(cell);
              const on = selected === k;
              return (
                <Pressable key={k} onPress={() => void take(cell)} disabled={!!taking} style={[styles.cell, on && { borderColor: C.tint }]}
                  accessibilityRole="button" accessibilityLabel={label(cell)} accessibilityState={{ selected: on }}>
                  {taking === k ? <ActivityIndicator size="small" />
                    : cell.kind === "logo" ? <LogoTile logo={cell.logo} size={26} />
                    : cell.kind === "sf" ? <SymbolView name={cell.name as SFSymbol} size={18} tintColor={on ? C.tint : C.secondary} />
                    : cell.kind === "photo" ? <SymbolView name="photo.badge.plus" size={18} tintColor={C.tint} />
                    : <Image source={{ uri: cell.web.uri }} style={styles.picture} />}
                </Pressable>
              );
            })}
            {Array.from({ length: COLS - item.cells.length }, (_, i) => <View key={`pad${i}`} style={[styles.cell, styles.pad]} pointerEvents="none" />)}
          </View>
        );
      }}
    />
  );
}

const styles = themed(() => StyleSheet.create({
  search: { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: S.lg, marginBottom: S.md, paddingHorizontal: S.md, height: 40, borderRadius: 12, backgroundColor: C.fill },
  input: { flex: 1, fontSize: 17, color: C.label, height: 40 },
  optRow: { flexDirection: "row", alignItems: "center", gap: S.md, minHeight: 40, marginBottom: S.xs },
  optIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" },
  optText: { flex: 1, fontSize: 17, color: C.label },
  hint: { fontSize: 13, color: C.secondary },
  headRow: { flexDirection: "row", alignItems: "center", gap: S.sm, marginTop: S.sm, marginBottom: S.xs },
  group: { fontSize: 13, fontWeight: "600", color: C.secondary, textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", gap: 6 },
  cell: { flex: 1, aspectRatio: 1, maxWidth: 42, minHeight: 40, borderRadius: 10, backgroundColor: C.card, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent", marginBottom: 6 },
  picture: { width: 26, height: 26, borderRadius: 7 },
  pad: { backgroundColor: "transparent", borderColor: "transparent" },
}));
