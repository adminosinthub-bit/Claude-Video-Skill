#!/usr/bin/env node
// Поиск и подстановка логотипов брендов.
//
//   node logos.mjs get <бренд|домен|URL> [--out assets/logos] [--source auto|site|wikimedia|favicon|simple-icons] [--refresh] [--json]
//   node logos.mjs auto <file.html> [--out assets/logos] [--quiet]   найти все P.logo('Имя') / data-logo="Имя" в HTML и записать logos.js рядом
//   node logos.mjs search <запрос>                                   поиск по базе simple-icons
//   node logos.mjs list [--out assets/logos]                         что уже сохранено
//
// Порядок поиска (первый удачный выигрывает):
//   0. assets/logos/_custom/<slug>.(svg|png|jpg|webp)  — ваш бренд-кит, высший приоритет
//   1. кэш assets/logos/<slug>.*
//   2. simple-icons (npm-пакет, 3000+ брендов, однотонные SVG с официальным цветом; ставится сам)
//   3. сайт бренда: <link rel=icon|apple-touch-icon|mask-icon>, <img class=logo>, JSON-LD logo, inline <svg logo>, og:image
//   4. Wikimedia Commons (SVG приоритетнее, сохраняется лицензия)
//   5. favicon (Google s2) — низкое качество, последний шанс
// Если логотип не найден, P.logo() рисует текстовую плашку с названием, и ролик всё равно рендерится.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const NOTICE = 'Логотип — товарный знак владельца. Используй для упоминания/демонстрации бренда по просьбе пользователя; не имитируй официальные материалы бренда и не создавай впечатления, что ролик одобрен владельцем. Проверь лицензию в поле license.';

