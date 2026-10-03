#!/usr/bin/env node
/**
 * Builds the Kopiyka Budget promo site, once per language.
 *
 *   node site/build.mjs          (or: bun run site)
 *
 * What it does, in order:
 *   1. makes web-sized copies of the bare device shots (iPhone, iPad, watch), the app icon and the
 *      Open Graph card with ImageMagick — per language where that language has its own captures
 *   2. renders site/_index.html into index.html (English) and uk/index.html, filling every
 *      {{site.…}} key from site/i18n/<lang>.json
 *   3. renders docs/*.md (and docs/uk/*.md) through site/_template.html into privacy, terms and
 *      migrate pages, and warns when an English document is newer in git than its translation
 *   4. checks that every local href/src in site/ resolves to a real file, and that no {{…}} is left
 *   5. greps the output for absolute paths that must not ship
 *   6. prints the total size of site/
 *
 * The text comes from packages/i18n/locales/<lang>/site.json, compiled to site/i18n/<lang>.json
 * by `bun run i18n`. Edit the text there, not in the generated pages.
 *
 * Images come from the bare set frame.mjs writes — the capture inside Apple's bezel on a
 * transparent canvas, with no headline and no background. Not the framed App Store slides: those
 * carry their own headline, and printing the same sentence on the image and again in the page
 * reads as shouting. Where those live is `bareDir` below, and nowhere else.
 *
 * The only dependency is `marked` (a root devDependency). ImageMagick is optional: without it the
 * image step is skipped and the existing files in site/img/ are left alone.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SITE, '..');
const DOCS = join(ROOT, 'docs');
const SHOTS = join(ROOT, 'apps/mobile/screenshots');
const MAGICK = '/opt/homebrew/bin/magick';

const REPO = 'https://github.com/SashaGo3/kopiyka-budget';
/** Where the site lives — canonical, og:url and hreflang need absolute URLs. */
const SITE_URL = 'https://sashago3.github.io/kopiyka-budget/';
const APP_STORE = 'https://apps.apple.com/us/app/kopiyka-budget/id6809896169';

/**
 * The languages the site is built in. The first is the source: its pages sit at the root, every
 * other language's in a folder named by its code. `label` is the switcher's text, `og` og:locale,
 * `appStore` the App Store language code frame.mjs names its output folder after.
 * Keep in step with packages/i18n/i18n.config.ts.
 */
const LANGS = [
  { code: 'en', dir: '', label: 'EN', name: 'English', og: 'en_GB', appStore: 'en-US' },
  { code: 'uk', dir: 'uk/', label: 'УКР', name: 'Українська', og: 'uk_UA', appStore: 'uk' },
];
const SOURCE = LANGS[0];

let warnings = 0;
const warn = (msg) => {
  warnings += 1;
  console.warn(`  !  ${msg}`);
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ------------------------------------------------------------ screenshots

/**
 * Where frame.mjs writes the bare (transparent) set for a language and device — iphone, ipad or
 * watch. The one place that knows the layout of screenshots/appstore/: frame.mjs writes
 * appstore/<App Store language>/bare/<device> (appstore/en-US/…, appstore/uk/…); the source
 * language also accepts the older unprefixed appstore/bare/<device>. Returns null when the
 * language has no captures for that device.
 */
function bareDir(lang, device) {
  const candidates = [join(SHOTS, 'appstore', lang.appStore, 'bare', device)];
  if (lang === SOURCE) candidates.push(join(SHOTS, 'appstore', 'bare', device));
  return candidates.find((d) => existsSync(d)) ?? null;
}

/** Where a language's web-sized images go: img/ for the source, img/<code>/ for the rest. */
const imgDir = (lang) => (lang === SOURCE ? 'img' : `img/${lang.code}`);

// --------------------------------------------------------------- messages

function loadMessages() {
  const read = (code) => {
    const file = join(SITE, 'i18n', `${code}.json`);
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  };
  const source = read(SOURCE.code);
  if (!Object.keys(source).length) {
    throw new Error('site/i18n/en.json is empty — run `bun run i18n` at the repository root first');
  }
  const out = {};
  for (const lang of LANGS) {
    const own = read(lang.code);
    const missing = Object.keys(source).filter((k) => !(k in own));
    if (lang !== SOURCE && missing.length) {
      warn(`${lang.code}: ${missing.length} site message(s) fall back to English (${missing.slice(0, 3).join(', ')}…)`);
    }
    out[lang.code] = { ...source, ...own };
  }
  return out;
}

/**
 * Fills {{site.key}} from the messages (escaped — they are plain text) and {{name}} from `vars`
 * (inserted as they are — they are HTML the build made). An unknown placeholder stops the build.
 */
function fill(template, msgs, vars) {
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_, key) => {
    if (key.startsWith('site.')) {
      if (!(key in msgs)) throw new Error(`no message "${key}" — add it to packages/i18n/locales/en/site.json and run bun run i18n`);
      return esc(msgs[key]);
    }
    if (key in vars) return vars[key];
    throw new Error(`unknown placeholder {{${key}}}`);
  });
}

