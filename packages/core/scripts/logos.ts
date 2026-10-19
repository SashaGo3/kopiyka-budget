/**
 * Writes the brand marks a recurring payment can wear (logos.ts):
 *   - src/logos.data.ts — each mark's name, colour and the words that find it,
 *   - apps/mobile/assets/icons/logos/<slug>.svg — its shape, which react-native-nano-icons turns
 *     into one icon font at prebuild, so the app draws a mark as a single native glyph and the
 *     paths never travel in the JS bundle.
 *
 *   bun run scripts/logos.ts
 *
 * Two sources, both dev dependencies of this package:
 *   - Simple Icons (CC0): the brand's own mark as one filled path, and its colour. First choice.
 *   - Arcticons (CC BY-SA 4.0, by Donnnno and the Arcticons team): line drawings of app icons,
 *     for the services Simple Icons does not carry — the ones whose owners had it taken down
 *     (Disney, Amazon, Microsoft, Adobe, LinkedIn…) and most Polish and Ukrainian ones. Their
 *     strokes are hairlines on a 48 grid, made to be drawn big on a launcher, so they are thickened
 *     and turned into filled outlines here (Skia's path ops, through canvaskit-wasm); a font glyph
 *     has no strokes. Arcticons carries no colour, so those entries name their own `hex`.
 * The font built from these files is therefore CC BY-SA 4.0 (assets/icons/logos/LICENSE.md), and
 * the app credits Arcticons where it lists its sources.
 *
 * Only the services listed below are written: a recurring payment is a subscription, a utility, a
 * phone plan or a bank fee, not a shop. A payment for anything else takes an emoji, a symbol or an
 * App Store icon instead.
 *
 * `terms` are what a payee has to contain, as whole words, for the mark to be put on a payment
 * nobody gave an icon to — the brand's title when omitted. They go through `normalizeName`, so
 * "Canal+" is "canal" and "Київстар" stays Cyrillic. A generic word ("Box", "Signal", "Play") gets
 * a narrower term, or none at all (`[]`: offered in the picker, never guessed). `weak` marks a
 * name that also fronts somebody else's charge ("PAYPAL *NETFLIX", "GOOGLE *YouTube"): it is
 * guessed only when nothing else in the payee is.
 */
import * as si from "simple-icons";
import arcticons from "@iconify-json/arcticons/icons.json";
import CanvasKitInit, { type Path } from "canvaskit-wasm";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeName } from "../src/logos";

type Opts = { terms?: string[]; weak?: boolean; arc?: string; hex?: string };
type Pick = [title: string, opts?: Opts];
/** An Arcticons drawing: its icon name and the brand colour to put it on. */
const arc = (name: string, hex: string, o: Omit<Opts, "arc" | "hex"> = {}): Opts => ({ ...o, arc: name, hex });

