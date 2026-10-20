#!/usr/bin/env node
/**
 * Uploads the product page header and search results art (screenshots/Finals/<store lang>/creative/)
 * to the App Store version open for editing, through the App Store Connect API's asset library —
 * which fastlane deliver does not speak yet, so upload.sh runs this after it.
 *
 *   node scripts/screenshots/upload-creative.mjs                # the version open for editing
 *   node scripts/screenshots/upload-creative.mjs 1.1.0          # that version
 *   node scripts/screenshots/upload-creative.mjs --lang uk      # one language
 *   node scripts/screenshots/upload-creative.mjs --dry-run      # read everything, change nothing
 *
 * Per language: reserve each image in the app's asset library (category CREATIVE_ASSETS), PUT the
 * bytes to the URLs App Store Connect hands back, commit, and place it on the version's localization
 * as PRODUCT_PAGE_HEADER_ASSET or APP_STORE_SEARCH_RESULTS_ASSET — replacing a placement of that type
 * already there. The placement group is read from the reference data (`appAssetLibraryRefData`), never
 * written down here: Apple adds groups as devices ship. Nothing is submitted: the placements go to
 * App Review with the version. Apple's guides: developer.apple.com/documentation/appstoreconnectapi/
 * uploading-and-managing-image-assets and placing-assets-on-your-app-store-surfaces.
 *
 * Login: the API key in apps/mobile/.env (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID). The key is read
 * in this process and never written anywhere.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = path.resolve(HERE, "../..");
const FINALS = path.join(MOBILE_DIR, "screenshots/Finals");
const API = "https://api.appstoreconnect.apple.com";

/** Which file goes where. The universal 16:9 file is left out: each slot has its own, framed for it. */
const SLOTS = [
  { placementType: "PRODUCT_PAGE_HEADER_ASSET", file: "header-21x9.png", label: "header" },
  { placementType: "APP_STORE_SEARCH_RESULTS_ASSET", file: "search-results-3x2.png", label: "search results" },
];
/** Versions App Store Connect still lets you edit. */
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);

// ---------------------------------------------------------------------------------------------- args

let version = null, onlyLang = null, dryRun = false;
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") dryRun = true;
  else if (a === "--lang") onlyLang = process.argv[++i];
  else if (a.startsWith("--lang=")) onlyLang = a.slice(7);
  else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 21).join("\n")); process.exit(0); }
  else if (!a.startsWith("--")) version = a;
  else fail(`unknown flag ${a}`);
}

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

// ---------------------------------------------------------------------------------------------- auth

