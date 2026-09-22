# Product bezels

Apple's own device bezels. `scripts/screenshots/frame.mjs` composites the raw captures into
these, so the App Store slides show a real iPhone and a real Apple Watch rather than a drawing.

| File | Device | Source |
|---|---|---|
| `iphone-17-pro-max-silver.png` | iPhone 17 Pro Max, Silver | [fastlane/frameit-frames](https://github.com/fastlane/frameit-frames) `gh-pages/latest/Apple iPhone 17 Pro Max Silver.png` — frameit's re-host of Apple Design Resources |
| `watch-ultra-3-natural-milanese.png` | Apple Watch Ultra 3, Natural Titanium + Milanese Loop | [Apple Design Resources](https://developer.apple.com/design/resources/) → Product Bezels → `Bezel-Apple-Watch-Ultra-3-2025.dmg`, `PNG/Milanese Loop/AW Ultra 3 - Natural + Milanese Loop.png` |
| `offsets.json` | — | frameit's screen-offset table, same folder as the iPhone frame |

Both are Apple's product bezels, distributed under the Apple Design Resources license, which
allows them in App Store marketing material for an app that runs on the device shown. Do not
recolour them or use them for anything else.

**There is no iPad here.** Apple's Product Bezels download has no 13" iPad and frameit's set stops at
the 12.9" Pro of 2020, so the iPad slides are drawn instead — `ipadDrawn` in `frame.mjs`, off the tech
specs (a 215.5 × 281.6 mm body around a 198.6 × 264.7 mm display, so 8.45 mm of bezel all round). If
a real 13" iPad bezel ever ships, drop it in, measure it as below, and give `IPAD_DEVICE` a `frame`
the way `PHONE_DEVICE` has one.

## Geometry

Measured from each PNG's own alpha channel (`magick <file> -alpha extract`, then scanning rows
and columns for the transparent screen hole); the same numbers are hardcoded in `frame.mjs`.

| | iPhone 17 Pro Max | Watch Ultra 3 |
|---|---|---|
| canvas | 1470 × 3000 | 600 × 960 |
| opaque body (`-trim`) | 1428 × 2959 at +21+20 | 561 × 920 at +34+17 |
| screen hole | **1320 × 2868 at +75+66** | **422 × 514 at +89+223** |
| screen corner radius | ≈ 185 px (circular fit to the squircle) | n/a |

The iPhone hole matches `offsets.json` (`iPhone 17 Pro Max` → offset `+75+66`, width `1320`) and
the raw captures exactly, so the screenshot is placed 1:1 with no resampling before scaling.

The iPhone frame **draws the Dynamic Island itself**, so `frame.mjs` must not add one.

Clipping: the iPhone hole's box corners fall outside the device silhouette, so the screenshot is
clipped to a 185 px rounded rect — small enough to leave no gap inside the hole, large enough that
every overshoot lands under opaque bezel. The watch hole's box corners are opaque case, so the
watch screenshot needs no clip.

## Replacing a frame

Drop a new PNG in, re-measure the two boxes as above, and update `PHONE_FRAME` / `WATCH_FRAME`
in `frame.mjs`. If a frame file is missing, `frame.mjs` warns and falls back to its drawn bezel.
