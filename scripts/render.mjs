#!/usr/bin/env node
// Детерминированный рендер HTML-анимации в видео: покадровый скриншот + ffmpeg.
// node render.mjs <file.html> --out out.mp4 [--duration 8] [--fps 30] [--width 1920] [--height 1080] [--keep-frames]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--') && /\.html?$/i.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
if (!input) {
  console.error('Использование: render.mjs <file.html> --out out.mp4 [--duration 8] [--fps 30] [--width 1920] [--height 1080]');
  process.exit(2);
}
const out = resolve(opt('out', input.replace(/\.html?$/i, '.mp4')));
const duration = parseFloat(opt('duration', '8'));
const fps = parseInt(opt('fps', '30'), 10);
const width = parseInt(opt('width', '1920'), 10);
const height = parseInt(opt('height', '1080'), 10);
const keep = args.includes('--keep-frames');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  const { createRequire } = await import('node:module');
  const { execSync } = await import('node:child_process');
  const root = execSync('npm root -g').toString().trim();
  ({ chromium } = createRequire(join(root, 'x.js'))('playwright'));
}

const exe = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(input)).href);
await page.evaluate(() => document.fonts && document.fonts.ready);

const frames = Math.round(duration * fps);
const dir = mkdtempSync(join(tmpdir(), 'html-video-'));

const setTime = (t) => page.evaluate((t) => {
  if (typeof window.__setTime === 'function') window.__setTime(t);
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
}, t);

for (let i = 0; i < frames; i++) {
  await setTime((i * 1000) / fps);
  await page.screenshot({ path: join(dir, `f${String(i).padStart(6, '0')}.png`) });
  if (i % fps === 0) process.stderr.write(`\rкадр ${i}/${frames}`);
}
process.stderr.write(`\rкадр ${frames}/${frames}\n`);
await browser.close();

await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(dir, 'f%06d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', out], { stdio: 'inherit' });
  ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg завершился с кодом ${c}`))));
});
if (keep) console.log(`кадры: ${dir}`); else rmSync(dir, { recursive: true, force: true });
console.log(out);
