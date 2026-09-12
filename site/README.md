# site/ — the Kopiyka Budget promo page

A small static website: one landing page plus the three documents from `docs/` rendered to HTML.
Hand-written HTML and one stylesheet — no framework, no external scripts, no web fonts, no
analytics. It is the same rule the app follows: nothing loads from anywhere else.

```
site/
  index.html        the landing page (hand-written; edit this file directly)
  privacy.html      generated from docs/privacy-policy.md
  terms.html        generated from docs/terms-of-use.md
  migrate.html      generated from docs/migrate-with-ai.md
  _template.html    the shell those three are poured into ({{title}}, {{description}},
                    {{content}}, {{scripts}})
  styles.css        every style on the site, light and dark
  build.mjs         the build script
  img/              generated: shots/, watch/, icon-180.png, icon-512.png, og.png
  .nojekyll         tells GitHub Pages to serve the files as they are
```

## Rebuilding

```sh
bun run site        # from the repository root; same as: node site/build.mjs
```

It renders the three markdown documents, makes the web-sized images, checks that every local
`href`/`src` in the output resolves to a file that exists, makes sure no absolute local path ended
up in the HTML, and prints the total size of `site/` (the target is under 4 MB).

The generated HTML and images are committed, so GitHub Pages needs no build step. Run the script
after changing any of `docs/privacy-policy.md`, `docs/terms-of-use.md`,
`docs/migrate-with-ai.md`, `site/_template.html`, or the screenshots, and commit what it writes.

## Where the screenshots come from

`site/img/shots/` and `site/img/watch/` are resized from
`apps/mobile/screenshots/appstore/bare/` — the raw capture inside Apple's iPhone 17 Pro Max and
Apple Watch Ultra 3 bezels on a **transparent** canvas, with no headline, no subtitle and no slide
background. Not the framed App Store slides: those carry a headline baked into the picture, and
the page has its own heading right beside it, so the visitor reads the same sentence twice.

`frame.mjs` writes that set as part of `bun run --cwd apps/mobile screenshots`, and it is
committed like the rest of `appstore/`. Only the ids listed in `screenshots/shots.json`
(`iphone[]` and `watch[]`) are copied into the site; the spares in `extras[]` are rendered but not
shipped. Captions come from the same `shots.json` `title` fields, so change a caption there and
rebuild.

Dependencies: [`marked`](https://github.com/markedjs/marked), a devDependency at the repository
root, and ImageMagick (`/opt/homebrew/bin/magick`) for the images. Without ImageMagick the script
still builds the pages and leaves the images in `site/img/` untouched.

## One thing to fill in

**The App Store URL.** The "Download on the App Store" buttons are plain styled links to `#`,
marked `data-todo="app-store-url"`. Replace the `href="#"` with the product URL
(`https://apps.apple.com/app/idXXXXXXXXXX`) and delete the `data-todo` attribute. There are two of
them in `index.html` (header and hero) and one in `_template.html` — change the template, not the
generated pages, and rerun the build.

Apple's "Download on the App Store" badge artwork is deliberately **not** bundled here: it has
to be downloaded from Apple's marketing resources and used under Apple's own guidelines. The
text button is a fine stand-in, and stays a fine button if you would rather not use the badge.

That is the only placeholder left. The repository (`https://github.com/SashaGo3/kopiyka-budget`),
the Pages URL (`https://sashago3.github.io/kopiyka-budget/`, used for `canonical` and `og:url`) and
the support mailbox (`kopiyka_budget@icloud.com`) are all real and live in the `REPO` / `SITE_URL`
constants in `site/build.mjs` plus the two hand-written HTML files.

## Publishing

`.github/workflows/pages.yml` deploys this folder to GitHub Pages. It is set to
`workflow_dispatch` only, so nothing is published until you turn Pages on
(Settings → Pages → Source: GitHub Actions) and press "Run workflow" yourself. The comment block
at the top of that file explains how to switch it to deploy on every push, and how to serve the
site without Actions at all.

## A custom domain

If you buy a domain, add a file called `CNAME` in this folder containing just the hostname, with
no scheme and no trailing slash:

```
kopiyka.example
```

Commit it, point the domain's DNS at GitHub Pages (an `ALIAS`/`ANAME` record at the apex, or a
`CNAME` record for a subdomain pointing at `sashago3.github.io`), and set the same name under
Settings → Pages → Custom domain. The file has to live in the published folder — that is this one —
or the next deployment drops it.

## House rules for the page

- Colours: off-white `#F4F4F1`, graphite `#2B2B2E`, cards `#FFFFFF`, borders `#D9D9D4`; in the dark
  scheme `#141413` / `#F4F4F1` / `#1F1F1E` / `#2E2E2C`. One warm accent `#C8A96A`, used for thin
  rules only. **No system blue** — the same rule as the app.
- The system font stack only. Nothing is fetched from a CDN.
- Every image needs alt text; screenshot captions come from
  `apps/mobile/screenshots/shots.json`, so change them there and rebuild.
- Keep the page short. The landing page is deliberately quiet: a headline, one line, the buttons,
  one sentence per feature card. It is not trying to talk anyone into anything.
- No personal names and no real financial data anywhere on the site. The only address on it is the
  project mailbox, `kopiyka_budget@icloud.com`.
