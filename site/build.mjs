#!/usr/bin/env node
/**
 * Builds the Kopiyka Budget promo site.
 *
 *   node site/build.mjs          (or: bun run site)
 *
 * What it does, in order:
 *   1. makes web-sized copies of the bare device shots, the app icon and the
 *      Open Graph card with ImageMagick
 *   2. renders docs/*.md into site/*.html through site/_template.html
 *   3. checks that every local href/src in site/ resolves to a real file
 *   4. greps the output for absolute paths that must not ship
 *   5. prints the total size of site/
 *
 * Images come from apps/mobile/screenshots/appstore/bare/ — the capture inside
 * Apple's bezel on a transparent canvas, with no headline and no background.
 * Not the framed App Store slides: those carry their own headline, and printing
 * the same sentence on the image and again in the page reads as shouting.
 * Rebuild them with `bun run --cwd apps/mobile screenshots` (or frame.mjs
 * alone); they are committed, so this script only resizes.
 *
 * The only dependency is `marked` (a root devDependency). ImageMagick is
 * optional: without it the image step is skipped and the existing files in
 * site/img/ are left alone.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const SITE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SITE, '..');
const DOCS = join(ROOT, 'docs');
const SHOTS = join(ROOT, 'apps/mobile/screenshots');
const MAGICK = '/opt/homebrew/bin/magick';

const REPO = 'https://github.com/SashaGo3/kopiyka-budget';
/** Where the site will live once Pages is switched on — canonical and og:url need absolute URLs. */
const SITE_URL = 'https://sashago3.github.io/kopiyka-budget/';

let warnings = 0;
const warn = (msg) => {
  warnings += 1;
  console.warn(`  !  ${msg}`);
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- 1. pages

/** Links that point at repository files have to become site links or GitHub links. */
const LINK_MAP = {
  'privacy-policy.md': 'privacy.html',
  'terms-of-use.md': 'terms.html',
  'migrate-with-ai.md': 'migrate.html',
  'docs/privacy-policy.md': 'privacy.html',
  'docs/terms-of-use.md': 'terms.html',
  'docs/migrate-with-ai.md': 'migrate.html',
  '../DATA.md': `${REPO}/blob/main/DATA.md`,
  'DATA.md': `${REPO}/blob/main/DATA.md`,
  '../LICENSE': `${REPO}/blob/main/LICENSE`,
  'LICENSE': `${REPO}/blob/main/LICENSE`,
  '../CONTRIBUTING.md': `${REPO}/blob/main/CONTRIBUTING.md`,
  'how-it-works.md': `${REPO}/blob/main/docs/how-it-works.md`,
};

const PAGES = [
  {
    src: join(DOCS, 'privacy-policy.md'),
    out: join(SITE, 'privacy.html'),
    title: 'Privacy Policy',
    canonical: `${SITE_URL}privacy.html`,
    description:
      'Kopiyka Budget collects nothing. Where your data lives, the one network request the app makes, and what each permission is for.',
  },
  {
    src: join(DOCS, 'terms-of-use.md'),
    out: join(SITE, 'terms.html'),
    title: 'Terms of Use',
    canonical: `${SITE_URL}terms.html`,
    description:
      'Kopiyka Budget is free, is a personal record-keeping tool rather than financial advice, and your data is yours to keep.',
  },
  {
    src: join(DOCS, 'migrate-with-ai.md'),
    out: join(SITE, 'migrate.html'),
    title: 'Migrating from another app',
    canonical: `${SITE_URL}migrate.html`,
    description:
      'Export from your old budget app, hand the file and this prompt to an AI assistant, and import the result into Kopiyka Budget.',
    copyable: true,
  },
];

/** The Copy button is rendered hidden, so with no JS (or no clipboard API) there is
 *  no dead button — the prompt is still there to select by hand. */
const COPY_SCRIPT = `    <script>
      document.querySelectorAll('.copy-btn').forEach(function (b) {
        if (!navigator.clipboard) return;
        b.hidden = false;
        b.onclick = function () {
          navigator.clipboard.writeText(b.parentNode.querySelector('pre').innerText).then(function () {
            b.textContent = 'Copied';
            setTimeout(function () { b.textContent = 'Copy'; }, 1600);
          });
        };
      });
    </script>`;

function rewriteLinks(html) {
  return html.replace(/href="([^"]+)"/g, (whole, href) => {
    if (/^(https?:|mailto:|#)/.test(href)) return whole;
    const [path, hash = ''] = href.split('#');
    const mapped = LINK_MAP[path];
    if (mapped) return `href="${esc(mapped)}${hash ? '#' + hash : ''}"`;
    if (path.endsWith('.md')) {
      warn(`unmapped markdown link: ${href}`);
      return `href="${esc(`${REPO}/blob/main/${path.replace(/^(\.\.\/)+/, '')}`)}"`;
    }
    return whole;
  });
}

/** Wrap every <pre> in a positioned box with a Copy button. */
function addCopyButtons(html) {
  return html.replace(
    /<pre>([\s\S]*?)<\/pre>/g,
    (_, inner) =>
      `<div class="codeblock"><button type="button" class="copy-btn" hidden>Copy</button>` +
      `<pre tabindex="0" role="region" aria-label="The conversion prompt">${inner}</pre></div>`,
  );
}