// -------------------------------------------------------- per-page chrome

/** The absolute URL of `file` in `lang`; an index is its folder. */
const pageUrl = (lang, file) => SITE_URL + lang.dir + (file === 'index.html' ? '' : file);

/** The relative link from a page in `from`'s folder to `file` in `to`'s. Folders are one level deep. */
const pageHref = (from, to, file) => (from === to ? '' : (from.dir ? '../' : '') + to.dir) + file;

/** hreflang links, og:locale and the language switcher, among the languages the page exists in. */
function chrome(lang, file, available) {
  const alternates = [
    ...available.map((l) => `    <link rel="alternate" hreflang="${l.code}" href="${pageUrl(l, file)}" />`),
    `    <link rel="alternate" hreflang="x-default" href="${pageUrl(SOURCE, file)}" />`,
  ].join('\n');
  const ogLocale = [
    `    <meta property="og:locale" content="${lang.og}" />`,
    ...available.filter((l) => l !== lang).map((l) => `    <meta property="og:locale:alternate" content="${l.og}" />`),
  ].join('\n');
  const langSwitch = available.length < 2 ? '' : [
    `          <nav class="lang-switch" aria-label="{{site.chrome.language}}">`,
    ...available.map(
      (l) =>
        `            <a href="${pageHref(lang, l, file)}" hreflang="${l.code}" lang="${l.code}" title="${esc(l.name)}"` +
        (l === lang ? ' aria-current="page"' : '') +
        `>${esc(l.label)}</a>`,
    ),
    `          </nav>`,
  ].join('\n');
  const og = existsSync(join(SITE, imgDir(lang), 'og.png')) ? `${imgDir(lang)}/og.png` : 'img/og.png';
  return {
    vars: {
      lang: lang.code,
      canonical: pageUrl(lang, file),
      alternates,
      ogLocale,
      ogImage: SITE_URL + og,
      appStore: APP_STORE,
      repo: REPO,
      // Filled after the paths are localised: its hrefs are already final.
      langSwitch: '{{langSwitch}}',
    },
    langSwitch,
  };
}

/**
 * Points a page's relative paths where they resolve from its language folder: pages stay in the
 * folder (privacy.html is the Ukrainian one beside uk/index.html), assets go up to the shared
 * ones — or to img/<lang>/… when that language has its own copy of a screenshot.
 */
function localizePaths(html, lang) {
  return html.replace(/(href|src)="([^"]+)"/g, (whole, attr, url) => {
    if (/^(https?:|mailto:|data:|#|\/\/|\.\.\/)/.test(url)) return whole;
    const path = url.split('#')[0];
    const shot = path.match(/^img\/(shots|ipad|watch)\/([^/]+)$/);
    if (shot && lang !== SOURCE && existsSync(join(SITE, imgDir(lang), shot[1], shot[2]))) {
      return `${attr}="${pageHref(lang, SOURCE, `${imgDir(lang)}/${shot[1]}/${shot[2]}`)}"`;
    }
    if (!lang.dir || path.endsWith('.html')) return whole;
    return `${attr}="../${url}"`;
  });
}

