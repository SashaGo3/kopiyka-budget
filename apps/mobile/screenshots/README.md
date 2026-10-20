# App Store screenshots

One command produces the App Store screenshot sets for the iPhone app, the 13" iPad and the Apple
Watch app, in every language the app has (English and Ukrainian):

```sh
cd apps/mobile
bun run screenshots                 # build (Release, simulator) → install → seed demo data → capture → frame
bun run screenshots -- --no-build   # reuse the last Release build (a few minutes faster)
bun run screenshots -- --no-build --lang uk   # one language (codes from locales/languages.json; several as en,uk)
```

`--lang` works the same on `run.sh`, `capture.sh` and `frame.mjs`; the default is `all`. Each
language has its own folder, named with App Store Connect's code for it (`en` → `en-US`, `uk` →
`uk`, from `appStore` in `packages/i18n/i18n.config.ts`). Results land in
`screenshots/appstore/<App Store language>/`:

| Folder | Size | Upload as |
|---|---|---|
| `iphone-6.9/` | 1320 × 2868 | iPhone with Dynamic Island (large display), 6.9" |
| `iphone-6.3/` | 1206 × 2622 | iPhone with Dynamic Island (medium display), 6.3" — **the one iPhone set App Store Connect requires** since iOS 27; laid out from the 6.9" captures (the screens are the same shape) |
| `iphone-6.5/` | 1284 × 2778 | iPhone 6.5" display (App Store Connect accepts 1284 × 2778 or 1242 × 2688 here) |
| `iphone-6.5-1242/` | 1242 × 2688 | the same slides at the other accepted 6.5" size |
| `ipad-13/` | 2064 × 2752 | iPad 13" display (required as long as the build is offered on iPad) |
| `watch/` | 422 × 514 | Apple Watch Ultra 3 / Ultra 4 (raw screen, no frame — what Apple wants for watchOS) |
| `creative/header-21x9.png` | 3840 × 1646 | product page header |
| `creative/search-results-3x2.png` | 3840 × 2560 | search results |
| `creative/universal-16x9.png` | 5244 × 2950 | either of the two (App Store Connect takes the 16:9 file in both places) |
| `bare/iphone/` | 1470 × 3000 | **not for the App Store** — the capture in Apple's bezel on a transparent canvas, no headline, no background |
| `bare/watch/` | 600 × 960 | the same for the watch, band faded out at both ends |
| `contact-sheet.png` | — | all iPhone slides in a row, for a quick look |

Raw captures are per language too: `screenshots/raw/<lang>/{iphone,ipad,watch}/…`.

**What to upload** is gathered after every `--frame` into `screenshots/Finals/<App Store language>/`
— `iphone/` (the 6.9" set), `iphone-6.3/`, `ipad/` (13"), `watch/` and `creative/` — rebuilt from
scratch each time, so it holds the current slides and nothing else. It is a copy of the folders
above, so it is gitignored. App Store Connect scales every other iPhone from the two iPhone sets
(6.5" from 6.9", 6.1" from 6.3", and so on down). `bun run screenshots:upload` sends all of it:
fastlane deliver the screenshots and the text, then `scripts/screenshots/upload-creative.mjs` the
header and search results files from `creative/`, through the App Store Connect API's asset library
(deliver has no support for it yet), replacing whatever art the version had. It needs the API key in
`.env`; `--no-creative` skips it, and `node scripts/screenshots/upload-creative.mjs --dry-run` shows
what it would do without changing anything. The art goes to App Review with the version.

### Header and search results art

`creative/` is the art App Store Connect added with iOS 27 above the product page and in search
results. It is cropped differently on every device, so only the "Art Safe Area" of Apple's templates
(developer.apple.com/app-store/asset-best-practices → Templates; the layer of that name, read with
`magick identify`) is sure to be seen — `CREATIVE_SIZES` in `frame.mjs` carries those boxes. The
layout is three phones, each in one of the app's colour themes and standing on a band of that
theme's colour, with a short label above each, left-aligned with its phone and all on one line, and
the watch in front of the first. The group spans the middle of the canvas (`stage` in
`CREATIVE_SIZES`), well past the safe area: an iPhone shows the header's full height and about two
thirds of its width, and art kept to the safe area looked like a thumbnail there. Regenerate just
this art with `bun run screenshots -- --creative` (seconds, from the existing captures) and upload
just it with `bun run screenshots:upload -- --creative-only`. Which captures, themes and labels (`store.creative.*` in
`store.json`) are `creative` in `shots.json`. The themed captures are shot apart from the rest:
`scripts/screenshots/capture.sh --phone --lang <code> --palette <theme id> --theme light|dark --only <id>`
writes `raw/<lang>/iphone/<theme id>-<light|dark>/` and puts the simulator back on the default theme. `--no-creative` skips it.

