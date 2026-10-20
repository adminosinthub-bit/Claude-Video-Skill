#!/usr/bin/env node
// Самотест поиска логотипов на локальных фикстурах (без обращения к реальным сайтам).
// node scripts/logos.selftest.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getLogo, collectCandidates, scanBrands, autoLogos, slugOf } from './logos.mjs';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="#7c3aed"/><circle cx="50" cy="50" r="24" fill="#fff"/><path d="M10 10L90 90" stroke="#fff" stroke-width="2"/></svg>';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAAS0lEQVR4nO3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMBvAD4AAUiXxwQAAAAASUVORK5CYII=', 'base64');
function startServer() {
  let port;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
    if (u.pathname === '/') return send(200, 'text/html', `<html><head><link rel="icon" href="/fav.ico"><link rel="apple-touch-icon" href="/touch.png"><meta property="og:image" content="/banner.png"></head><body><header><img class="site-logo" src="/assets/logo.svg" alt="Acme"></header></body></html>`);
    if (u.pathname === '/nologo') return send(200, 'text/html', '<html><body>ничего</body></html>');
    if (u.pathname === '/inline') return send(200, 'text/html', `<html><body><svg class="brand-logo" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f00"/>${'<circle cx="5" cy="5" r="1"/>'.repeat(10)}</svg></body></html>`);
    if (u.pathname === '/assets/logo.svg') return send(200, 'image/svg+xml', SVG);
    if (u.pathname === '/touch.png') return send(200, 'image/png', PNG);
    if (u.pathname === '/api') return send(200, 'application/json', JSON.stringify({ query: { pages: {
    1: { title: 'File:Zzacme old logo 2005.svg', imageinfo: [{ url: `http://127.0.0.1:${port}/files/old.svg`, mime: 'image/svg+xml', extmetadata: {} }] },
    2: { title: 'File:Zzacme logo.svg', imageinfo: [{ url: `http://127.0.0.1:${port}/assets/logo.svg`, mime: 'image/svg+xml', descriptionurl: `http://127.0.0.1:${port}/wiki/File:Zzacme_logo.svg`, extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a href="#">Acme Corp</a>' } } }] },
    3: { title: 'File:Other brand logo.svg', imageinfo: [{ url: `http://127.0.0.1:${port}/files/other.svg`, mime: 'image/svg+xml', extmetadata: {} }] } } } }));
    if (u.pathname === '/fav') return send(200, 'image/png', PNG);
    send(404, 'text/plain', 'no');
  });
  server.listen(0, '127.0.0.1', () => { port = server.address().port; console.log(port); });
}
if (process.argv.includes('--server')) { startServer(); await new Promise(() => {}); }

// сервер в отдельном процессе: logos.mjs ходит в сеть синхронным curl и заблокировал бы сервер этого процесса
const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--server'], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((r) => child.stdout.once('data', (d) => r(parseInt(String(d), 10))));
const base = `http://127.0.0.1:${port}`;
const out = mkdtempSync(join(tmpdir(), 'logos-test-'));
globalThis.__QUIET = true;

let fails = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); if (!cond) fails++; };

// 1. разбор разметки
const cands = collectCandidates(`<link rel="icon" type="image/svg+xml" href="/a.svg"><img class="logo" src="l.png"><script type="application/ld+json">{"logo":"https://x.test/ld.png"}</script>`, 'https://x.test/p/');
ok('кандидаты: svg-иконка, img.logo, JSON-LD', cands.length === 3 && cands.some((c) => c.kind === 'jsonld-logo' && c.url === 'https://x.test/ld.png') && cands.some((c) => c.url === 'https://x.test/p/l.png'), JSON.stringify(cands));
ok('кандидаты: svg-иконка в приоритете над png', cands[0].url === 'https://x.test/a.svg' || cands[0].kind === 'icon' || cands[0].score >= 86, JSON.stringify(cands[0]));