export const slugOf = (s) =>
  (/[\u0400-\u04FF]/.test(s) ? String(s).toLowerCase() : String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')).replace(/&/g, 'and').replace(/\+/g, 'plus').replace(/[^\p{L}\p{N}]/gu, '');

const MIME = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', gif: 'image/gif' };
const log = (...a) => { if (!globalThis.__QUIET) console.error(...a); };

/* ------------------------------ сеть (curl) ------------------------------ */
function http(url, { timeout = 15 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'logo-http-'));
  const body = join(dir, 'body');
  try {
    const r = spawnSync('curl', ['-sSL', '--noproxy', 'localhost,127.0.0.1', '-m', String(timeout), '-A', UA, '-H', 'Accept-Language: en,ru;q=0.8', '-o', body, '-w', '%{http_code}\t%{content_type}\t%{url_effective}', url], { encoding: 'utf8', maxBuffer: 1 << 20 });
    if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'curl не найден' : String(r.error.message));
    const [code, ctype, finalUrl] = (r.stdout || '').split('\t');
    const status = parseInt(code, 10) || 0;
    if (!status) throw new Error((r.stderr || 'нет ответа').trim().split('\n')[0] || 'нет ответа');
    const buf = existsSync(body) ? readFileSync(body) : Buffer.alloc(0);
    return { status, ctype: (ctype || '').toLowerCase(), url: finalUrl || url, buf };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function sniff(buf, ctype = '', url = '') {
  const head = buf.subarray(0, 512).toString('latin1');
  if (/<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8')) && !/<html/i.test(head)) return 'svg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp';
  if (head.startsWith('GIF8')) return 'gif';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico';
  return null;
}
const pngSize = (b) => (b[0] === 0x89 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);

/* ------------------------------ simple-icons ------------------------------ */
let SI = null;
async function loadSimpleIcons() {
  if (SI) return SI;
  const tries = [join(ROOT, 'node_modules', 'simple-icons', 'index.mjs'), join(CACHE, 'node_modules', 'simple-icons', 'index.mjs')];
  for (let pass = 0; pass < 2; pass++) {
    for (const p of tries) {
      if (existsSync(p)) {
        const m = await import(pathToFileURL(p).href);
        const icons = Object.values(m).filter((v) => v && typeof v === 'object' && v.slug && v.svg);
        let aliases = {};
        try {
          const data = JSON.parse(readFileSync(join(dirname(p), 'data', 'simple-icons.json'), 'utf8'));
          for (const d of data) aliases[slugOf(d.title)] = [...(d.aliases?.aka || []), ...(d.aliases?.dup || []).map((x) => x.title)].map(slugOf);
        } catch { /* алиасы необязательны */ }
        return (SI = { icons, aliases });
      }
    }
    if (pass === 0) {
      log('simple-icons не найден — ставлю в scripts/.cache (npm)…');
      mkdirSync(CACHE, { recursive: true });
      if (!existsSync(join(CACHE, 'package.json'))) writeFileSync(join(CACHE, 'package.json'), '{"name":"logo-cache","private":true}');
      const r = spawnSync('npm', ['install', 'simple-icons', '--no-audit', '--no-fund', '--prefix', CACHE], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('npm install simple-icons не удался: ' + (r.stderr || '').trim().split('\n').slice(-2).join(' '));
    }
  }
  throw new Error('simple-icons недоступен');
}

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export async function searchSimpleIcons(query, limit = 8) {
  const { icons, aliases } = await loadSimpleIcons();
  const q = slugOf(query);
  if (!q) return [];
  const res = [];
  for (const ic of icons) {
    const t = slugOf(ic.title), s = ic.slug.replace(/[^a-z0-9]/g, '');
    let score = 0;
    if (q === s || q === t) score = 100;
    else if ((aliases[t] || []).includes(q)) score = 92;
    else if (t.startsWith(q) || s.startsWith(q)) score = 70 - Math.min(20, (t.length - q.length));
    else if (q.length >= 5 && q.startsWith(t) && q.length - t.length <= 2) score = 76;
    else if (q.length >= 4 && (t.includes(q) || q.includes(t) && t.length >= 4)) score = 50 - Math.min(20, Math.abs(t.length - q.length));
    else if (q.length >= 5 && lev(q, t) <= 1) score = 60;
    if (score) res.push({ score, title: ic.title, slug: ic.slug, hex: ic.hex, icon: ic });
  }
  return res.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}

/* ------------------------------ сайт бренда ------------------------------ */
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
};

export function collectCandidates(html, base) {
  const out = [];
  const add = (url, score, kind, inline) => {
    try { out.push({ url: inline ? base : new URL(url.replace(/&amp;/g, '&'), base).href, score, kind, inline }); } catch { /* битый URL */ }
  };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0], rel = (attr(tag, 'rel') || '').toLowerCase(), href = attr(tag, 'href');
    if (!href) continue;
    const type = (attr(tag, 'type') || '').toLowerCase(), size = parseInt(attr(tag, 'sizes') || '0', 10) || 0;
    const isSvg = type.includes('svg') || /\.svg(\?|#|$)/i.test(href);
    if (/mask-icon/.test(rel)) add(href, 72, 'mask-icon');
    else if (/apple-touch-icon/.test(rel)) add(href, 64 + Math.min(10, size / 40), 'apple-touch-icon');
    else if (/\bicon\b/.test(rel)) add(href, isSvg ? 88 : 35 + (size >= 128 ? 12 : 0), 'icon');
  }
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0], src = attr(tag, 'src') || attr(tag, 'data-src');
    if (!src || src.startsWith('data:')) continue;
    if (/logo|brand/i.test(tag)) add(src, /\.svg(\?|#|$)/i.test(src) ? 95 : 82, 'img-logo');
  }
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (/property\s*=\s*["']og:image["']/i.test(tag) && attr(tag, 'content')) add(attr(tag, 'content'), 28, 'og:image');
  }
  for (const m of html.matchAll(/"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*?"url"\s*:\s*"([^"]+)")/g)) add(m[1] || m[2], 86, 'jsonld-logo');
  for (const m of html.matchAll(/<svg\b[^>]*(?:logo|brand)[^>]*>[\s\S]*?<\/svg>/gi)) {
    if (m[0].length < 200 || m[0].length > 80000 || !/viewBox/i.test(m[0])) continue;
    let svg = m[0];
    if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    out.push({ url: base, score: 90, kind: 'inline-svg', inline: svg });
    break;
  }
  const seen = new Set();
  return out.filter((c) => (c.inline ? true : !seen.has(c.url) && seen.add(c.url))).sort((a, b) => b.score - a.score);
}

function domainOf(query) {
  const q = query.trim();
  if (/^https?:\/\//i.test(q)) return { base: q, domain: new URL(q).hostname };
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(q)) return { base: 'https://' + q, domain: q.split('/')[0] };
  return null;
}

async function fromSite(query, { tried }) {
  let targets = [];
  const d = domainOf(query);
  if (d) targets.push(d);
  else { const s = slugOf(query); if (s) for (const tld of ['com', 'io', 'org']) targets.push({ base: `https://${s}.${tld}/`, domain: `${s}.${tld}` }); }
  for (const t of targets) {
    let page;
    try { page = http(t.base); } catch (e) { tried.push(`site ${t.domain}: ${e.message}`); continue; }
    if (page.status >= 400 || !page.buf.length) { tried.push(`site ${t.domain}: HTTP ${page.status}`); continue; }
    const html = page.buf.toString('utf8');
    const list = collectCandidates(html, page.url);
    if (!list.length) { tried.push(`site ${t.domain}: логотипов в разметке нет`); continue; }
    for (const c of list.slice(0, 8)) {
      try {
        let buf, ext;
        if (c.inline) { buf = Buffer.from(c.inline); ext = 'svg'; }
        else {
          const r = http(c.url);
          if (r.status >= 400) continue;
          buf = r.buf; ext = sniff(buf, r.ctype, c.url);
        }
        if (!ext || buf.length < 200) continue;
        const dim = ext === 'png' ? pngSize(buf) : null;
        if (dim && (dim.w < 48 || dim.h < 48)) continue;
        return { source: 'site', sourceUrl: c.inline ? t.base + ' (inline svg)' : c.url, kind: c.kind, domain: t.domain, ext, buf, quality: ext === 'svg' ? 'vector' : dim && dim.w >= 256 ? 'good' : 'medium', license: 'Взято с сайта бренда — товарный знак владельца' };
      } catch (e) { tried.push(`site ${c.kind}: ${e.message}`); }
    }
    tried.push(`site ${t.domain}: ни один кандидат не подошёл`);
  }
  return null;
}

/* ------------------------------ Wikimedia Commons ------------------------------ */
async function fromWikimedia(query, { tried }) {
  const api = process.env.LOGO_WIKI_API || 'https://commons.wikimedia.org/w/api.php';
  const name = query.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.[a-z]{2,}$/i, '');
  for (const extra of [' filemime:image/svg+xml', '']) {
    const q = `${name} logo${extra}`;
    const url = `${api}?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=640&format=json&origin=*`;
    let data;
    try { const r = http(url); if (r.status >= 400) { tried.push(`wikimedia: HTTP ${r.status}`); continue; } data = JSON.parse(r.buf.toString('utf8')); }
    catch (e) { tried.push(`wikimedia: ${e.message}`); continue; }
    const pages = Object.values(data?.query?.pages || {});
    const want = slugOf(name);
    const ranked = pages.map((p) => {
      const ii = p.imageinfo?.[0]; if (!ii) return null;
      const t = slugOf(p.title.replace(/^File:/, ''));
      if (!t.includes(want)) return null;
      let score = 50 + (ii.mime === 'image/svg+xml' ? 20 : 0) + (/logo/i.test(p.title) ? 10 : 0) - (/old|former|variant|wordmark|icon only|201\d|200\d/i.test(p.title) ? 8 : 0);
      return { p, ii, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score);
    for (const c of ranked.slice(0, 3)) {
      try {
        const isSvg = c.ii.mime === 'image/svg+xml';
        const r = http(isSvg ? c.ii.url : (c.ii.thumburl || c.ii.url));
        if (r.status >= 400) continue;
        const ext = sniff(r.buf, r.ctype, c.ii.url);
        if (!ext) continue;
        const md = c.ii.extmetadata || {};
        return { source: 'wikimedia', sourceUrl: c.ii.descriptionurl || c.ii.url, kind: c.p.title, ext, buf: r.buf, quality: ext === 'svg' ? 'vector' : 'good', license: [md.LicenseShortName?.value, md.Artist?.value && String(md.Artist.value).replace(/<[^>]+>/g, '').trim()].filter(Boolean).join(' · ') || 'см. страницу файла на Commons' };
      } catch (e) { tried.push(`wikimedia: ${e.message}`); }
    }
  }
  tried.push('wikimedia: подходящего файла нет');
  return null;
}

/* ------------------------------ favicon ------------------------------ */
async function fromFavicon(query, { tried }) {
  const d = domainOf(query) || { domain: slugOf(query) + '.com' };
  const tpl = process.env.LOGO_FAVICON_URL || 'https://www.google.com/s2/favicons?domain={domain}&sz=256';
  try {
    const r = http(tpl.replace('{domain}', d.domain));
    if (r.status >= 400) { tried.push(`favicon: HTTP ${r.status}`); return null; }
    const ext = sniff(r.buf, r.ctype);
    if (!ext || r.buf.length < 80) { tried.push('favicon: пусто'); return null; }
    return { source: 'favicon', sourceUrl: tpl.replace('{domain}', d.domain), kind: 'favicon', domain: d.domain, ext, buf: r.buf, quality: 'low', license: 'favicon сайта — товарный знак владельца' };
  } catch (e) { tried.push(`favicon: ${e.message}`); return null; }
}

/* ------------------------------ главная функция ------------------------------ */
function findFile(dir, slug) {
  for (const e of ['svg', 'png', 'webp', 'jpg', 'gif', 'ico']) { const p = join(dir, `${slug}.${e}`); if (existsSync(p)) return p; }
  return null;
}

export async function getLogo(query, { out = DEF_OUT_DIR(), source = 'auto', refresh = false } = {}) {
  const slug = slugOf(domainOf(query)?.domain?.replace(/^www\./, '').replace(/\.[a-z]{2,}$/i, '') || query);
  mkdirSync(out, { recursive: true });
  const tried = [];
  const metaPath = join(out, `${slug}.json`);

  const custom = findFile(join(out, '_custom'), slug);
  if (custom) return { ok: true, slug, file: custom, source: 'custom', title: query, license: 'ваш бренд-кит', quality: 'custom', tried };
  if (!refresh && source === 'auto') {
    const f = findFile(out, slug);
    if (f && existsSync(metaPath)) return { ...JSON.parse(readFileSync(metaPath, 'utf8')), file: f, cached: true, tried };
  }

  let got = null, suggestions = [];
  if ((source === 'auto' || source === 'simple-icons') && !domainOf(query)) {
    try {
      const hits = await searchSimpleIcons(query);
      suggestions = hits.slice(0, 5).map((h) => `${h.title} (${h.slug})`);
      const best = hits[0];
      if (best && best.score >= 70) {
        const svg = best.icon.svg.replace(/<title>[^<]*<\/title>/, '');
        got = { source: 'simple-icons', sourceUrl: best.icon.source || 'https://simpleicons.org', kind: best.title, ext: 'svg', buf: Buffer.from(svg), hex: best.hex, mono: true, title: best.title, quality: 'vector', license: 'Иконка: CC0 (simple-icons); сам знак — товарный знак владельца' };
      } else tried.push(best ? `simple-icons: близкое «${best.title}» (${best.score}) слишком неточно` : 'simple-icons: не найдено');
    } catch (e) { tried.push('simple-icons: ' + e.message); }
  }
  if (!got && (source === 'auto' || source === 'site')) got = await fromSite(query, { tried });
  if (!got && (source === 'auto' || source === 'wikimedia')) got = await fromWikimedia(query, { tried });
  if (!got && (source === 'auto' || source === 'favicon')) got = await fromFavicon(query, { tried });
  if (!got) return { ok: false, slug, query, tried, suggestions, hint: 'Положите свой файл в assets/logos/_custom/' + slug + '.svg|png или уточните название/домен (например duolingo.com)' };

  const file = join(out, `${slug}.${got.ext}`);
  writeFileSync(file, got.buf);
  const dim = got.ext === 'png' ? pngSize(got.buf) : null;
  const meta = { ok: true, slug, query, title: got.title || query, source: got.source, sourceUrl: got.sourceUrl, kind: got.kind, format: got.ext, quality: got.quality, hex: got.hex || null, mono: !!got.mono, width: dim?.w || null, height: dim?.h || null, license: got.license, notice: NOTICE, fetchedAt: new Date().toISOString() };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return { ...meta, file, tried };
}
function DEF_OUT_DIR() { return join(ROOT, 'assets', 'logos'); }

/* ------------------------------ упаковка для HTML ------------------------------ */
export function toBundleEntry(res) {
  const file = res.file;
  const ext = extname(file).slice(1).toLowerCase();
  const buf = readFileSync(file);
  const e = { title: res.title || basename(file, '.' + ext), source: res.source, quality: res.quality, hex: res.hex || null, mono: !!res.mono };
  if (ext === 'svg' && res.mono) e.svg = buf.toString('utf8');
  else e.src = `data:${MIME[ext] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
  return e;
}

export function scanBrands(html) {
  const names = new Set();
  for (const m of html.matchAll(/P\.logo(?:Tile)?\(\s*(['"`])([^'"`]+?)\1/g)) names.add(m[2]);
  for (const m of html.matchAll(/data-logo\s*=\s*"([^"]+)"/g)) names.add(m[1]);
  return [...names];
}

export async function autoLogos(htmlPath, { out = DEF_OUT_DIR(), quiet = false } = {}) {
  const p = resolve(htmlPath);
  let html = readFileSync(p, 'utf8');
  const brands = scanBrands(html);
  if (!brands.length) return { brands: [], found: [], missing: [] };
  const bundle = {}, found = [], missing = [];
  for (const b of brands) {
    const r = await getLogo(b, { out });
    if (r.ok) { bundle[slugOf(b)] = toBundleEntry(r); found.push({ brand: b, source: r.source, quality: r.quality, license: r.license }); if (!quiet) log(`  логотип «${b}»: ${r.source}${r.cached ? ' (кэш)' : ''}, ${r.quality}`); }
    else { missing.push({ brand: b, tried: r.tried, hint: r.hint }); log(`  логотип «${b}»: НЕ НАЙДЕН (${(r.tried || []).slice(-2).join('; ')}) — будет текстовая плашка`); }
  }
  const js = join(dirname(p), 'logos.js');
  writeFileSync(js, '/* сгенерировано scripts/logos.mjs — не править вручную */\nwindow.LOGOS = ' + JSON.stringify(bundle) + ';\n');
  if (!/src\s*=\s*["']logos\.js["']/.test(html)) {
    const tag = '<script src="logos.js"></script>';
    if (/<script[^>]*parts\.js[^>]*><\/script>/.test(html)) html = html.replace(/(<script[^>]*parts\.js[^>]*><\/script>)/, `$1${tag}`);
    else html = html.replace(/<script\b/, `${tag}<script`);
    writeFileSync(p, html);
  }
  return { brands, found, missing, js };
}

/* ------------------------------ CLI ------------------------------ */
async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
  const has = (n) => rest.includes(`--${n}`);
  const VALUE_FLAGS = new Set(['--out', '--source']);
  const pos = rest.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(rest[i - 1]));
  const out = resolve(flag('out', DEF_OUT_DIR()));
  globalThis.__QUIET = has('quiet');
  if (cmd === 'get' && pos[0]) {
    const r = await getLogo(pos[0], { out, source: flag('source', 'auto'), refresh: has('refresh') });
    if (has('json')) console.log(JSON.stringify(r, null, 2));
    else if (r.ok) console.log(`${r.title}: ${r.file}\n  источник: ${r.source}${r.sourceUrl ? ' · ' + r.sourceUrl : ''}\n  качество: ${r.quality}${r.hex ? ' · цвет #' + r.hex : ''}\n  лицензия: ${r.license}\n  ${NOTICE}`);
    else { console.log(`Не найден: ${pos[0]}\n  ${(r.tried || []).join('\n  ')}\n  ${r.suggestions?.length ? 'похожие: ' + r.suggestions.join(', ') + '\n  ' : ''}${r.hint}`); process.exitCode = 1; }
  } else if (cmd === 'auto' && pos[0]) {
    const r = await autoLogos(pos[0], { out, quiet: has('quiet') });
    if (!r.brands.length) console.error('В HTML нет P.logo(...) / data-logo — нечего искать.');
    else console.error(`Логотипы: найдено ${r.found.length}/${r.brands.length}${r.missing.length ? ', без логотипа: ' + r.missing.map((m) => m.brand).join(', ') : ''}`);
    if (r.missing.length) process.exitCode = 2;
  } else if (cmd === 'search' && pos[0]) {
    for (const h of await searchSimpleIcons(pos.join(' '), 12)) console.log(`${String(h.score).padStart(3)}  ${h.title}  (${h.slug})  #${h.hex}`);
  } else if (cmd === 'list') {
    if (!existsSync(out)) return console.log('пусто');
    for (const f of readdirSync(out).filter((f) => f.endsWith('.json'))) { const m = JSON.parse(readFileSync(join(out, f), 'utf8')); console.log(`${m.slug.padEnd(20)} ${m.source.padEnd(12)} ${m.quality}`); }
  } else {
    console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