**iPhone Duo** (1398 × 2034 outer, 2007 × 2853 inner) has no set yet: Xcode 27.0 has no simulator
for it. App Store Connect requires it only for builds made with the iOS 27.1 SDK, from April 2027.

`bare/` exists for the promo site in `site/`, which supplies its own words: a slide's baked-in
headline next to the page's own heading is the same sentence printed twice. It is the only output
that keeps an alpha channel — App Store Connect rejects a PNG that has one, so everything else is
flattened. `site/build.mjs` reads `appstore/<App Store language>/bare/` and resizes it; skip it with
`--no-bare`.

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
| `scripts/screenshots/demo-data.ts` | invents the demo dataset for one language (`--lang`; English: Lisbon, EUR — Ukrainian: Kyiv, UAH; 5 months of history, budgets, trip, debts, insights) and writes `screenshots/demo/kopiyka-demo-<lang>.json`; `--apply=<udid>` installs it into a simulator |
| `scripts/screenshots/capture.sh` | cold-starts the app into a deep link per shot and screenshots it (light + dark) on the iPhone and the iPad; launches the watch straight onto each screen |
| `scripts/screenshots/frame.mjs` | composes the raw shots into App Store art from `shots.json` (headline, subtitle, device bezel) |
| `scripts/screenshots/langs.mjs` | the language list and each language's App Store code, for the other three |
| `scripts/screenshots/font-widths.mjs` | one-off: measures the Cyrillic advance widths `frame.mjs` wraps with (see below) |
| `screenshots/shots.json` | **the shot list**: ids, order, layout, colours — and the *keys* of the captions |
| `packages/i18n/locales/<lang>/store.json` | **the captions and the App Store listing**, per language |
| `packages/i18n/locales/<lang>/demo.json` | every name the demo data shows: shops, places, notes, accounts, tags, trips, people |
| `screenshots/i18n/<lang>.json`, `scripts/screenshots/i18n/<lang>.json` | the two above compiled flat by `bun run i18n` — generated, do not edit |
| `screenshots/metadata/<App Store language>/*.txt` | the listing as App Store Connect wants it, one file per field (`name`, `subtitle`, `promotionalText`, `keywords`, `description`, `whatsNew`) — generated by `bun run i18n` from `store.listing.*`; paste them in by hand |
| `screenshots/raw/<lang>/` | raw captures (`iphone/light`, `iphone/dark`, `ipad/light`, `ipad/dark`, `watch`) |

The demo data is fully invented (no real exports are read) and relative to "today", so re-running it
next month still shows a lively current period. The same JSON can be imported on a real phone
(Settings → Data management → Replace everything with a file) to take screenshots on a device; it
carries the `language` setting, so the phone switches to that language.

## Languages

Each language is shot over its own data and with everything set to it:

- **Data.** `demo-data.ts --lang=<code>` takes every word from the `demo` namespace and its numbers
  from `PROFILES[<code>]` — hryvnia prices are their own numbers, not euro prices scaled. The ready-made
  categories are the app's presets seeded in that language. The English profile reproduces the
  dataset exactly as it was before languages existed (same PRNG draws, same ids); only the new
  `language` setting was added.
