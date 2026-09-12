#!/usr/bin/env node
/** Increments expo.ios.buildNumber in app.json (TestFlight rejects a build number it has seen before). */
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "app.json");
const json = JSON.parse(fs.readFileSync(file, "utf8"));
const next = String(Number(json.expo.ios.buildNumber ?? "0") + 1);
json.expo.ios.buildNumber = next;
fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
console.log(`buildNumber → ${next} (version ${json.expo.version})`);