// 2. сайт: img.logo (svg) побеждает favicon/og
let r = await getLogo(base + '/', { out, source: 'site' });
ok('сайт: найден SVG из <img class=logo>', r.ok && r.source === 'site' && r.format === 'svg' && readFileSync(r.file, 'utf8').includes('<svg'), JSON.stringify(r));
ok('сайт: метаданные и лицензия записаны', existsSync(join(out, r.slug + '.json')) && /товарный знак/.test(r.license));

// 3. сайт: inline svg
r = await getLogo(base + '/inline', { out, source: 'site' });
ok('сайт: inline <svg class=brand-logo>', r.ok && r.format === 'svg' && r.kind === 'inline-svg', JSON.stringify(r));

// 4. сайт без логотипов → честный отказ
r = await getLogo(base + '/nologo', { out, source: 'site' });
ok('сайт без логотипа → ok:false и список попыток', !r.ok && r.tried.length > 0 && !!r.hint);

// 5. Wikimedia: выбирается Zzacme logo (не old и не чужой бренд), лицензия сохранена
process.env.LOGO_WIKI_API = base + '/api';
r = await getLogo('zzacme', { out, source: 'wikimedia' });
ok('wikimedia: выбран нужный файл', r.ok && r.source === 'wikimedia' && /Zzacme logo/.test(r.kind), JSON.stringify(r));
ok('wikimedia: лицензия и автор сохранены', /Public domain/.test(r.license) && /Acme Corp/.test(r.license), r.license);

// 6. favicon
process.env.LOGO_FAVICON_URL = base + '/fav?domain={domain}';
r = await getLogo('qqfav.com', { out, source: 'favicon' });
ok('favicon: найден, качество low', r.ok && r.quality === 'low' && r.format === 'png', JSON.stringify(r));

// 7. свой бренд-кит имеет приоритет
mkdirSync(join(out, '_custom'), { recursive: true });
writeFileSync(join(out, '_custom', 'mybrand.svg'), SVG);
r = await getLogo('MyBrand', { out });
ok('_custom: бренд-кит выигрывает без сети', r.ok && r.source === 'custom', JSON.stringify(r));

// 8. simple-icons + нечёткий поиск
r = await getLogo('Duolingo', { out });
ok('simple-icons: Duolingo с официальным цветом', r.ok && r.source === 'simple-icons' && r.hex === '58CC02', JSON.stringify(r));
r = await getLogo('telegramm', { out, refresh: true });
ok('simple-icons: опечатка «telegramm» → Telegram', r.ok && /Telegram/i.test(r.title), JSON.stringify(r));
r = await getLogo('zzzqqq-нет-такого', { out, source: 'simple-icons' });
ok('simple-icons: мусор не подбирается «похожим»', !r.ok);

// 9. slug для кириллицы не пустой и разный
ok('slug: кириллица различима', slugOf('Яндекс') !== '' && slugOf('Яндекс') !== slugOf('Сбер') && slugOf('Café') === 'cafe');

// 10. автоподстановка в HTML
const html = join(out, 'a.html');
writeFileSync(html, `<html><head><script src="../r/engine.js"></script><script src="../r/parts.js"></script></head><body><script>P.logo('Duolingo',10);P.logoTile("Telegram",12);P.logo('MyBrand',8)</script><div data-logo="Claude"></div></body></html>`);
ok('scanBrands: P.logo, P.logoTile, data-logo', JSON.stringify(scanBrands(readFileSync(html, 'utf8')).sort()) === JSON.stringify(['Claude', 'Duolingo', 'MyBrand', 'Telegram']));
const a = await autoLogos(html, { out, quiet: true });
const h2 = readFileSync(html, 'utf8');
ok('auto: все найдены, logos.js записан и подключён после parts.js', a.found.length === 4 && existsSync(join(out, 'logos.js')) && /parts\.js"><\/script><script src="logos\.js">/.test(h2), JSON.stringify(a));
const a2 = await autoLogos(html, { out, quiet: true });
ok('auto: повторный запуск не дублирует тег', (readFileSync(html, 'utf8').match(/logos\.js/g) || []).length === 1);

child.kill(); rmSync(out, { recursive: true, force: true });
console.log(fails ? `\n${fails} тест(ов) упало` : '\nвсе тесты прошли');
process.exit(fails ? 1 : 0);
