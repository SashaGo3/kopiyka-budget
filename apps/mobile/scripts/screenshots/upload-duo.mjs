#!/usr/bin/env node
/* global Buffer */
/**
 * Uploads the iPhone Duo screenshots (screenshots/Finals/<store lang>/duo/*.png, 1398 × 2034, the
 * folded outer display) to App Store Connect's APP_IPHONE_DUO slot of the version being edited.
 *
 *   node scripts/screenshots/upload-duo.mjs [version] [--lang en-US|uk] [--dry-run]
 *
 * fastlane deliver tells devices apart by pixel size and does not know the Duo's yet, so this goes
 * through the App Store Connect API instead, with the key in apps/mobile/.env (ASC_KEY_PATH,
 * ASC_KEY_ID, ASC_ISSUER_ID — the same one upload-creative.mjs uses). Per language it replaces the
 * slot's screenshots with the files, in file-name order (01-…, 02-…), and leaves every other slot
 * and the listing text alone. Run it after deliver: deliver's "overwrite screenshots" clears every
 * slot of the languages it uploads, the Duo's included.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_DIR = path.resolve(HERE, "../..");
const FINALS = path.join(MOBILE_DIR, "screenshots/Finals");
const API = "https://api.appstoreconnect.apple.com";
const DISPLAY = "APP_IPHONE_DUO";
const SIZES = new Set(["1398x2034", "2034x1398", "2007x2853", "2853x2007"]);
const EDITABLE = new Set(["PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "INVALID_BINARY"]);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const li = args.indexOf("--lang");
const ONLY_LANG = li >= 0 ? args[li + 1] : null;
const version = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--lang") ?? null;

function fail(msg) { console.error(`✗ ${msg}`); process.exit(1); }

// ---------------------------------------------------------------------------------------------- auth

for (const line of fs.existsSync(path.join(MOBILE_DIR, ".env")) ? fs.readFileSync(path.join(MOBILE_DIR, ".env"), "utf8").split("\n") : []) {
  const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
}
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

function pngSize(file) {
  const b = fs.readFileSync(file);
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

// ------------------------------------------------------------------------------------------- version

const bundleId = JSON.parse(fs.readFileSync(path.join(MOBILE_DIR, "app.json"), "utf8")).expo.ios.bundleIdentifier;
const app = (await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&fields[apps]=bundleId`)).data[0];
if (!app) fail(`no app with bundle id ${bundleId} on App Store Connect`);
const versions = (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20&fields[appStoreVersions]=versionString,appStoreState`)).data;
const target = version
  ? versions.find((v) => v.attributes.versionString === version)
  : versions.find((v) => EDITABLE.has(v.attributes.appStoreState));
if (!target) fail(version ? `no version ${version}` : "no version open for editing");
if (!EDITABLE.has(target.attributes.appStoreState)) fail(`${target.attributes.versionString} is ${target.attributes.appStoreState}, which cannot be edited`);
console.log(`iPhone Duo → ${bundleId} ${target.attributes.versionString} (${target.attributes.appStoreState})${DRY ? " — dry run" : ""}`);

const localizations = (await api("GET", `/v1/appStoreVersions/${target.id}/appStoreVersionLocalizations?limit=50&fields[appStoreVersionLocalizations]=locale`)).data;

// --------------------------------------------------------------------------------------------- upload

async function uploadOne(setId, file) {
  const bytes = fs.readFileSync(file);
  const created = (await api("POST", "/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName: path.basename(file), fileSize: bytes.length },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
    },
  })).data;
  for (const op of created.attributes.uploadOperations ?? []) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const res = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`upload of ${path.basename(file)} → ${res.status} ${res.statusText}`);
  }
  const checksum = crypto.createHash("md5").update(bytes).digest("hex");
  await api("PATCH", `/v1/appScreenshots/${created.id}`, { data: { type: "appScreenshots", id: created.id, attributes: { uploaded: true, sourceFileChecksum: checksum } } });
  return created.id;
}

let failures = 0;
for (const loc of localizations) {
  const locale = loc.attributes.locale;
  if (ONLY_LANG && ONLY_LANG !== locale) continue;
  const dir = path.join(FINALS, locale, "duo");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f)) : [];
  if (!files.length) {
    console.log(`  – ${locale}: nothing in ${path.relative(MOBILE_DIR, dir)}, left alone`);
    continue;
  }
  const wrong = files.filter((f) => !SIZES.has(pngSize(f)));
  if (wrong.length) fail(`${locale}: not an iPhone Duo size: ${wrong.map((f) => `${path.basename(f)} ${pngSize(f)}`).join(", ")}`);
  if (files.length > 10) fail(`${locale}: ${files.length} files, App Store Connect takes 10 per slot`);
  if (DRY) {
    console.log(`  · ${locale}: would replace the Duo slot with ${files.length}: ${files.map((f) => path.basename(f)).join(", ")}`);
    continue;
  }
  try {
    const sets = (await api("GET", `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?filter[screenshotDisplayType]=${DISPLAY}`)).data;
    let setId = sets[0]?.id;
    if (!setId) {
      setId = (await api("POST", "/v1/appScreenshotSets", {
        data: { type: "appScreenshotSets", attributes: { screenshotDisplayType: DISPLAY }, relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: loc.id } } } },
      })).data.id;
    }
    const old = (await api("GET", `/v1/appScreenshotSets/${setId}/appScreenshots?limit=50`)).data;
    for (const s of old) await api("DELETE", `/v1/appScreenshots/${s.id}`);
    for (const f of files) await uploadOne(setId, f);
    console.log(`  ✓ ${locale}: ${files.length} Duo screenshots${old.length ? `, replaced ${old.length}` : ""}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${locale}: ${err.message}`);
  }
}
if (failures) process.exit(1);
