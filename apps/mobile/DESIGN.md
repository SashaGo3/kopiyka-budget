# Rules for anything that draws

Read this before adding a screen, a sheet or a component. Every rule names the token or component
that carries it, so the answer is "use that", not "remember this". The shared pieces live in
`src/components/ui.tsx` and the tokens in `src/constants/theme.ts`. When a screen needs something
neither has, add it there, not to that screen.

## 1. Tokens, never literals

| What | Use | Never |
| --- | --- | --- |
| Colour | `C.*` (roles), `themeTone(hex)` for chrome squares, the user's own colour as chosen | `"white"`, `"#…"`, `rgba(…)` in a component |
| Spacing | `S.xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32` | `padding: 10`, `gap: 6` |
| Radius | `R.sm 8 · md 12 · card 14 · lg 18 · xl 26 · pill 999` | `borderRadius: 17` |
| Text | `Type.*` (iOS text styles: size and weight together) | a bare `fontSize` |

Radius by job: a content card `R.card`, a button or a field `R.md`, anything pill-shaped or round
`R.pill`. A drawing at miniature scale (a chart bar, a theme swatch, a dot) takes the radius its
geometry needs.

A value the tokens do not have is a sign that the design needs a new role, not a one-off. Add the
token with a comment saying what it is for.

Exceptions: drawing on a photo or a map (the photo viewer, the camera) sits on black whatever the
theme, so its chrome may be white. Category, tag, account and person colours are the user's data and
are drawn exactly as chosen (`iconFill`, `CategoryIcon`).

## 2. Colour has one job each

- **`C.tint` is a fill or a link, and on it is always `C.onTint`.** In every dark theme the accent is
  light and `onTint` is dark, so white on the accent disappears. `ConfirmBar`, `BigButton`, `Chip`
  (active) and the picker's Done do this already; copy them.
- **No blue.** The accent is the theme's; system blue appears nowhere (CONTRIBUTING.md).
- **Red is for money going out and for destroying things. Green is for money coming in. Orange is
  for a warning** (a budget gone over, Pending). None of them is ever used for decoration, and none
  is ever the only cue: a pending row has the clock and the word as well, and an expense has its
  minus sign.
- **Text contrast is held to APCA bands per role** (`packages/core/src/themeColors.ts`), the same in
  light and dark. Use `label` for what is read, `secondary` for the line under it, `tertiary` for
  captions and chevrons. Do not fix "faded" text by darkening one screen; change the band.
- **Text goes on a solid role.** Text on an alpha wash (`redSoft`, a `+ "22"` tint) is measured in
  `themeColors.ts`; a new wash needs its pair checked there too.

## 3. Type: one scale, iOS's own

`Type` in `theme.ts`: `largeTitle 34`, `title 22`, `title3 20`, `headline 17/600`, `body 17`,
`callout 15/500`, `footnote 13`, `caption 12/600`, `caption2 11/700`. That is the whole scale for
reading text. 14, 16, 18 and 19 are not on it (all moved onto it on 2026-11-18). Display numbers
(the keypad's keys, a sheet's hero amount, 26–54) are drawn larger on purpose and are the only
sizes off the scale.

- Changing numbers (money, counters, the keypad) use `fontVariant: ["tabular-nums"]`. `Money`
  already does; use `Money` for an amount, never a hand-formatted string.
- Weight 600 or 700 marks a title or a primary button, 500 a control label, 400 everything read.
  Nothing below 400.
- Uppercase is for section and stat labels only (`SectionHeader`, `StatPair`), tracked `0.4–0.5`.

## 4. Text never ends in "…"

The user's standing rule, and `test/buttons.test.ts` holds buttons to it.

- **Wrap, don't truncate.** No `numberOfLines` with the default tail ellipsis. If a line is too long,
  choose shorter words. A slot whose size is fixed (a key, a grid cell, a segment) uses
  `ButtonText fit`, which shrinks and then clips but never prints "…". A chart's label in a fixed
  slot shrinks the same way (`adjustsFontSizeToFit`).
- **A word is never split.** A word wider than its button is cut wherever the line runs out
  ("розташуванн / я"). `ButtonText` catches that (`lib/wordBreak.ts`) and shrinks the label until it
  breaks only between words, so a button's words always go through `ButtonText`. It is still a
  fallback: a label that needs it wants a shorter word.
- **The one exception is a preview of free text**: a note or the bank's words under a list row or
  on the entry sheet (`TransactionList`, `transaction/[id]`, the split rows), which can be a whole
  receipt. Those keep their 2–3 lines, because the full text is one tap away. Names, titles and
  labels always wrap.
- **No "…" in strings.** No "Loading…" or "Backing up…" either: show a spinner
  (`ActivityIndicator`, `BusyOverlay` for a blocking write) and no sentence about it.
- **Say less.** One short line of explanation at most (`Footnote` / `ScreenNote`), with the rest
  behind its ⓘ. People are not stupid.

## 5. Words

- Buttons start with a verb: "Save", "Add expense", "Delete tag". No "OK", no "Yes".
- Sentence case everywhere, titles included.
- Toggles describe what happens when they are on ("Show balance", not "Hide balance off").
- An error says what failed and what to do next, without blame and without "Oops" or "!".
- Confirmations name the action and the thing ("Delete 'Groceries'?"), and the destructive button
  repeats the verb. For a reversible action, act first and offer `UndoToast` instead of asking.