const PICKS: Pick[] = [
  // Video, music, books
  ["Netflix"], ["Spotify"], ["YouTube", { terms: ["youtube", "youtube premium"] }], ["YouTube Music"],
  ["Apple TV", { terms: ["apple tv"] }], ["Apple Music", { terms: ["apple music"] }], ["Apple Arcade", { terms: ["apple arcade"] }],
  ["Apple Podcasts", { terms: ["apple podcasts"] }], ["iCloud", { terms: ["icloud"] }], ["Apple", { terms: ["apple", "apple com bill", "apple com"], weak: true }],
  ["Disney+", arc("disney", "01147C", { terms: ["disney plus", "disneyplus", "disney"] })],
  ["Prime Video", arc("amazon-prime-video", "00A8E1", { terms: ["prime video", "primevideo", "amazon prime", "prime video channels"] })],
  ["Amazon", arc("amazon", "FF9900", { terms: ["amazon", "amzn"], weak: true })],
  ["HBO Max", { terms: ["hbo max", "max com"] }], ["HBO"], ["Paramount+", { terms: ["paramount"] }], ["Crunchyroll"],
  ["SkyShowtime", arc("skyshowtime", "1B1464")], ["Canal+", arc("mycanal", "000000", { terms: ["canal", "canal plus", "canalplus"] })],
  ["Viaplay", arc("viaplay", "2A0D45")], ["DAZN", arc("dazn", "0C161C")], ["Hulu", arc("hulu", "1CE783")],
  ["Megogo", arc("megogo", "1D1D35", { terms: ["megogo", "мегого"] })],
  ["Tidal"], ["Deezer"], ["SoundCloud"], ["Audible"], ["Storytel", arc("storytel", "FF501C")], ["Audioteka", arc("audioteka", "F18A00")],
  ["Kindle", arc("kindle", "232F3E", { terms: ["kindle", "kindle unlimited"] })], ["Empik", arc("empik", "1D1D1B", { terms: ["empik", "empik premium", "empik go"] })],
  ["Pocket Casts"], ["Plex"], ["Twitch"], ["Patreon"], ["Substack"],
  ["Medium", { terms: ["medium com"] }], ["New York Times", { terms: ["new york times", "nytimes"] }], ["Vimeo"], ["Bandcamp"], ["Last.fm", { terms: ["last fm"] }],
  // Google, Microsoft
  ["Google Play", { terms: ["google play"] }], ["Google One", arc("google-one", "4285F4", { terms: ["google one", "google storage"] })],
  ["Google Drive", { terms: ["google drive"] }], ["Google Cloud", { terms: ["google cloud", "gcp"] }], ["Google Gemini", { terms: ["gemini"] }], ["Google", { weak: true }],
  ["Microsoft 365", arc("microsoft-365", "D83B01", { terms: ["microsoft 365", "office 365", "microsoft office"] })],
  ["Microsoft", arc("microsoft", "737373", { terms: ["microsoft", "msft"], weak: true })], ["LinkedIn", arc("linkedin", "0A66C2")],
  // Games
  ["PlayStation", { terms: ["playstation", "psn", "sony interactive"] }], ["Xbox Game Pass", arc("xbox-gamepass", "107C10", { terms: ["game pass", "gamepass"] })],
  ["Xbox", arc("xbox", "107C10")], ["Nintendo", arc("nintendo", "E60012", { terms: ["nintendo", "nintendo switch online"] })],
  ["Steam", { terms: ["steam", "steampowered", "valve"] }], ["Epic Games", { terms: ["epic games"] }], ["EA", { terms: ["electronic arts", "ea com"] }], ["Ubisoft"], ["Roblox"],
  ["Riot Games", { terms: ["riot games"] }], ["Battle.net", { terms: ["battle net", "blizzard"] }], ["GOG.com", { terms: ["gog com", "gog"] }], ["Humble Bundle", { terms: ["humble bundle", "humblebundle"] }],
  // AI and tools
  ["ChatGPT", arc("openai-chatgpt", "10A37F", { terms: ["chatgpt", "openai"] })], ["Claude", { terms: ["claude ai", "claude"] }], ["Anthropic"], ["Perplexity"],
  ["Cursor", { terms: ["cursor", "anysphere"] }], ["Mistral AI", { terms: ["mistral"] }], ["ElevenLabs"],
  ["Adobe", arc("adobe-creative-cloud", "DA1F26", { terms: ["adobe", "creative cloud"] })], ["Photoshop", arc("adobe-photoshop", "31A8FF", { terms: ["photoshop"] })], ["Lightroom", arc("adobe-lightroom", "31A8FF", { terms: ["lightroom"] })],
  ["Notion"], ["Figma"], ["Dropbox"], ["GitHub"], ["GitLab"], ["1Password", { terms: ["1password", "agilebits"] }], ["Bitwarden"],
  ["Evernote"], ["Todoist"], ["Obsidian"], ["Raycast"], ["Setapp"], ["Grammarly"], ["JetBrains"], ["Zoom", { terms: ["zoom us", "zoom com", "zoom video"] }],
  ["Trello"], ["Miro"], ["Asana"], ["ClickUp"], ["Atlassian"], ["Jira"], ["Linear", { terms: ["linear app"] }],
  ["Things", { terms: ["culturedcode", "cultured code"] }], ["Kagi"], ["Box", { terms: ["box com"] }], ["Mega", { terms: ["mega nz", "mega io"] }],
  // Hosting and infrastructure
  ["Vercel"], ["Netlify"], ["DigitalOcean", { terms: ["digitalocean", "digital ocean"] }], ["Cloudflare"], ["Hetzner"], ["Docker"],
  ["Render", { terms: ["render com"] }], ["Railway", { terms: ["railway app"] }], ["Supabase"], ["Firebase"], ["Backblaze"], ["Tailscale"],
  ["Hostinger"], ["GoDaddy"], ["Namecheap"], ["Porkbun"], ["Shopify"], ["Squarespace"], ["Wix", { terms: ["wix com"] }],
  // Privacy
  ["NordVPN", { terms: ["nordvpn", "nordsec", "nord vpn"] }], ["ExpressVPN"], ["Surfshark"], ["Proton VPN", { terms: ["proton vpn"] }],
  ["Proton Mail", { terms: ["proton mail", "protonmail"] }], ["Proton", { terms: ["proton ag", "proton me"] }],
  // Social, messaging, dating
  ["Telegram", { terms: ["telegram"] }], ["Discord", { terms: ["discord", "discord nitro"] }], ["WhatsApp"], ["Signal", { terms: [] }],
  ["X", { terms: ["twitter", "x premium", "x corp"] }], ["Instagram"], ["Facebook", { terms: ["facebook", "facebk"] }], ["Pinterest"], ["Reddit"],
  ["Tinder"], ["Bumble", arc("bumble", "FFC629")], ["Badoo", arc("badoo", "783BF9")],
  // Learning and health
  ["Duolingo"], ["Headspace"], ["Calm", arc("calm", "3C82D7", { terms: ["calm com"] })], ["Strava"], ["Coursera"], ["Udemy"], ["Skillshare"], ["Peloton"], ["Fitbit"], ["Garmin"],
  ["Medicover", arc("medicover", "0D2C6C", { terms: ["medicover", "medicoversport", "medicover sport"] })],
  ["ZnanyLekarz", arc("znanylekarz", "00C3A5", { terms: ["znanylekarz", "znany lekarz", "docplanner"] })], ["Helsi", arc("helsi", "2EA3F2", { terms: ["helsi"] })],
  // Getting about and food
  ["Uber Eats", { terms: ["uber eats", "ubereats"] }], ["Uber"], ["Bolt Food", arc("bolt-food", "34D186", { terms: ["bolt food"] })], ["Bolt", arc("bolt", "34D186", { terms: ["bolt eu", "bolt"] })],
  ["Uklon", arc("uklon", "FFD100", { terms: ["uklon", "уклон"] })], ["Wolt", arc("wolt", "009DE0")], ["Glovo"], ["Just Eat", arc("just-eat", "FF8000", { terms: ["just eat", "pyszne", "pyszne pl"] })],
  ["Lyft"], ["Jakdojade", arc("jakdojade", "1D9F58")], ["Airbnb"], ["Booking.com", { terms: ["booking com"] }], ["Tesla"],
  // Shopping memberships and post
  ["Allegro", { terms: ["allegro", "allegro smart"] }], ["InPost", arc("inpost-mobile", "FFCD00", { terms: ["inpost"] })],
  ["OLX", arc("olx", "002F34")], ["Rozetka", arc("rozetka", "00A046", { terms: ["rozetka", "розетка"] })], ["Ukrposhta", arc("ukrposhta", "FFCC00", { terms: ["ukrposhta", "укрпошта"] })],
  // Money
  ["Revolut"], ["Wise", { terms: ["wise com", "transferwise"] }], ["PayPal", { weak: true }],
  ["mBank", arc("mbank", "C4161C", { terms: ["mbank"] })], ["PKO BP", arc("iko", "004C9A", { terms: ["pko", "pko bp", "pko bank polski"] })],
  ["Santander", arc("santander", "EC0000")], ["ING", arc("ing", "FF6200", { terms: ["ing bank", "ing bank slaski"] })],
  ["Pekao", arc("peopay", "D7141F", { terms: ["pekao", "bank pekao"] })], ["Alior Bank", arc("alior-mobile", "A6192E", { terms: ["alior"] })],
  ["Monobank", arc("monobank", "000000", { terms: ["monobank", "монобанк"] })], ["Privat24", arc("privat24", "8DC641", { terms: ["privat24", "privatbank", "приватбанк"] })],
  ["Oschadbank", arc("oschad", "0A7A4B", { terms: ["oschad", "oschadbank", "ощадбанк"] })], ["Raiffeisen", arc("raiffeisen", "FFE600", { terms: ["raiffeisen", "райффайзен"] })],
  ["A-Bank", arc("abank24", "3BB54A", { terms: ["a bank", "abank", "абанк"] })], ["Sense Bank", arc("alfa-bank", "EF3124", { terms: ["sense bank", "alfa bank", "альфа банк"] })],
  ["OTP Bank", arc("otp-bank", "52AE30", { terms: ["otp bank", "отп банк"] })], ["Diia", arc("diia", "000000", { terms: ["diia", "дія"] })],
  // Phone, internet, energy
  ["Vodafone"], ["Orange", { terms: ["orange polska", "orange pl", "orange sa"] }], ["Play", arc("play24", "6C1D99", { terms: ["play24", "p4 sp z o o", "play mobile"] })],
  ["Kyivstar", arc("mykyivstar", "0077C8", { terms: ["kyivstar", "київстар"] })], ["lifecell", arc("lifecell", "FFD200", { terms: ["lifecell", "лайфселл"] })],
  ["PGE", arc("pge", "0071BC", { terms: ["pge", "pge obrot"] })], ["Energa", arc("energa", "6D2077")], ["Tauron", arc("moj-tauron", "E2007A", { terms: ["tauron"] })],
];

