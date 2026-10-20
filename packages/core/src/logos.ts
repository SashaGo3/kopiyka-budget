/**
 * What a recurring payment is drawn with: a brand's own mark, an emoji, or a symbol.
 *
 * `recurring_rules.icon` (v21) holds one of
 *   - `logo:<slug>`  a mark from `LOGOS` (logos.data.ts, generated from Simple Icons; the shapes
 *                    are the app's icon font, apps/mobile/assets/icons/logos),
 *   - `img:<data URI>` a picture — a website's own icon or a crop from Photos, a PNG or JPEG —
 *                    shrunk to 120 px once when it was chosen and kept in the row itself, so it
 *                    travels with backups and the other device without a file of its own,
 *   - `emoji:<text>` one emoji, as typed,
 *   - `sf:<name>`    an SF Symbol from the category icon catalogue,
 *   - `category`     the category's icon, on purpose — the answer to a wrong guess,
 *   - NULL           nobody chose: the payee is matched against the marks (`guessLogo`), and with
 *                    no match the payment wears its category's icon.
 * Anything else is read as NULL, so a value a later build invents degrades to a guess rather than
 * to nothing.
 */
import { LOGOS } from "./logos.data";

export interface Logo {
  slug: string;
  title: string;
  /** The brand's colour, six hex digits without `#`. */
  hex: string;
  /** Normalised words a payee must contain, as whole words, for the mark to be guessed. Empty: never guessed. */
  terms: string[];
  /** A name that also fronts other people's charges ("PAYPAL *NETFLIX"): guessed only when nothing else is. */
  weak?: boolean;
}

export { LOGOS };

export type PaymentIcon =
  | { kind: "logo"; logo: Logo }
  | { kind: "img"; uri: string }
  | { kind: "emoji"; emoji: string }
  | { kind: "sf"; name: string }
  | { kind: "category" };

/** The longest picture a row may carry: a 120-px icon is a few KB, so 256 KB is generous. */
export const MAX_IMG_CHARS = 256 * 1024;

const bySlug = new Map(LOGOS.map((l) => [l.slug, l]));

export function logoBySlug(slug: string): Logo | null { return bySlug.get(slug) ?? null; }

/**
 * Lower case, accents off, anything that is not a letter or a digit a single space. Latin and
 * Cyrillic letters both count — "Київстар" is a name, not punctuation — and "ł", which has no
 * accent to take off, is spelled "l".
 */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/ł/g, "l").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\u0400-\u04ff]+/g, " ").trim();
}

/** What a stored value says, or null when it says nothing a person chose (NULL, empty or unknown). */
export function parsePaymentIcon(value: string | null | undefined): PaymentIcon | null {
  if (!value) return null;
  if (value === "category") return { kind: "category" };
  const i = value.indexOf(":");
  if (i < 0) return null;
  const kind = value.slice(0, i), rest = value.slice(i + 1);
  if (!rest) return null;
  if (kind === "logo") { const logo = bySlug.get(rest); return logo ? { kind: "logo", logo } : null; }
  // Only what the app itself writes — a small PNG or JPEG — so a hand-made backup cannot hand the
  // image decoder an exotic format or a picture the size of a photo library.
  if (kind === "img") return /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(rest) && rest.length <= MAX_IMG_CHARS ? { kind: "img", uri: rest } : null;
  if (kind === "emoji") return { kind: "emoji", emoji: rest };
  if (kind === "sf") return { kind: "sf", name: rest };
  return null;
}

/**
 * The mark a payee names, if any: every term must appear as whole words, the longest term wins
 * ("Apple Music" over "Apple"), and a weak name only when nothing else matched.
 */
export function guessLogo(...names: (string | null | undefined)[]): Logo | null {
  let best: { logo: Logo; len: number; weak: boolean } | null = null;
  for (const name of names) {
    if (!name) continue;
    const hay = ` ${normalizeName(name)} `;
    if (hay.length <= 2) continue;
    for (const logo of LOGOS) {
      for (const term of logo.terms) {
        if (!term || !hay.includes(` ${term} `)) continue;
        const cand = { logo, len: term.length, weak: !!logo.weak };
        if (!best || (best.weak && !cand.weak) || (best.weak === cand.weak && cand.len > best.len)) best = cand;
      }
    }
  }
  return best?.logo ?? null;
}

/** What a rule is drawn with: what was chosen, else a guess from its names, else its category. */
export function resolvePaymentIcon(rule: { icon?: string | null; payee?: string | null; match_payee?: string | null }): PaymentIcon {
  const chosen = parsePaymentIcon(rule.icon);
  if (chosen) return chosen;
  const logo = guessLogo(rule.payee, rule.match_payee);
  return logo ? { kind: "logo", logo } : { kind: "category" };
}

/** Marks whose title starts with, then contains, the query; every mark for an empty one. */
export function searchLogos(query: string): Logo[] {
  const q = normalizeName(query);
  if (!q) return [...LOGOS].sort((a, b) => a.title.localeCompare(b.title));
  const starts: Logo[] = [], has: Logo[] = [];
  for (const l of LOGOS) {
    const title = normalizeName(l.title);
    if (title.startsWith(q) || l.slug.startsWith(q.replace(/ /g, ""))) starts.push(l);
    else if (title.includes(q) || l.terms.some((t) => t.includes(q))) has.push(l);
  }
  return [...starts, ...has];
}

/**
 * What a rule shows, in the stored form: the icon chosen, else `logo:<slug>` for a mark its names
 * match; null when it wears its category's icon. What a screen hands to its icon view.
 */
export function shownPaymentIcon(rule: { icon?: string | null; payee?: string | null; match_payee?: string | null }): string | null {
  if (parsePaymentIcon(rule.icon)) return rule.icon === "category" ? null : rule.icon!;
  const logo = guessLogo(rule.payee, rule.match_payee);
  return logo ? `logo:${logo.slug}` : null;
}
