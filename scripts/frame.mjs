#!/usr/bin/env node
// Быстрый просмотр: один или несколько кадров HTML без рендера видео.
// node frame.mjs <file.html> <t1,t2,...> <outdir|out.png> [--width 1080 --height 1920]
// Времена в секундах. Для нескольких кадров <out> — папка, файлы t<сек>.png
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : d; };
const [file, times, out] = a.filter((x, i) => !x.startsWith('--') && !String(a[i - 1]).startsWith('--'));
if (!file || !times || !out) { console.error('Использование: frame.mjs <file.html> <t1,t2,...> <outdir|out.png> [--width W --height H]'); process.exit(2); }
const width = +flag('width', 1080), height = +flag('height', 1920);
let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  ({ chromium } = createRequire(join(execSync('npm root -g').toString().trim(), 'x.js'))('playwright'));
}
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width, height } });
await page.goto(pathToFileURL(resolve(file)).href);
await page.evaluate(() => document.fonts && document.fonts.ready);
const list = times.split(',').map(Number);
if (list.length > 1) mkdirSync(out, { recursive: true });
for (const t of list) {
  await page.evaluate((ms) => {
    if (window.__setTime) window.__setTime(ms);
    for (const an of document.getAnimations()) { an.pause(); an.currentTime = ms; }
  }, t * 1000);
  const p = list.length > 1 ? join(out, `t${t}.png`) : out;
  await page.screenshot({ path: p });
  console.log(p);
}
await browser.close();
