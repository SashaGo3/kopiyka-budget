# @kopiyka/i18n

One set of message files, compiled into whatever each platform reads natively. No server, no
dependency, no runtime parser.

```
locales/<lang>/<namespace>.json  ──bun run i18n──▶  generated/*.ts              the app and core (typed)
                                                   apps/mobile/native/*.xcstrings, KPStrings.swift   Swift
                                                   apps/mobile/locales/*.json  Info.plist (Expo `locales`)
                                                   apps/mobile/locales/android/values*/strings.xml
                                                   site/i18n/*.json            kopiyka.dev
                                                   apps/mobile/screenshots/i18n, metadata/   App Store
                                                   apps/mobile/scripts/screenshots/i18n      demo data
```

```sh
bun run i18n            # check, then regenerate (commit the generated files)
bun run i18n --watch    # regenerate on save; Metro hot-reloads the app
bun run i18n --partial  # leave failing keys out instead of stopping (while a screen is half-done)
bun test                # includes the checker, and fails if a generated file is stale
```

Which outputs a namespace goes to is `i18n.config.ts`; anything not listed there goes to the app.
Adding a language: a line in `i18n.config.ts`, a plural rule in `runtime/plurals.ts` (the test holds it
against `Intl.PluralRules`), and a `locales/<code>/` directory — the checker lists every missing key.

## Writing messages

- **One file per screen or area** (`settings.json`, `transaction.json`), named like the key's first
  segment. Keys are camelCase segments: `settings.backup.lastRun`. Keys are stable ids, not English.
- **`common.json` holds only words that are the same everywhere** (Cancel, Save, Today). A word used on
  one screen goes in that screen's file even if `common` has it — the same English word is not always
  the same Ukrainian one.
- **Whole sentences, never glued.** `t("a") + name + t("b")` cannot be translated; `{name}` inside one
  message can. Same for "3 of 5": one message with both numbers.
- **Plurals are ICU**: `{count, plural, one {# day} other {# days}}`. Ukrainian needs `one`, `few`,
  `many` and `other` (1 день · 2 дні · 5 днів · 1,5 дня). `=0 {…}` is allowed for "nothing".
- **A plain `{arg}` is printed as passed** — format money with `formatMinor`, dates with `src/lib/dates`,
  then pass the string. Only `#` is number-formatted.
- **`note`** says where it shows and what the arguments are; **`max`** caps the length in every language
  (watch, widgets, tab labels, App Store fields).
- **Tags** `<b>…</b>` are rendered by `<Trans>`; use them instead of splitting a sentence around bold.
- **The checker refuses** a missing or extra key, a missing plural form, an argument the source does
  not have, an over-long string, `select` or tags in Swift-bound text, `'`/`’` inside a Ukrainian
  word (write ʼ, U+02BC), and two Android-bound keys that make the same resource name (`a_b`, `a.b`).
  It **warns** about an `=N` case in Android-bound text: Android falls back to the number's own
  plural form there.

## Using them

**App** (`apps/mobile/src/i18n`): `t("settings.title")`, `t("budgets.left", { count })`, `<Trans k=… />`.
`t` works anywhere, but **never at module scope** — a constant computed at import keeps the language the
app started in. Category names go through `catName` / `catNameById` (`src/lib/names.ts`; DATA.md rule
16). Dates through `src/lib/dates.ts`, money through `formatMinor` (its separators follow the language).

**Swift**: `L10n.Watch.title`, `L10n.Notify.logged(amount: …)` — generated accessors over the String
Catalog, resolved by `KPL` (`native/KPLocale.swift`) in the app's language, not the phone's. App Intent
titles may name a key as a literal `LocalizedStringResource`; iOS resolves those in the phone's language.

## Ukrainian

Formal, lowercase **ви** (as iOS itself writes); short, plain, no exclamation marks. The brand is
**Копійка** in Ukrainian text. Typographic quotes «…», the apostrophe ʼ, a non-breaking space before
units handled by the formatters. Glossary — use these, and add to it rather than inventing a synonym:

| English | Українською |
|---|---|
| transaction, entry | операція (запис — the row on screen) |
| expense / income / transfer | витрата / дохід / переказ |
| account | рахунок |
| category / folder / tag | категорія / папка / тег |
| budget, planned, available | бюджет, заплановано, доступно |
| free to spend | можна витратити |
| recurring (payment) | регулярний (платіж) |
| pending (queue) | очікують (перевірки) |
| debt, owed to you, you owe | борг, вам винні, ви винні |
| insights | аналітика |
| travel mode, trip | режим подорожі, подорож |
| savings, net worth | заощадження, чисті активи |
| payee, shop | отримувач, магазин |
| receipt, photo, note | чек, фото, нотатка |
| backup, restore, export, import | резервна копія, відновити, експорт, імпорт |
| merge / replace (import modes) | обʼєднати / замінити |
| Shortcut, automation | швидка команда, автоматизація |
| watch, widget, complication | годинник, віджет, ускладнення |
| settings, archive(d) | налаштування, архівувати (в архіві) |
| importance: high / medium / low | важливість: висока / середня / низька |