- **App.** The seeded database's meta `language` is the code, so the app opens in it.
- **iOS.** `capture.sh` sets the simulator's `AppleLanguages`/`AppleLocale` through `simctl spawn
  defaults write -g` before shooting (deep links cannot carry launch arguments), and launches the apps
  it starts directly (the watch half) with `-AppleLanguages "(uk)" -AppleLocale uk_UA`.
- **Location.** The simulator is moved to where the persona lives (Lisbon, Kyiv) when its data is seeded.

The simulators hold one dataset at a time, so a run with several languages seeds and captures them one
after another. `capture.sh --lang uk` alone expects the Ukrainian data to be seeded already (`run.sh`
does it; or pass `--seed`); with several languages it seeds before each.

The Ukrainian set carries a few entries the English one does not (`extra.*` and
`trip.current.extra` in `demo.json`, placed in the last minutes of "today" so they top the
transaction list); English leaves them out.

### Captions in another language

`shots.json` holds keys (`store.shots.log.title`); the words are in
`packages/i18n/locales/<lang>/store.json`. A `\n` in a caption is a manual break: the framer keeps it
and only wraps further if a line does not fit, so break a translation where it reads well — Ukrainian
runs about a quarter longer than English. Every set has its devices start on one line, below its
tallest caption, so one overlong caption pushes every slide of that language down: keep titles to
three lines and subtitles to three. After editing, `bun run i18n`, then
`bun run screenshots -- --frame --lang uk` and look at the contact sheet.

`frame.mjs` wraps by measuring text with built-in advance widths, because it has no font library.
The Latin ones are Helvetica's AFM metrics; Cyrillic (U+0400–U+04FF, plus ʼ « » – — ₴ №) came from
the font the slides are actually drawn in — fontconfig resolves the font stack to Helvetica Neue —
read out of `/System/Library/Fonts/HelveticaNeue.ttc` by `scripts/screenshots/font-widths.mjs`
(it parses the font's `cmap`/`hmtx` tables directly, no dependencies). If a caption in a new script
wraps wrongly, extend that script's character list and paste its output over `W_CYR_REG` /
`W_CYR_BOLD`.

## Common edits

- **Change a caption** → edit `packages/i18n/locales/<lang>/store.json`, run `bun run i18n` at the
  repo root, then `bun run screenshots -- --frame` (add `--lang uk` for one language).
- **Change the App Store text** → `store.listing.*` in the same files; `bun run i18n` rewrites
  `screenshots/metadata/<App Store language>/*.txt` (the checker enforces each field's limit).
- **Re-shoot one screen** → `bun run screenshots -- --capture --frame --only budgets` (add `--theme dark`
  to shoot only the dark variant; `--phone` / `--ipad` / `--watch` to limit the device, `--no-ipad` to
  leave the iPad out of both halves).
- **Add a screen** → add a `case` to `ios_shot` in `capture.sh` (a deep link is enough for most
  screens; `transaction/[id]` takes `amount`, `category`, `note`, `tags`, `account`, `kind`), then an
  entry in `shots.json` with the same `id` and caption keys, and the captions in every language's
  `store.json`.
- **Different demo numbers** → edit `PROFILES` in `demo-data.ts`; **different names** → the
  language's `demo.json` and `bun run i18n`; then `bun run screenshots -- --seed --capture --frame`.
- **App changed** → `bun run screenshots` (a fresh Release build picks up the change).

## Requirements

Xcode 27 with its iOS 27 + watchOS 27 simulator runtimes and `rsvg-convert` (`brew install librsvg`)
for the framing. Nothing beyond `simctl` drives the simulators: every iPhone shot is a deep link, every
iPad shot a launch with the same link as an argument, every watch shot a launch onto that screen. idb
is no longer needed — its taps load SimulatorKit from where Xcode kept it until 26.

The three "Kopiyka Shots" simulators always run the newest iOS and watchOS runtime installed: one
left on an older runtime by a previous Xcode is deleted and created again on the first run
(`ensure_sim` in `lib.sh`), so the screenshots show the OS the current Xcode ships.
`SHOTS_KEEP_RUNTIME=1` keeps them as they are.
ImageMagick (`brew install imagemagick`) is used for the contact sheet and size checks.

## Gotchas

- `xcodebuild` must not be given `-sdk iphonesimulator`: it forces the watch complication target onto
  the iOS SDK and the build fails. `run.sh` uses the destination only.
- The watch receives its data from the phone over WatchConnectivity, so the phone app is launched
  before the watch is driven. If the watch shows an empty state, give it a few seconds and re-run
  `--capture --watch`.
- **iPadOS confirms every deep link.** `simctl openurl` on the iPad raises "Open in “Kopiyka
  Budget”?" whether or not the app is running, and a shot taken over it is a picture of an alert on
  the home screen. So the iPad is launched with the link as an argument instead (`-KPLink`), which a
  screenshot build opens as if it had arrived while running (`src/lib/launchLink.ts`). The iPhone
  does not ask, and keeps using `openurl`.
- A screenshot build never shows What's New (`maybeShowWhatsNew`): otherwise every slide that opens
  without a link to land on is the release notes.
- The iPad is drawn rather than composited into an Apple product bezel: there is no 13" iPad bezel in
  Apple’s Product Bezels download and frameit’s set stops at the 12.9" Pro of 2020. `ipadDrawn` in
  `frame.mjs` has the geometry (and where the numbers come from) if one ever turns up.
- The watch is launched with `-KPShot <screen> -KPShotAmount <amount>` (`WatchShot` in
  `targets/watch/KopiykaWatchApp.swift`): keypad, categories, tags, history, budgets, status. A new
  watch shot is a new case there and a name in `capture.sh`'s list.
- If you add a shot that needs a tap: `agent-device` runs every command through an XCTest runner
  app, and launching that runner puts Kopiyka in the background, so a shot taken right after one
  comes out as the home screen. Open the session once before the loop, never between the deep link
  and the screenshot (`capture.sh` has the recipe in a comment).
- watchOS refuses `simctl status_bar override`, so the watch clock shows the host's real time while
  the phone shows 9:41. Nothing in `simctl` can change that.
- `demo-data.ts` seeds row ids from its own PRNG (it overrides `crypto.randomUUID`), so the JSON can
  be regenerated without invalidating the ids `capture.sh` puts in deep links. Change that and the
  `log` and `trip` shots break the next time the file is rebuilt without `--seed`.
- The watch shows the same amount as the entry sheet (`demo.capture.logAmount`).
- Everything under `screenshots/raw/` and `screenshots/appstore/` is generated; commit it if you want
  the history, regenerate it if not.
