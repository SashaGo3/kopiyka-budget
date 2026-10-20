import { Image, Text, View, type ColorValue } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { createNanoIconSet } from "react-native-nano-icons";
// Built at prebuild from assets/icons/logos (core's scripts/logos.ts writes the SVGs).
import glyphMap from "../../assets/icons/nanoicons/kp-logos.glyphmap.json";
import { iconFor, parsePaymentIcon, type Logo } from "@kopiyka/core";
import { CategoryIcon, TILE_ALPHA } from "@/components/ui";
import { C } from "@/constants/theme";

/** The brand marks as one icon font: a mark is a single native glyph, not a tree of SVG views. */
const Mark = createNanoIconSet(glyphMap);

/** Dark marks on a light tile and light on a dark one: a brand's colour can be black (Apple, X) or yellow. */
function inkOn(hex: string): string {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 165 ? "#000000" : "#FFFFFF";
}

/** A brand's mark on its own colour, the way its app icon would show it. */
export function LogoTile({ logo, size }: { logo: Logo; size: number }) {
  const glyph = size * 0.6;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: `#${logo.hex}`, alignItems: "center", justifyContent: "center" }}>
      <Mark name={logo.slug as keyof typeof glyphMap.i} size={glyph} color={inkOn(logo.hex)} allowFontScaling={false} accessible={false} />
    </View>
  );
}

/**
 * A recurring payment's icon (`recurring_rules.icon`, read through core's logos.ts): its brand mark,
 * emoji or symbol, with its category's icon as a small badge on the corner — so Netflix still says
 * "Subscriptions". With nothing of its own it wears the category's icon, badged with a repeat
 * arrow so it still reads as a payment that comes back.
 */
export function PaymentIcon({ icon, category, size = 24, cutout = C.card }: {
  /** The stored value, or what a checklist line resolved it to. */
  icon: string | null | undefined;
  category?: { name: string; icon?: string | null; color?: string | null } | null;
  size?: number;
  /** The background behind the badge, drawn as a ring so the badge reads as cut out of the tile. */
  cutout?: ColorValue;
}) {
  const own = parsePaymentIcon(icon);
  const badge = Math.round(size * 0.52);
  const cat = category ? iconFor(category.name, { icon: category.icon ?? null, color: category.color ?? null }) : null;
  const main = !own || own.kind === "category"
    ? <CategoryIcon name={category?.name ?? "?"} icon={category?.icon} color={category?.color} size={size} />
    : own.kind === "logo" ? <LogoTile logo={own.logo} size={size} />
    : own.kind === "img" ? <Image source={{ uri: own.uri }} style={{ width: size, height: size, borderRadius: size * 0.28 }} />
    : own.kind === "emoji"
      ? <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: size * 0.62 }} allowFontScaling={false}>{own.emoji}</Text></View>
      : <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: (cat?.color ?? "#8E8E93") + TILE_ALPHA, alignItems: "center", justifyContent: "center" }}><SymbolView name={own.name as SFSymbol} size={size * 0.55} tintColor={cat?.color ?? C.secondary} /></View>;
  const showCategory = !!own && own.kind !== "category" && !!cat;
  return (
    <View style={{ width: size + badge * 0.3, height: size + badge * 0.3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {main}
      <View style={{ position: "absolute", right: 0, bottom: 0, width: badge, height: badge, borderRadius: badge * 0.32, borderWidth: 1.5, borderColor: cutout,
        backgroundColor: showCategory ? undefined : C.fill, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        {showCategory
          ? <View style={{ width: "100%", height: "100%", backgroundColor: C.card, alignItems: "center", justifyContent: "center" }}>
              <View style={{ position: "absolute", inset: 0, backgroundColor: cat!.color + "40" }} />
              <SymbolView name={cat!.icon as SFSymbol} size={badge * 0.6} tintColor={cat!.color} />
            </View>
          : <SymbolView name="repeat" size={badge * 0.55} tintColor={C.secondary} />}
      </View>
    </View>
  );
}
