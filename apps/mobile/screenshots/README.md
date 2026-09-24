# App Store screenshots

One command produces the App Store screenshot sets for the iPhone app, the 13" iPad and the Apple
Watch app:

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
| `ipad-13/` | 2064 × 2752 | iPad 13" display (required as long as the build is offered on iPad) |
| `watch/` | 422 × 514 | Apple Watch Ultra 3 (raw screen, no frame — what Apple wants for watchOS) |
| `bare/iphone/` | 1470 × 3000 | **not for the App Store** — the capture in Apple's bezel on a transparent canvas, no headline, no background |
| `bare/watch/` | 600 × 960 | the same for the watch, band faded out at both ends |
| `contact-sheet.png` | — | all iPhone slides in a row, for a quick look |

`bare/` exists for the promo site in `site/`, which supplies its own words: a slide's baked-in
headline next to the page's own heading is the same sentence printed twice. It is the only output
that keeps an alpha channel — App Store Connect rejects a PNG that has one, so everything else is
flattened. `site/build.mjs` reads `bare/` and resizes it; skip it with `--no-bare`.

App Store Connect has one iPad slot — "iPad 13-inch displays" — and scales every smaller iPad from
it, so `ipad-13/` is the whole iPad requirement. It carries the same captions as the iPhone set, shot
on an iPad and laid out for the wider canvas (smaller type, centred, a bigger device), because an
iPhone screenshot blown up to 2064 px would be a picture of an app the iPad does not run. The Apple
Watch slide is the one that is not in it: the watch app pairs with an iPhone, so slide 05 is missing
from the iPad set rather than renumbered around.

The pipeline uses three simulators of its own, **Kopiyka Shots** (iPhone 17 Pro Max), **Kopiyka Shots
iPad** (iPad Pro 13" M4) and **Kopiyka Shots Watch** (Apple Watch Ultra 3, paired to the phone). They
are created on first use and never collide with the simulator you develop in. Nothing here touches a
real device or App Store Connect.

## The pieces

| File | Does |
|---|---|
| `scripts/screenshots/run.sh` | orchestration; pick steps with `--build --install --seed --capture --frame` |
| `scripts/screenshots/demo-data.ts` | invents the demo dataset (Lisbon persona, EUR, 5 months of history, budgets, trip, debts, insights) and writes `screenshots/demo/kopiyka-demo.json`; `--apply=<udid>` installs it into a simulator |
| `scripts/screenshots/capture.sh` | cold-starts the app into a deep link per shot and screenshots it (light + dark) on the iPhone and the iPad; drives the watch with idb |
| `scripts/screenshots/frame.mjs` | composes the raw shots into App Store art from `shots.json` (headline, subtitle, device bezel) |
| `screenshots/shots.json` | **the shot list and the captions** — edit this to change the wording or the order |
| `screenshots/raw/` | raw captures (`iphone/light`, `iphone/dark`, `ipad/light`, `ipad/dark`, `watch`) |

The demo data is fully invented (no real exports are read) and relative to "today", so re-running it
next month still shows a lively current period. The same JSON can be imported on a real phone
(Settings → Data management → Replace everything with a file) to take screenshots on a device.

## Common edits

- **Change a caption** → edit `screenshots/shots.json`, run `bun run screenshots -- --frame`.
- **Re-shoot one screen** → `bun run screenshots -- --capture --frame --only budgets` (add `--theme dark`
  to shoot only the dark variant; `--phone` / `--ipad` / `--watch` to limit the device, `--no-ipad` to
  leave the iPad out of both halves).
- **Add a screen** → add a `case` to `ios_shot` in `capture.sh` (a deep link is enough for most
  screens; `transaction/[id]` takes `amount`, `category`, `note`, `tags`, `account`, `kind`), then an
  entry in `shots.json` with the same `id`.
- **Different demo numbers** → edit `demo-data.ts`, then `bun run screenshots -- --seed --capture --frame`.
- **App changed** → `bun run screenshots` (a fresh Release build picks up the change).

## Requirements

Xcode with the iOS 26 + watchOS 26 simulator runtimes, `idb` (`brew install idb-companion &&
pipx install fb-idb`; watch taps and the iPad's confirmation prompt) and `rsvg-convert`
(`brew install librsvg`) for the framing. The phone needs nothing beyond `simctl`: every shot is a
deep link.
ImageMagick (`brew install imagemagick`) is used for the contact sheet and size checks.

## Gotchas

- `xcodebuild` must not be given `-sdk iphonesimulator`: it forces the watch complication target onto
  the iOS SDK and the build fails. `run.sh` uses the destination only.
- The watch receives its data from the phone over WatchConnectivity, so the phone app is launched
  before the watch is driven. If the watch shows an empty state, give it a few seconds and re-run
  `--capture --watch`.
- **iPadOS confirms every deep link.** `simctl openurl` on the iPad raises "Open in “Kopiyka
  Budget”?" whether or not the app is running, and a shot taken over it is a picture of an alert on
  the home screen. `confirm_open` in `capture.sh` finds the Open button through idb’s accessibility
  bridge and taps it — by label, not by a fixed point, because the alert is still animating in when
  the first look happens. The iPhone does not ask, and pays none of this.
- The iPad is drawn rather than composited into an Apple product bezel: there is no 13" iPad bezel in
  Apple’s Product Bezels download and frameit’s set stops at the 12.9" Pro of 2020. `ipadDrawn` in
  `frame.mjs` has the geometry (and where the numbers come from) if one ever turns up.
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
