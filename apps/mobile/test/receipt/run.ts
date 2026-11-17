/**
 * The receipt text parser (native/KPReceiptParse.swift), compiled and run on OCR rows as Vision
 * returned them (ParseTests.swift beside this). `bun run test:receipt` — a script rather than a
 * `bun test` file because `bun test` (1.2.19) cannot start a child process here: even /bin/echo
 * exits 1 with no output under it, while a plain `bun` script runs swiftc fine.
 *
 * What went wrong, 2026-11-16: on a receipt shot a little askew the tax letter after each line total
 * ("5.95B") was read as a digit, so the unit price ("0.500kg*11.90") was taken for the price; and
 * the address printed under the shop's name was never picked up.
 */
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const swiftc = Bun.which("swiftc");
if (!swiftc) { console.log("receipt parser: skipped (no swiftc)"); process.exit(0); }

const dir = mkdtempSync(join(tmpdir(), "kp-receipt-"));
copyFileSync(join(import.meta.dir, "ParseTests.swift"), join(dir, "main.swift"));
const build = Bun.spawnSync([swiftc, join(dir, "main.swift"), join(ROOT, "native/KPReceiptParse.swift"), "-o", join(dir, "run")], { stderr: "pipe" });
if (build.exitCode !== 0) { console.error(build.stderr.toString()); process.exit(1); }
const run = Bun.spawnSync([join(dir, "run")], { stdout: "pipe" });
const out = run.stdout.toString().trim();
console.log(`receipt parser: ${out}`);
process.exit(out === "OK" && run.exitCode === 0 ? 0 : 1);
