# App Store screenshots

One command produces the App Store screenshot sets for the iPhone app and the Apple Watch app:

```sh
cd apps/mobile
bun run screenshots                 # build (Release, simulator) → install → seed demo data → capture → frame
bun run screenshots -- --no-build   # reuse the last Release build (a few minutes faster)
```

Results land in `screenshots/appstore/`:

| Folder | Size | Upload as |
|---|---|---|
| `iphone-6.9/` | 1320 × 2868 | iPhone 6.9" display (required) |
| `iphone-6.5/` | 1284 × 2778 | iPhone 6.5" display (App Store Connect accepts 1284 × 2778 or 1242 × 2688 here) |
| `iphone-6.5-1242/` | 1242 × 2688 | the same slides at the other accepted 6.5" size |
| `watch/` | 422 × 514 | Apple Watch Ultra 3 (raw screen, no frame — what Apple wants for watchOS) |
| `bare/iphone/` | 1470 × 3000 | **not for the App Store** — the capture in Apple's bezel on a transparent canvas, no headline, no background |
| `bare/watch/` | 600 × 960 | the same for the watch, band faded out at both ends |
| `contact-sheet.png` | — | all iPhone slides in a row, for a quick look |

`bare/` exists for the promo site in `site/`, which supplies its own words: a slide's baked-in
headline next to the page's own heading is the same sentence printed twice. It is the only output
that keeps an alpha channel — App Store Connect rejects a PNG that has one, so everything else is
flattened. `site/build.mjs` reads `bare/` and resizes it; skip it with `--no-bare`.

The pipeline uses two simulators of its own, **Kopiyka Shots** (iPhone 17 Pro Max) and **Kopiyka Shots
Watch** (Apple Watch Ultra 3, paired to it). They are created on first use and never collide with the
simulator you develop in. Nothing here touches a real device or App Store Connect.

## The pieces

| File | Does |
|---|---|
| `scripts/screenshots/run.sh` | orchestration; pick steps with `--build --install --seed --capture --frame` |
| `scripts/screenshots/demo-data.ts` | invents the demo dataset (Lisbon persona, EUR, 5 months of history, budgets, trip, debts, insights) and writes `screenshots/demo/kopiyka-demo.json`; `--apply=<udid>` installs it into a simulator |
| `scripts/screenshots/capture.sh` | cold-starts the app into a deep link per shot and screenshots it (light + dark); drives the watch with idb |
| `scripts/screenshots/frame.mjs` | composes the raw shots into App Store art from `shots.json` (headline, subtitle, device bezel) |
| `screenshots/shots.json` | **the shot list and the captions** — edit this to change the wording or the order |
| `screenshots/raw/` | raw captures (`iphone/light`, `iphone/dark`, `watch`) |

The demo data is fully invented (no real exports are read) and relative to "today", so re-running it
next month still shows a lively current period. The same JSON can be imported on a real phone
(Settings → Data management → Replace everything with a file) to take screenshots on a device.

## Common edits

- **Change a caption** → edit `screenshots/shots.json`, run `bun run screenshots -- --frame`.
- **Re-shoot one screen** → `bun run screenshots -- --capture --frame --only budgets` (add `--theme dark`
  to shoot only the dark variant; `--phone` / `--watch` to limit the device).
- **Add a screen** → add a `case` to `phone_shot` in `capture.sh` (a deep link is enough for most
  screens; `transaction/[id]` takes `amount`, `category`, `note`, `tags`, `account`, `kind`), then an
  entry in `shots.json` with the same `id`.
- **Different demo numbers** → edit `demo-data.ts`, then `bun run screenshots -- --seed --capture --frame`.
- **App changed** → `bun run screenshots` (a fresh Release build picks up the change).

## Requirements

Xcode with the iOS 26 + watchOS 26 simulator runtimes, `idb` (`brew install idb-companion &&
pipx install fb-idb`; watch taps) and `rsvg-convert` (`brew install librsvg`) for the framing.
The phone needs nothing beyond `simctl`: every shot is a deep link.
ImageMagick (`brew install imagemagick`) is used for the contact sheet and size checks.

## Gotchas

- `xcodebuild` must not be given `-sdk iphonesimulator`: it forces the watch complication target onto
  the iOS SDK and the build fails. `run.sh` uses the destination only.
- The watch receives its data from the phone over WatchConnectivity, so the phone app is launched
  before the watch is driven. If the watch shows an empty state, give it a few seconds and re-run
  `--capture --watch`.
- The watch tap points in `capture.sh` (`KEY_COLS`, `KEY_ROWS`, `AMOUNT_ROW_Y`) are in points
  (px ÷ 2 on the 49 mm). Re-calibrate from a screenshot if the keypad layout changes. The keypad's
  top row is 7-8-9, not 1-2-3.
- If you add a shot that needs a tap: `agent-device` runs every command through an XCTest runner
  app, and launching that runner puts Kopiyka in the background, so a shot taken right after one
  comes out as the home screen. Open the session once before the loop, never between the deep link
  and the screenshot (`capture.sh` has the recipe in a comment).
- watchOS refuses `simctl status_bar override`, so the watch clock shows the host's real time while
  the phone shows 9:41. Nothing in `simctl` can change that.
- `demo-data.ts` seeds row ids from its own PRNG (it overrides `crypto.randomUUID`), so the JSON can
  be regenerated without invalidating the ids `capture.sh` puts in deep links. Change that and the
  `log` and `trip` shots break the next time the file is rebuilt without `--seed`.
- Everything under `screenshots/raw/` and `screenshots/appstore/` is generated; commit it if you want
  the history, regenerate it if not.