function render(template, lang, file, msgs, vars, available) {
  const c = chrome(lang, file, available);
  let html = fill(template, msgs, { ...c.vars, ...vars });
  html = localizePaths(html, lang);
  html = html.replace('{{langSwitch}}', () => fill(c.langSwitch, msgs, {}));
  const out = join(SITE, lang.dir, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`  ✓ ${relative(ROOT, out)}`);
}

// ------------------------------------------------------- the landing page

function buildIndex(messages) {
  // The note at the top of the template is for whoever edits it, not for visitors.
  const template = readFileSync(join(SITE, '_index.html'), 'utf8').replace(/<!--\n[\s\S]*?-->\n/, '');
  for (const lang of LANGS) render(template, lang, 'index.html', messages[lang.code], {}, LANGS);
}

// ---------------------------------------------------------- the documents

/**
 * Rendered from docs/<md> for the source language and docs/<code>/<md> for the others — whole
 * translated documents, not messages. Title and description come from site.docs.<key>.
 */
const DOC_PAGES = [
  { md: 'privacy-policy.md', file: 'privacy.html', key: 'privacy' },
  { md: 'terms-of-use.md', file: 'terms.html', key: 'terms' },
  { md: 'migrate-with-ai.md', file: 'migrate.html', key: 'migrate', copyable: true },
];

const docSource = (lang, page) => join(DOCS, lang === SOURCE ? '' : lang.code, page.md);

/** Markdown links to the documents become site links. Keys are as written in the markdown, so a
 *  translation in docs/<lang>/ reaches its English original one folder up. Any other repository
 *  file (DATA.md, LICENSE, how-it-works.md) becomes a GitHub link in rewriteLinks. */
const LINK_MAP = {
  'privacy-policy.md': 'privacy.html',
  'terms-of-use.md': 'terms.html',
  'migrate-with-ai.md': 'migrate.html',
  'docs/privacy-policy.md': 'privacy.html',
  'docs/terms-of-use.md': 'terms.html',
  'docs/migrate-with-ai.md': 'migrate.html',
  '../privacy-policy.md': '../privacy.html',
  '../terms-of-use.md': '../terms.html',
  '../migrate-with-ai.md': '../migrate.html',
};

function rewriteLinks(html, src) {
  return html.replace(/href="([^"]+)"/g, (whole, href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return whole;
    const [path, hash = ''] = href.split('#');
    const tail = hash ? '#' + hash : '';
    const mapped = LINK_MAP[path];
    if (mapped) return `href="${esc(mapped)}${tail}"`;
    const inRepo = relative(ROOT, resolve(dirname(src), path));
    if (!inRepo.startsWith('..') && existsSync(join(ROOT, inRepo))) {
      return `href="${esc(`${REPO}/blob/main/${inRepo}`)}${tail}"`;
    }
    if (path.endsWith('.md')) warn(`${relative(ROOT, src)}: unmapped markdown link ${href}`);
    return whole;
  });
}

/** Wrap every <pre> in a positioned box with a Copy button. The button is rendered hidden, so with
 *  no JS (or no clipboard API) there is no dead button — the prompt is still there to select. */
function addCopyButtons(html, msgs) {
  return html.replace(
    /<pre>([\s\S]*?)<\/pre>/g,
    (_, inner) =>
      `<div class="codeblock"><button type="button" class="copy-btn" hidden>${esc(msgs['site.docs.copy'])}</button>` +
      `<pre tabindex="0" role="region" aria-label="${esc(msgs['site.docs.prompt'])}">${inner}</pre></div>`,
  );
}

const copyScript = (msgs) => `    <script>
      document.querySelectorAll('.copy-btn').forEach(function (b) {
        if (!navigator.clipboard) return;
        b.hidden = false;
        b.onclick = function () {
          navigator.clipboard.writeText(b.parentNode.querySelector('pre').innerText).then(function () {
            b.textContent = ${JSON.stringify(msgs['site.docs.copied'])};
            setTimeout(function () { b.textContent = ${JSON.stringify(msgs['site.docs.copy'])}; }, 1600);
          });
        };
      });
    </script>`;