- Every string goes through `t()` with a plural argument, never `n === 1 ? "" : "s"`
  (`packages/i18n`). Ukrainian runs about 30 % longer than English. Lay out for that.

## 6. Every control: one shape, one name

- **Press feedback is `Tap`.** Anything tappable that has no pressed look of its own is a `Tap`
  (dims to 0.45, eases back), not a bare `Pressable` with a hand-rolled `opacity: 0.6`. Rows
  highlight with `C.fill` (`Row`). Cards and keys scale (`PressCard`, the keypad). Those are the only
  three answers.
- **Every control has `accessibilityRole` and `accessibilityLabel`.** The label is what VoiceOver
  reads *and* what the Maestro flows and the screenshot pipeline tap (CONTRIBUTING.md). It starts
  with the visible words. An icon-only button names the action ("Delete photo"), never the glyph.
  State goes in `accessibilityState` (`selected`, `disabled`, `checked`, `expanded`).
- **Targets are at least 44 pt.** Grow the target, not the drawing: `hitSlop` on a small glyph,
  `minHeight: 44` on a row-like control. Targets never overlap.
- **Disabled is drawn at `opacity: 0.4`**, keeps its place, and never scales on press.
- **A hold is never the only way.** A long-press gets an `accessibilityActions` twin, as `Chip` and
  the transaction row do. A drag gets a button that does the same thing (`ReorderList`).

## 7. The pieces to build from

| Need | Use |
| --- | --- |
| A sheet | `SheetFrame`: information on top, every input in the bottom bar |
| A sheet's title bar | `ModalHeader` (text actions) or `PickerHeader` (a picker's Done count) on `HeaderBar` |
| A picker | `PickerList` / `PickerSections` + `PickerHeader` + `PickCheck`. Never hand-built |
| An amount, a category, tags, a note | the `pick/*` sheets (`pick/amount` with `kind`). Reuse them; never a bespoke editor |
| A group of rows | `Card` holding `Row` / `ToggleRow`, with `SectionHeader` above it and `Footnote` below |
| The main action | `BigButton` or `ConfirmBar`. One per screen |
| Choices | `Chip` in `ChipRow` (wrapping) or `ChipGrid` (fixed cells), `Segmented` for 2–4 modes |
| Delete | `DeleteRow` under the confirm bar, plus a confirmation or an undo |
| Money | `Money`, `AmountPill` (red/green/orange wash), `StatPair` for the two totals |
| A category, tag or person | `CategoryIcon` / `CategoryIconStack`, `TagPill`, `PersonAvatar` |
| Nothing to show | `Empty`, with an `action` when the app caused the emptiness (a filter, a scope) |
| A blocking write | `runBusy` + `BusyOverlay` |

## 8. Layout

- **Group with space before lines.** The gap between groups is at least twice the gap inside one
  (rows touch, cards sit `S.lg`–`S.xl` apart). Separators only between rows of one `Card`.
- **One inset.** Cards and buttons sit `S.lg` (16) from the screen edge. Section labels and
  footnotes line up with the text inside the card, `S.xl` (24).
- **One primary action per view.** It is the filled one. Everything else is a chip, a row or a text
  link. More than three secondary actions go behind a menu.
- **Text containers grow.** `minHeight`, never `height`, on anything holding text, so a large
  Dynamic Type size or a Ukrainian label makes the control taller instead of overlapping it.
- **iPad keeps a phone's measure** (`screenContentStyle`, `CONTENT_MAX_WIDTH`).
- **Sides are a safe area too.** The folded iPhone Duo keeps its camera, clock and tab bar in a strip
  down one side (about 84 pt). A pushed screen gets clear of it through its stack's
  `useScreenContentStyle()`, and a full-screen modal through the root layout's `modal` option. Inside a
  sheet or anything presented, the inset reads 0, so wrap what sits under the strip in `ClearOfSides`,
  which pads only by the actual overlap (`SheetFrame` does this for its top). Never do symmetric math on
  insets (`width - insets.left * 2`), and branch on the window's width, never on the device.

## 9. Dynamic Type

Text scales with the phone's setting. Do not switch it off (`allowFontScaling={false}` is for glyphs
that are drawings: an emoji icon, initials in an avatar, a logo). A `maxFontSizeMultiplier` belongs
only on chrome with no room to grow (header actions, badges, keypad keys: `1.3`). Content (row
titles, amounts, notes) is never capped below `2`. WCAG 1.4.4 asks for 200 %, and the amount is the
one thing every screen is for.

Check a new screen at the largest accessibility size, in light and dark (CONTRIBUTING.md).

## 10. Motion

- **Only through Reanimated.** Its animations follow the system's Reduce Motion on their own. With
  RN `Animated`, check `reduceMotion()` (`src/lib/motion.ts`) and jump to the end value.
  `ProgressBar` and `FadeIn` show the pattern.
- **Under Reduce Motion, nothing travels.** A fade or a brief press scale may stay. Slides, lifts and
  pulses go (`IncomingRow` holds still).
- **Short and calm.** Press feedback lasts 70–240 ms. An entrance takes about 300 ms with an ease-out.
  Springs do not bounce. Repeating motion appears only while something is truly in progress.
- **Motion is never the only signal.** Whatever animates also leaves a colour, an icon or a word behind.