function loadEnv() {
  const file = path.join(MOBILE_DIR, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv();
const { ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
if (!ASC_KEY_PATH || !ASC_KEY_ID || !ASC_ISSUER_ID) fail("set ASC_KEY_PATH, ASC_KEY_ID and ASC_ISSUER_ID in apps/mobile/.env (see .env.example)");
const KEY = crypto.createPrivateKey(fs.readFileSync(ASC_KEY_PATH.replace(/^~/, process.env.HOME), "utf8"));

let jwt = null, jwtExp = 0;
function token() {
  const now = Math.floor(Date.now() / 1000);
  if (jwt && now < jwtExp - 60) return jwt;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" });
  jwtExp = now + 15 * 60;
  const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: jwtExp, aud: "appstoreconnect-v1" });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: KEY, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return (jwt = `${head}.${body}.${sig}`);
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith("http") ? url : API + url, {
    method,
    headers: { Authorization: `Bearer ${token()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const why = (json?.errors ?? []).map((e) => `${e.code}: ${e.detail ?? e.title}`).join("; ") || res.statusText;
    throw new Error(`${method} ${url} → ${res.status} ${why}`);
  }
  return json;
}

// ---------------------------------------------------------------------------------------------- png

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length, data: b };
}

// ---------------------------------------------------------------------------------------------- main

const bundleId = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, "app.json"), "utf8")).expo.ios.bundleIdentifier;

const app = (await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`)).data[0];
if (!app) fail(`no app with bundle id ${bundleId} on App Store Connect`);

const versions = (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20&fields[appStoreVersions]=versionString,appStoreState`)).data;
const target = version
  ? versions.find((v) => v.attributes.versionString === version)
  : versions.find((v) => EDITABLE.has(v.attributes.appStoreState));
if (!target) fail(version ? `no iOS version ${version} on App Store Connect` : "no iOS version open for editing");
if (!EDITABLE.has(target.attributes.appStoreState)) fail(`version ${target.attributes.versionString} is ${target.attributes.appStoreState}: placements can only be added to a version still being prepared`);
console.log(`Creative art → ${bundleId} ${target.attributes.versionString} (${target.attributes.appStoreState})${dryRun ? " — dry run" : ""}`);

const localizations = (await api("GET", `/v1/appStoreVersions/${target.id}/appStoreVersionLocalizations?limit=50&fields[appStoreVersionLocalizations]=locale`)).data;
const library = (await api("GET", `/v1/apps/${app.id}/assetLibrary`)).data;

// The placement group each slot uses on an App Store version, and the image sizes it accepts.
const ref = (await api("GET", `/v1/appAssetLibraryRefData?fields[appAssetLibraryRefData]=placementTypes,imageSpecs`)).data[0].attributes;
const specs = new Map((ref.imageSpecs ?? []).map((s) => [s.specId, s]));
/** The library's images with the placements that use them (read afresh: each slot may have changed it). */
async function libraryImages() {
  const out = [];
  let url = `/v1/appAssetLibraries/${library.id}/images?filter[category]=CREATIVE_ASSETS&limit=200&include=placements`;
  while (url) { const page = await api("GET", url); out.push(...page.data); url = page.links?.next ?? null; }
  return out;
}

function groupsFor(placementType, w, h) {
  const type = (ref.placementTypes ?? []).find((t) => t.placementTypeId === placementType);
  if (!type) return [];
  return (type.specMappings ?? []).filter((m) => (m.specs ?? []).some((id) => {
    const d = specs.get(id)?.dimensions;
    return d && w >= d.minWidth && w <= d.maxWidth && h >= d.minHeight && h <= d.maxHeight;
  })).map((m) => m.placementGroupId);
}

for (const lang of fs.readdirSync(FINALS).sort()) {
  if (onlyLang && lang !== onlyLang) continue;
  if (!fs.statSync(path.join(FINALS, lang)).isDirectory()) continue;
  const loc = localizations.find((l) => l.attributes.locale === lang);
  if (!loc) { console.warn(`  ${lang}: the version has no ${lang} localization — skipped`); continue; }
  for (const slot of SLOTS) {
    const file = path.join(FINALS, lang, "creative", slot.file);
    if (!fs.existsSync(file)) { console.warn(`  ${lang}: no ${path.relative(MOBILE_DIR, file)} — skipped`); continue; }
    const png = pngSize(file);
    const groups = groupsFor(slot.placementType, png.w, png.h);
    if (!groups.length) {
      console.warn(`  ${lang}: no placement group of ${slot.placementType} takes ${png.w}×${png.h} — skipped. Reference data:`);
      const ids = (ref.placementTypes ?? []).find((t) => t.placementTypeId === slot.placementType)?.specMappings?.flatMap((m) => m.specs ?? []) ?? [];
      for (const id of ids) console.warn(`    ${JSON.stringify(specs.get(id) ?? id)}`);
      continue;
    }
    const group = groups[0];
    const existing = (await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/placements?filter[placementType]=${slot.placementType}&include=image&limit=50`)).data;
    // Reference names are unique in the library, so each carries a fingerprint of the file: the
    // same picture uploaded again is found and reused rather than refused as a duplicate.
    const prefix = `${slot.label} · ${lang} · `;
    const name = `${prefix}${target.attributes.versionString} · ${crypto.createHash("sha256").update(png.data).digest("hex").slice(0, 8)}`;
    const ours = (await libraryImages()).filter((i) => i.attributes.referenceName?.startsWith(prefix));
    const reuse = ours.find((i) => i.attributes.referenceName === name && !["FAILED", "AWAITING_UPLOAD"].includes(i.attributes.state));
    const placedHere = reuse && existing.some((p) => p.relationships?.image?.data?.id === reuse.id);
    // What an earlier run left half-done (a reservation never uploaded, a failed one), and earlier
    // art nothing is placed on any more: cleared, so the library holds what the store shows.
    const stale = ours.filter((i) => i !== reuse && !(i.relationships?.placements?.data ?? []).length);
    if (dryRun) {
      console.log(`  ${lang} ${slot.label}: ${slot.file} ${png.w}×${png.h} → ${slot.placementType} / ${group}${placedHere ? " (already there)" : reuse ? " (uploaded before; placing it)" : existing.length ? ` (replacing ${existing.length})` : ""}${stale.length ? `; clearing ${stale.length} unused` : ""}`);
      continue;
    }
    for (const i of stale) await api("DELETE", `/v1/appAssetLibraryImages/${i.id}`).catch(() => {});
    if (placedHere) { console.log(`  = ${lang} ${slot.label}: ${slot.file} is already there`); continue; }

    let imageId = reuse?.id, state = reuse?.attributes.state;
    if (!reuse) {
      // Reserve, upload, commit.
      const reserved = (await api("POST", "/v1/appAssetLibraryImages", { data: {
        type: "appAssetLibraryImages",
        attributes: { fileName: `${lang}-${slot.file}`, fileSize: png.bytes, category: "CREATIVE_ASSETS", referenceName: name },
        relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: library.id } } },
      } })).data;
      imageId = reserved.id;
      for (const op of reserved.attributes.uploadOperations ?? []) {
        // The upload URLs are unauthenticated and time-limited: no token goes to them.
        const res = await fetch(op.url, {
          method: op.method,
          headers: Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value])),
          body: png.data.subarray(op.offset, op.offset + op.length),
        });
        if (!res.ok) throw new Error(`upload of ${slot.file} (${lang}) → ${res.status} ${res.statusText}`);
      }
      await api("PATCH", `/v1/appAssetLibraryImages/${imageId}`, { data: { type: "appAssetLibraryImages", id: imageId, attributes: { uploaded: true } } });

      // Processing: a placement may be made while it runs, but a failure is worth saying here.
      state = "UPLOAD_COMPLETE";
      let details = null;
      for (let i = 0; i < 60 && state === "UPLOAD_COMPLETE"; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const a = (await api("GET", `/v1/appAssetLibraryImages/${imageId}`)).data.attributes;
        state = a.state; details = a.stateDetails;
      }
      if (state === "FAILED") throw new Error(`${slot.file} (${lang}) failed processing: ${JSON.stringify(details)}`);
    }

    // Replace: a placement cannot be changed, only deleted and made again.
    for (const old of existing) await api("DELETE", `/v1/appAssetLibraryPlacements/${old.id}`);
    await api("POST", "/v1/appAssetLibraryPlacements", { data: {
      type: "appAssetLibraryPlacements",
      attributes: { placementType: slot.placementType, placementGroup: group },
      relationships: {
        image: { data: { type: "appAssetLibraryImages", id: imageId } },
        appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } },
      },
    } });
    // The images the old placements showed, if nothing else uses them now. Best effort: an approved
    // image still placed on the live version stays.
    for (const old of existing) {
      const oldImage = old.relationships?.image?.data?.id;
      if (oldImage && oldImage !== imageId) await api("DELETE", `/v1/appAssetLibraryImages/${oldImage}`).catch(() => {});
    }
    console.log(`  ✓ ${lang} ${slot.label}: ${slot.file} (${state})${existing.length ? `, replaced ${existing.length}` : ""}`);
  }
}