const CK = await CanvasKitInit();
/** How thick an Arcticons line becomes, on its 48 grid: its own 1 is a hairline at 14 points. */
const STROKE = 3.2;

const all = Object.values(si as unknown as Record<string, { title: string; slug: string; hex: string; path: string }>).filter((x) => x && typeof x === "object" && "slug" in x);
const byTitle = new Map(all.map((i) => [i.title.toLowerCase(), i]));
const arcIcons = (arcticons as { icons: Record<string, { body: string }>; aliases?: Record<string, { parent: string }> });

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** One element of an Arcticons drawing as a Skia path, or null for what is not geometry. */
function elementPath(tag: string, a: Record<string, string>): Path | null {
  const n = (k: string) => Number(a[k] ?? 0);
  if (tag === "path") return CK.Path.MakeFromSVGString(a.d ?? "");
  const p = new CK.Path();
  if (tag === "circle") p.addCircle(n("cx"), n("cy"), n("r"));
  else if (tag === "rect") { const r = n("rx") || n("ry"); p.addRRect(CK.RRectXY(CK.XYWHRect(n("x"), n("y"), n("width"), n("height")), r, n("ry") || r)); }
  else { p.delete(); return null; }
  return p;
}

/** An Arcticons drawing as one filled outline on its 48 grid: strokes thickened, fills kept, all unioned. */
function arcOutline(name: string): string {
  const icon = arcIcons.icons[name] ?? arcIcons.icons[arcIcons.aliases?.[name]?.parent ?? ""];
  if (!icon) throw new Error(`Arcticons has no "${name}"`);
  const out = new CK.Path();
  const inherited: Record<string, string>[] = [{}];
  for (const m of icon.body.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, selfClose] = m as unknown as [string, string, string, string, string];
    if (close) { if (tag === "g") inherited.pop(); continue; }
    const a = { ...inherited[inherited.length - 1], ...attrs(rest) };
    if (tag === "g") { if (!selfClose) inherited.push(a); continue; }
    const geo = elementPath(tag, a);
    if (!geo) continue;
    if (a.fill && a.fill !== "none") out.op(geo, CK.PathOp.Union);
    if (a.stroke && a.stroke !== "none") {
      const s = geo.copy().stroke({ width: STROKE, cap: CK.StrokeCap.Round, join: CK.StrokeJoin.Round });
      if (s) { out.op(s, CK.PathOp.Union); s.delete(); }
    }
    geo.delete();
  }
  out.simplify();
  // `simplify` may answer in even-odd, which an SVG path (and a font glyph) does not carry: a ring
  // would come out a solid disc. Rewound, the same shape fills correctly under non-zero.
  const wound = out.makeAsWinding() ?? out;
  const d = wound.toSVGString();
  if (wound !== out) wound.delete();
  out.delete();
  if (!d) throw new Error(`"${name}" came out empty`);
  return d;
}