function buildDocs(messages) {
  const template = readFileSync(join(SITE, '_template.html'), 'utf8');
  for (const page of DOC_PAGES) {
    const available = LANGS.filter((l) => existsSync(docSource(l, page)));
    for (const lang of LANGS) {
      if (!available.includes(lang)) {
        warn(`${relative(ROOT, docSource(lang, page))} is missing — ${lang.dir}${page.file} not built`);
        continue;
      }
      const msgs = messages[lang.code];
      const src = docSource(lang, page);
      let html = rewriteLinks(marked.parse(readFileSync(src, 'utf8'), { gfm: true }), src);
      if (page.copyable) html = addCopyButtons(html, msgs);
      html = html
        .split('\n')
        .map((l) => (l ? '          ' + l : l))
        .join('\n');
      render(template, lang, page.file, msgs, {
        title: esc(msgs[`site.docs.${page.key}.title`]),
        description: esc(msgs[`site.docs.${page.key}.description`]),
        scripts: page.copyable ? copyScript(msgs) : '',
        content: html,
      }, available);
    }
  }
}

/** The last commit time of a file, or null outside git or for a file never committed. */
function commitTime(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ct', '--', file], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out ? Number(out) : null;
  } catch {
    return null;
  }
}

/** A translation older than its original is still published, but someone should know. */
function checkTranslationsFresh() {
  for (const page of DOC_PAGES) {
    const original = commitTime(docSource(SOURCE, page));
    if (original === null) continue;
    for (const lang of LANGS.slice(1)) {
      const src = docSource(lang, page);
      if (!existsSync(src)) continue;
      const translated = commitTime(src);
      if (translated !== null && translated < original) {
        const day = new Date(original * 1000).toISOString().slice(0, 10);
        warn(`${relative(ROOT, src)} is older than docs/${page.md} (changed ${day}) — update the translation`);
      }
    }
  }
}

// ----------------------------------------------------------------- images

const hasMagick = existsSync(MAGICK);

