/**
 * A website's own icon, for a recurring payment no built-in mark or app covers — an insurer or a
 * landlord with a site and no app (`recurring_rules.icon` = `img:<data URI>`, core's logos.ts).
 *
 * The site is asked directly, while the icon picker is open on a payment that names it or after
 * its address is typed (the picker says so at its foot): its home page for
 * the icons it declares, then the conventional `/apple-touch-icon.png` and `/favicon.ico`. No icon
 * service sits in between, so nobody but that site learns which one was looked up. The largest
 * home-screen icon wins, shrunk to a tile's size (lib/iconImage.ts) before it goes in the row. A
 * site behind a bot check (a Cloudflare challenge) answers nothing usable; Photos is the way there.
 *
 * A payment's name is written by whoever was paid, so a site named in it is a stranger's choice, and
 * the picker asks it without a tap. Hence:
 *   - public HTTPS only: never an IP address, `localhost` or a local-network name (the app is allowed
 *     local networking for development), checked again on every URL after redirects;
 *   - no cookies either way, a timeout, a size cap on the page and on the icon, four icons at most;
 *   - an icon is decoded only when its first bytes say PNG, JPEG, ICO, GIF or WebP — the image
 *     decoder is the one part of this that parses a stranger's bytes — and what is kept is the app's
 *     own 120-px PNG re-encode of it, never the bytes that came.
 */
import { shrinkIcon } from "@/lib/iconImage";

/** The most a downloaded icon may weigh before shrinking: anything bigger is a photo, not an icon. */
const MAX_ICON_BYTES = 512 * 1024;
/** The most of a home page read for its icon links. */
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
/** How long one request may take. */
const TIMEOUT_MS = 8000;
/** How many icon addresses are tried, best first. */
const MAX_TRIES = 4;
/** Names that are never a public website: local networks, test and special-use domains. */
const RESERVED_TLD = new Set(["local", "localhost", "lan", "home", "internal", "intranet", "corp", "private", "arpa", "test", "invalid", "example", "onion", "localdomain", "domain", "router"]);

/** Second-level names under which the registrable domain is three labels deep (`firma.com.pl`). */
const SECOND_LEVEL = new Set(["com", "co", "org", "net", "gov", "edu", "ac", "biz", "info", "in", "kiev", "kyiv"]);

/**
 * Web addresses written in a payment's names, the site itself before a subdomain of it:
 * "E-BOK.VANTAGERENT.PL" → ["vantagerent.pl", "e-bok.vantagerent.pl"]. An e-mail address counts
 * by its domain; a word that merely has a dot in it ("ul. Polna") does not.
 */
export function domainsIn(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    for (const m of (text ?? "").toLowerCase().matchAll(/(?:https?:\/\/)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,12})(?=$|[\s/:?#),;*])/g)) {
      const host = m[1]!.replace(/^www\./, "");
      if (!isPublicHost(host)) continue;
      const labels = host.split(".");
      const depth = labels.length >= 3 && SECOND_LEVEL.has(labels[labels.length - 2]!) ? 3 : 2;
      const root = labels.slice(-depth).join(".");
      for (const d of [root, host]) if (!out.includes(d)) out.push(d);
    }
  }
  return out;
}

/** What was typed, as a site to ask, when it reads as one ("vantagerent.pl", "https://x.com/a"). */
export function domainOf(text: string): string | null {
  return /\s/.test(text.trim()) ? null : domainsIn(text)[0] ?? null;
}

/** A name on the public internet: two labels or more, not an IP address, not a reserved name. */
export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h || h.includes(":") || /^\d+(\.\d+){3}$/.test(h) || /^\[/.test(h)) return false;
  const labels = h.split(".");
  return labels.length >= 2 && /^[a-z]{2,24}$/.test(labels[labels.length - 1]!) && !RESERVED_TLD.has(labels[labels.length - 1]!);
}

/** The URL when it is HTTPS to a public host, else null. */
function safeUrl(url: string): string | null {
  const m = /^https:\/\/([^/:?#]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  return m && isPublicHost(m[1]!) ? url : null;
}

/** A GET with no cookies, a timeout and a size cap; null on anything unexpected. */
async function get(url: string, maxBytes: number): Promise<{ url: string; type: string; bytes: Uint8Array } | null> {
  if (!safeUrl(url)) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { credentials: "omit", signal: abort.signal });
    // A redirect may have gone anywhere: the answer counts only if it ended somewhere allowed.
    if (!res.ok || (res.url && !safeUrl(res.url))) return null;
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > maxBytes) return null;
    return { url: res.url || url, type: (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(), bytes };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/** What the first bytes say an image is, among the few formats an icon comes in; null for anything else. */
function sniff(b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}

function resolve(href: string, base: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  const origin = /^(https?:\/\/[^/]+)/i.exec(base)?.[1] ?? base;
  if (href.startsWith("//")) return `https:${href}`;
  if (href.startsWith("/")) return origin + href;
  return base.replace(/[^/]*([?#].*)?$/, "") + href;
}

/** The icons a page declares, best first: home-screen icons, then the biggest declared size. */
function declared(html: string, base: string): string[] {
  const found: { url: string; score: number }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href || !/\bicon\b|apple-touch-icon/.test(rel) || rel.includes("mask-icon") || /\.svg(\?|$)/i.test(href)) continue;
    const size = Number(/\bsizes\s*=\s*["'](\d+)x\d+/i.exec(tag)?.[1] ?? 0);
    found.push({ url: resolve(href.replace(/&amp;/g, "&"), base), score: (rel.includes("apple-touch-icon") ? 1000 : 0) + (size || 16) });
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.url);
}

async function asDataUri(url: string): Promise<string | null> {
  const got = await get(url, MAX_ICON_BYTES);
  const mime = got ? sniff(got.bytes) : null;
  if (!got || !mime) return null;
  try {
    const bin = latin1(got.bytes);
    // Re-encoded as PNG: an icon is often a shape on nothing, and JPEG would fill that in black.
    return await shrinkIcon(`data:${mime};base64,${btoa(bin)}`, true);
  } catch { return null; }
}

/**
 * The site's icon as a data URI, ready for `img:`, or null when it has none the app can use (or is
 * not a public site at all).
 */
export async function siteIcon(domain: string): Promise<string | null> {
  if (!isPublicHost(domain)) return null;
  const home = `https://${domain}/`;
  const page = await get(home, MAX_PAGE_BYTES);
  // Where the home page really is after redirects: relative icon links are relative to that.
  const base = page?.url ?? home;
  // Read byte for byte: the <link> tags wanted are ASCII, whatever the page's own encoding.
  const html = page && page.type.includes("html") ? latin1(page.bytes.subarray(0, 300_000)) : "";
  const origin = /^(https:\/\/[^/]+)/i.exec(base)?.[1] ?? `https://${domain}`;
  const tries = [...declared(html, base), `${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`].filter((u) => safeUrl(u));
  for (const url of [...new Set(tries)].slice(0, MAX_TRIES)) {
    const uri = await asDataUri(url);
    if (uri) return uri;
  }
  return null;
}