const svgDir = join(import.meta.dir, "../../../apps/mobile/assets/icons/logos");
mkdirSync(svgDir, { recursive: true });
for (const f of readdirSync(svgDir)) if (f.endsWith(".svg")) rmSync(join(svgDir, f));
const rows: string[] = [];
const seen = new Set<string>();
let fromArc = 0;
for (const [title, o = {}] of PICKS) {
  const simple = o.arc ? undefined : byTitle.get(title.toLowerCase());
  if (!o.arc && !simple) throw new Error(`Simple Icons has no "${title}" — taken down or renamed; give it an Arcticons drawing`);
  const slug = simple?.slug ?? normalizeName(title).replace(/ /g, "");
  if (seen.has(slug)) throw new Error(`"${title}" twice`);
  seen.add(slug);
  const hex = simple?.hex ?? o.hex!;
  const svg = simple
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${simple.path}"/></svg>\n`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="${arcOutline(o.arc!)}"/></svg>\n`;
  if (!simple) fromArc++;
  writeFileSync(join(svgDir, `${slug}.svg`), svg);
  const terms = (o.terms ?? [title]).map(normalizeName).filter(Boolean);
  rows.push(`  { slug: ${JSON.stringify(slug)}, title: ${JSON.stringify(simple?.title ?? title)}, hex: "${hex}", terms: ${JSON.stringify(terms)}${o.weak ? ", weak: true" : ""} },`);
}

const read = async (p: string) => JSON.parse(await Bun.file(join(import.meta.dir, "../../../node_modules", p, "package.json")).text()) as { version: string };
const [siv, arv] = await Promise.all([read("simple-icons"), read("@iconify-json/arcticons")]);
const out = `// Generated by scripts/logos.ts from Simple Icons ${siv.version} (CC0-1.0) and Arcticons
// (@iconify-json/arcticons ${arv.version}, CC BY-SA 4.0). Do not edit by hand.
// The marks are the trademarks of their owners, shown only to name the service a payment is for.
import type { Logo } from "./logos";

export const LOGOS: readonly Logo[] = [
${rows.join("\n")}
];
`;
writeFileSync(join(import.meta.dir, "../src/logos.data.ts"), out);
console.log(`${rows.length} logos (${fromArc} from Arcticons): src/logos.data.ts ${(out.length / 1024).toFixed(0)} KB, SVGs in ${svgDir}`);