function magick(args) {
  execFileSync(MAGICK, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function buildImages() {
  if (!hasMagick) {
    console.log(`  – ImageMagick not found at ${MAGICK}; keeping the images already in site/img/`);
    return;
  }

  // Only the ids the page actually shows: frame.mjs also renders the extras/spares, and shipping a
  // 250 KB PNG nothing links to is 250 KB every visitor pays for.
  const shots = JSON.parse(readFileSync(join(SHOTS, 'shots.json'), 'utf8'));
  const page = readFileSync(join(SITE, '_index.html'), 'utf8');
  const wanted = (list, dir) => (list || []).map((s) => `${s.id}.png`).filter((n) => page.includes(`img/${dir}/${n}`));
  const sets = [
    // Bare phones at 560 px wide. The alpha channel is the point: the page's own background
    // shows through, so -background/-flatten must stay well away.
    { device: 'iphone', dir: 'shots', width: 560, names: wanted(shots.iphone, 'shots') },
    // Bare iPads at 720 px — the page shows them at up to 360 — from the iPhone ids, since an
    // iPad slide is an iPhone slide captured on the iPad. Optional.
    { device: 'ipad', dir: 'ipad', width: 720, names: wanted([...(shots.iphone || []), ...(shots.extras || [])], 'ipad'), optional: true },
    // Bare watches at 300 px, alpha kept for the same reason.
    { device: 'watch', dir: 'watch', width: 300, names: wanted(shots.watch, 'watch') },
  ];

  for (const lang of LANGS) {
    const out = join(SITE, imgDir(lang));
    let made = 0;
    for (const set of sets) {
      const from = bareDir(lang, set.device);
      if (!from) {
        // A language without its own captures uses the source language's images.
        if (lang === SOURCE && !set.optional) warn(`no bare ${set.device} screenshots — run: bun run --cwd apps/mobile screenshots`);
        continue;
      }
      mkdirSync(join(out, set.dir), { recursive: true });
      for (const name of set.names) {
        if (!existsSync(join(from, name))) {
          if (lang === SOURCE) warn(`${relative(ROOT, join(from, name))} is missing — rerun frame.mjs`);
          continue;
        }
        magick([join(from, name), '-strip', '-resize', `${set.width}x`, '-define', 'png:compression-level=9', join(out, set.dir, name)]);
        made += 1;
      }
    }

    // Open Graph card: the bare log phone, big, on the brand background, cropped partway down the
    // device — a whole 1:2 phone shrunk into a 1200x630 card is a stripe of off-white with a speck.
    const phones = bareDir(lang, 'iphone');
    if (phones && existsSync(join(phones, 'log.png'))) {
      magick([
        '-size', '1200x630', 'xc:#F4F4F1',
        '(', join(phones, 'log.png'), '-strip', '-resize', 'x1080', ')',
        '-gravity', 'north', '-geometry', '+0+54', '-composite',
        '-strip', '-alpha', 'off', '-depth', '8',
        '-define', 'png:compression-level=9',
        join(out, 'og.png'),
      ]);
    }
    if (lang === SOURCE || made) console.log(`  ✓ site/${imgDir(lang)}/ (${made} device images and the og card)`);
    else console.log(`  – no ${lang.code} screenshots yet; ${lang.dir} pages use the ${SOURCE.code} ones`);
  }

  // App icon, shared by every language.
  const icon = join(ROOT, 'apps/mobile/assets/images/icon.png');
  for (const size of [180, 512]) {
    magick([icon, '-strip', '-resize', `${size}x${size}`, '-define', 'png:compression-level=9', join(SITE, `img/icon-${size}.png`)]);
  }
}

// ---------------------------------------------------------- sanity checks

function listFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

/** The generated pages: every .html except the templates, whose names start with an underscore. */
const builtPages = () => listFiles(SITE).filter((f) => f.endsWith('.html') && !basename(f).startsWith('_'));

function checkLinks() {
  const pages = builtPages();
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    if (/\{\{[^}]*\}\}/.test(html)) warn(`${relative(ROOT, page)} still has a {{placeholder}}`);
    const targets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const target of targets) {
      if (/^(https?:|mailto:|data:|#|\/\/)/.test(target)) continue;
      const [path, hash] = target.split('#');
      if (!path) continue;
      checked += 1;
      const file = resolve(dirname(page), path);
      if (!file.startsWith(SITE)) warn(`${relative(ROOT, page)} → ${target} points outside site/`);
      else if (!existsSync(file)) warn(`${relative(ROOT, page)} → missing ${target}`);
      else if (hash && file.endsWith('.html')) {
        const other = readFileSync(file, 'utf8');
        if (!other.includes(`id="${hash}"`)) warn(`${relative(ROOT, page)} → no #${hash} in ${path}`);
      }
    }
    // Anchors within the same page.
    for (const m of html.matchAll(/href="#([^"]+)"/g)) {
      checked += 1;
      if (!html.includes(`id="${m[1]}"`)) warn(`${relative(ROOT, page)} → no element with id="${m[1]}"`);
    }
  }
  console.log(`  ✓ link check: ${checked} local targets in ${pages.length} pages`);
}

function checkNoLeaks() {
  const forbidden = [/\/Users\//, /\/private\/tmp\//, new RegExp(SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))];
  for (const file of listFiles(SITE)) {
    if (/\.(png|jpg|jpeg|webp|ico)$/i.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const re of forbidden) {
      if (re.test(text)) warn(`${relative(ROOT, file)} contains an absolute local path (${re})`);
    }
  }
  console.log('  ✓ no absolute local paths in the text files');
}

function reportSize() {
  const files = listFiles(SITE);
  const total = files.reduce((n, f) => n + statSync(f).size, 0);
  const biggest = files
    .map((f) => [relative(SITE, f), statSync(f).size])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
  const kb = (n) => Math.round(n / 1024) + ' KB';
  console.log(`\n  site/ = ${mb(total)} in ${files.length} files`);
  console.log(`  largest: ${biggest.map(([n, s]) => `${n} ${kb(s)}`).join(', ')}`);
  if (total > 4 * 1024 * 1024) warn('site/ is over the 4 MB target');
}

// ------------------------------------------------------------------- main

console.log('Building site/ …');
const messages = loadMessages();
buildImages();
buildIndex(messages);
buildDocs(messages);
checkTranslationsFresh();
checkLinks();
checkNoLeaks();
reportSize();
console.log(warnings ? `\nDone with ${warnings} warning(s).` : '\nDone, no warnings.');
