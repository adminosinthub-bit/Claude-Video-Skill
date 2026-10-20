#!/usr/bin/env node
// Детерминированный рендер HTML-анимации в видео: покадровый скриншот (параллельно) + ffmpeg.
//
// node render.mjs <file.html> --out out.mp4 [--preset vertical|vertical-preview|horizontal|square]
//        [--duration 8] [--fps 30] [--width 1080] [--height 1920] [--workers N]
//        [--from сек] [--to сек]      рендер только фрагмента (быстрая итерация)
//        [--audio music.mp3]          подмешать звук (обрезается по длине видео, затухание 1 с)
//        [--png] [--keep-frames] [--no-logos]   (логотипы P.logo('Бренд') ищутся и подставляются автоматически)
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--') && /\.html?$/i.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const PRESETS = {
  vertical: [1080, 1920],
  'vertical-preview': [540, 960],
  horizontal: [1920, 1080],
  'horizontal-preview': [960, 540],
  square: [1080, 1080],
};
if (!input) {
  console.error('Использование: render.mjs <file.html> --out out.mp4 [--preset vertical] [--duration 8] [--fps 30] [--workers 4] [--from 0 --to 5] [--audio a.mp3]');
  process.exit(2);
}
const preset = PRESETS[opt('preset', '')] || [1920, 1080];
const out = resolve(opt('out', input.replace(/\.html?$/i, '.mp4')));
const fps = parseInt(opt('fps', '30'), 10);
const width = parseInt(opt('width', preset[0]), 10);
const height = parseInt(opt('height', preset[1]), 10);
const t0 = parseFloat(opt('from', '0'));
const t1 = parseFloat(opt('to', opt('duration', '8')));
const workers = Math.max(1, parseInt(opt('workers', Math.min(cpus().length, 6)), 10));
const audio = opt('audio', null);
const png = args.includes('--png');
const keep = args.includes('--keep-frames');

// автоподстановка логотипов: если в HTML есть P.logo('Бренд') / data-logo, найти их и записать logos.js (--no-logos отключает)
if (!args.includes('--no-logos')) {
  const src = readFileSync(resolve(input), 'utf8');
  if (/P\.logo(?:Tile)?\(|data-logo\s*=/.test(src)) {
    const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'logos.mjs'), 'auto', resolve(input)], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status === 2) console.error('⚠ часть логотипов не найдена — вместо них будут текстовые плашки (см. выше)');
  }
}

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const root = execSync('npm root -g').toString().trim();
  ({ chromium } = createRequire(join(root, 'x.js'))('playwright'));
}

const startF = Math.round(t0 * fps);
const endF = Math.round(t1 * fps);
const total = endF - startF;
const dir = mkdtempSync(join(tmpdir(), 'html-video-'));
const ext = png ? 'png' : 'jpg';
const url = pathToFileURL(resolve(input)).href;

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
let done = 0;
const t_start = Date.now();

async function worker(w) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('\nОшибка страницы:', e.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  for (let k = w; k < total; k += workers) {
    const i = startF + k;
    const t = (i * 1000) / fps;
    await page.evaluate((t) => {
      if (typeof window.__setTime === 'function') window.__setTime(t);
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
    }, t);
    await page.screenshot({
      path: join(dir, `f${String(k).padStart(6, '0')}.${ext}`),
      ...(png ? {} : { type: 'jpeg', quality: 95 }),
    });
    if (++done % 15 === 0) {
      const eta = Math.round(((Date.now() - t_start) / done) * (total - done) / 1000);
      process.stderr.write(`\rкадр ${done}/${total}  (~${eta} с осталось)   `);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
process.stderr.write(`\rкадр ${total}/${total}                          \n`);
await browser.close();

const dur = total / fps;
const ffArgs = ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, `f%06d.${ext}`)];
if (audio) ffArgs.push('-i', resolve(audio));
ffArgs.push('-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-crf', '17', '-movflags', '+faststart');
if (audio) ffArgs.push('-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=out:st=${Math.max(0, dur - 1)}:d=1`, '-t', String(dur));
ffArgs.push(out);
await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ffArgs, { stdio: 'inherit' });
  ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg завершился с кодом ${c}`))));
});
if (keep) console.log(`кадры: ${dir}`); else rmSync(dir, { recursive: true, force: true });
console.log(out);