function buildPages(template) {
  for (const page of PAGES) {
    const md = readFileSync(page.src, 'utf8');
    let html = marked.parse(md, { gfm: true });
    html = rewriteLinks(html);
    if (page.copyable) html = addCopyButtons(html);
    html = html
      .split('\n')
      .map((l) => (l ? '          ' + l : l))
      .join('\n');

    const out = template
      .replace(/\{\{title\}\}/g, esc(page.title))
      .replace(/\{\{description\}\}/g, esc(page.description))
      .replace(/\{\{canonical\}\}/g, esc(page.canonical))
      .replace(/\{\{site\}\}/g, esc(SITE_URL))
      .replace('{{scripts}}', page.copyable ? COPY_SCRIPT : '')
      .replace('{{content}}', html);

    writeFileSync(page.out, out);
    console.log(`  ✓ ${relative(ROOT, page.out)}`);
  }
}

// --------------------------------------------------------------- 2. images

const hasMagick = existsSync(MAGICK);

function magick(args) {
  execFileSync(MAGICK, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function buildImages() {
  if (!hasMagick) {
    console.log(`  – ImageMagick not found at ${MAGICK}; keeping the images already in site/img/`);
    return;
  }

  mkdirSync(join(SITE, 'img/shots'), { recursive: true });
  mkdirSync(join(SITE, 'img/watch'), { recursive: true });

  const bareIphone = join(SHOTS, 'appstore/bare/iphone');
  const bareWatch = join(SHOTS, 'appstore/bare/watch');
  for (const dir of [bareIphone, bareWatch]) {
    if (!existsSync(dir)) {
      warn(`${relative(ROOT, dir)} is missing — run: bun run --cwd apps/mobile screenshots`);
      return;
    }
  }

  // Only the ids the page actually shows. frame.mjs also renders the extras/
  // spares into bare/, and shipping a 250 KB PNG nothing links to is 250 KB
  // every visitor pays for.
  const shots = JSON.parse(readFileSync(join(SHOTS, 'shots.json'), 'utf8'));
  // …and only the ids index.html actually shows: a slide dropped from the page must not keep
  // shipping its image.
  const indexHtml = readFileSync(join(SITE, 'index.html'), 'utf8');
  const wanted = (list) => (list || []).map((s) => `${s.id}.png`).filter((n) => indexHtml.includes(`/${n}`));

  // Bare phones at 560 px wide. The alpha channel is the point: the page's own
  // background shows through, so -background/-flatten must stay well away.
  for (const name of wanted(shots.iphone)) {
    if (!existsSync(join(bareIphone, name))) {
      warn(`bare/iphone/${name} is missing — rerun frame.mjs`);
      continue;
    }
    magick([
      join(bareIphone, name),
      '-strip',
      '-resize', '560x',
      '-define', 'png:compression-level=9',
      join(SITE, 'img/shots', name),
    ]);
  }

  // Bare watches at 300 px wide, alpha kept for the same reason.
  for (const name of wanted(shots.watch)) {
    if (!existsSync(join(bareWatch, name))) {
      warn(`bare/watch/${name} is missing — rerun frame.mjs`);
      continue;
    }
    magick([
      join(bareWatch, name),
      '-strip',
      '-resize', '300x',
      '-define', 'png:compression-level=9',
      join(SITE, 'img/watch', name),
    ]);
  }

  // App icon.
  const icon = join(ROOT, 'apps/mobile/assets/images/icon.png');
  for (const size of [180, 512]) {
    magick([
      icon, '-strip', '-resize', `${size}x${size}`,
      '-define', 'png:compression-level=9',
      join(SITE, `img/icon-${size}.png`),
    ]);
  }

  // Open Graph card: the bare log phone, big, on the brand background, cropped
  // partway down the device — a whole 1:2 phone shrunk into a 1200x630 card is
  // a stripe of off-white with a speck in the middle.
  magick([
    '-size', '1200x630', 'xc:#F4F4F1',
    '(', join(bareIphone, 'log.png'), '-strip', '-resize', 'x1080', ')',
    '-gravity', 'north', '-geometry', '+0+54', '-composite',
    '-strip', '-alpha', 'off', '-depth', '8',
    '-define', 'png:compression-level=9',
    join(SITE, 'img/og.png'),
  ]);

  console.log('  ✓ site/img/ (bare phones, bare watches, icons, og)');
}

// ---------------------------------------------------- 3. + 4. sanity checks

function listFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

function checkLinks() {
  const pages = listFiles(SITE).filter((f) => f.endsWith('.html') && !f.endsWith('_template.html'));
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const targets = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const target of targets) {
      if (/^(https?:|mailto:|data:|#|\/\/)/.test(target)) continue;
      const [path, hash] = target.split('#');
      if (!path) continue;
      checked += 1;
      const file = resolve(dirname(page), path);
      if (!existsSync(file)) warn(`${relative(ROOT, page)} → missing ${target}`);
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

// ----------------------------------------------------------------- 5. size

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
buildImages();
buildPages(readFileSync(join(SITE, '_template.html'), 'utf8'));
checkLinks();
checkNoLeaks();
reportSize();
console.log(warnings ? `\nDone with ${warnings} warning(s).` : '\nDone, no warnings.');
