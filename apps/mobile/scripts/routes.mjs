#!/usr/bin/env node
/**
 * Regenerate Expo Router's typed routes (.expo/types/router.d.ts) from the files in src/app.
 *
 * `expo start` writes that file and keeps it current while it runs, so a screen added without the
 * dev server running is unknown to `tsc` until the next start — every `router.push` to it fails to
 * typecheck. This runs the same generator the CLI uses (@expo/router-server), with no server.
 * `bun run typecheck` calls it first.
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The generator reads the app directory from this variable when it is loaded, so it is set first.
process.env.EXPO_ROUTER_APP_ROOT = join(root, "src", "app");
const require = createRequire(join(root, "package.json"));
const { regenerateDeclarations } = require("@expo/router-server/build/typed-routes");
await regenerateDeclarations(join(root, ".expo", "types"), {});
