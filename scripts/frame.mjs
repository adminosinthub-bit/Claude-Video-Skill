#!/usr/bin/env node
// Быстрый просмотр: один или несколько кадров HTML без рендера видео.
// node frame.mjs <file.html> <t1,t2,...> <outdir|out.png> [--width 1080 --height 1920] [--preset vertical-4k] [--scale 2] [--ss 2]
//                [--ultra | --draft3d] [--ao | --no-ao]       (флаги размера и качества — как у render.mjs, см. scripts/quality.mjs)
// Времена в секундах. Для нескольких кадров <out> — папка, файлы t<сек>.png. Печатает время каждого кадра.
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startServer, commonRoot } from './serve.mjs';
import { setup3d, threeReady } from './setup-3d.mjs';
import { frameOpts } from './quality.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const a = process.argv.slice(2);
const VALUED = ['width', 'height', 'preset', 'scale', 'ss'];
const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const has = (n) => a.includes(`--${n}`);
const [file, times, out] = a.filter((x, i) => !x.startsWith('--') && !(String(a[i - 1]).startsWith('--') && VALUED.includes(String(a[i - 1]).slice(2))));
if (!file || !times || !out) { console.error('Использование: frame.mjs <file.html> <t1,t2,...> <outdir|out.png> [--width W --height H] [--preset vertical-4k] [--scale 2] [--ss 2] [--ultra|--draft3d] [--ao|--no-ao]'); process.exit(2); }
const { width, height, ss, dsf, outW, outH, e3d } = frameOpts(flag, has, 'vertical');
const src = readFileSync(resolve(file), 'utf8');
if (/engine3d|vendor\/node_modules\/three/.test(src) && !threeReady()) setup3d();
// логотипы P.logo('Бренд') — найти и подключить, как это делает render.mjs
if (/P\.logo(?:Tile)?\(|logo(?:Tile)?3D\(|data-logo\s*=/.test(src)) spawnSync(process.execPath, [join(HERE, 'logos.mjs'), 'auto', resolve(file), '--quiet'], { stdio: ['ignore', 'ignore', 'inherit'] });
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  ({ chromium } = createRequire(join(execSync('npm root -g').toString().trim(), 'x.js'))('playwright'));
}
const server = await startServer(commonRoot([dirname(resolve(file)), join(HERE, '..')]));
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}), args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
page.on('pageerror', (e) => console.error('Ошибка страницы:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text()); });
if (e3d) await page.addInitScript((o) => { window.__E3D_OPTS = o; }, e3d);
await page.goto(server.url(resolve(file)), { waitUntil: 'domcontentloaded', timeout: 300000 });
await page.waitForFunction(() => typeof window.__setTime === 'function', null, { timeout: 300000 });
await page.evaluate(() => Promise.all(window.__pending || []));
await page.evaluate(() => document.fonts && document.fonts.ready);
const list = times.split(',').map(Number);
if (list.length > 1) mkdirSync(out, { recursive: true });
for (const t of list) {
  const t0 = Date.now();
  await page.evaluate((ms) => {
    if (window.__setTime) window.__setTime(ms);
    for (const an of document.getAnimations()) { an.pause(); an.currentTime = ms; }
  }, t * 1000);
  const p = list.length > 1 ? join(out, `t${t}.png`) : out;
  await page.screenshot({ path: p, timeout: 0 }); // 4K/ultra-кадр 3D может считаться дольше 30 с
  // суперсэмплинг: сжать снимок до итогового размера тем же lanczos, что и render.mjs
  if (ss > 1) { spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', p, '-vf', `scale=${outW}:${outH}:flags=lanczos`, p + '.ss.png'], { stdio: 'inherit' }); renameSync(p + '.ss.png', p); }
  console.log(`${p}  (${outW}×${outH}, ${((Date.now() - t0) / 1000).toFixed(1)} с)`);
}
await browser.close();
await server.close();
