#!/usr/bin/env node
// Детерминированный рендер HTML-анимации в видео: покадровый скриншот (параллельно) + ffmpeg.
//
// node render.mjs <file.html> --out out.mp4 [--preset vertical|vertical-preview|horizontal|square]
//        [--duration сек]            по умолчанию — длина ролика из движка сцен (window.__total)
//        [--fps 30] [--width 1080] [--height 1920] [--workers N]
//        [--from сек] [--to сек]      рендер только фрагмента (быстрая итерация)
//        [--motion-blur N] [--shutter 0.5]   размытие движения: N подкадров на кадр (как у камеры с затвором 180°)
//        [--max]                      максимальное качество: 60 fps, motion blur 3, crf 15, x264 slow/animation
//        [--audio music.mp3]          своя музыка (смешивается со звуками сцен)
//        [--no-sfx]                   не собирать звук из sfx/music сцен (scripts/sfx.py, нужен numpy)
//        [--png] [--keep-frames] [--no-logos]   (логотипы P.logo('Бренд') ищутся и подставляются автоматически)
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--') && /\.html?$/i.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
const PRESETS = {
  vertical: [1080, 1920],
  'vertical-preview': [540, 960],
  horizontal: [1920, 1080],
  'horizontal-preview': [960, 540],
  square: [1080, 1080],
};
if (!input) {
  console.error('Использование: render.mjs <file.html> --out out.mp4 [--preset vertical] [--max] [--fps 30] [--motion-blur 3] [--from 0 --to 5] [--audio a.mp3]');
  process.exit(2);
}
const MAX = has('max');
const preset = PRESETS[opt('preset', '')] || [1920, 1080];
const out = resolve(opt('out', input.replace(/\.html?$/i, '.mp4')));
const fps = parseInt(opt('fps', MAX ? '60' : '30'), 10);
const width = parseInt(opt('width', preset[0]), 10);
const height = parseInt(opt('height', preset[1]), 10);
const blurN = Math.max(1, parseInt(opt('motion-blur', MAX ? '3' : '1'), 10));
const shutter = Math.min(1, Math.max(0.05, parseFloat(opt('shutter', '0.5'))));
const workers = Math.max(1, parseInt(opt('workers', Math.min(cpus().length, 6)), 10));
const userAudio = opt('audio', null);
const png = has('png');
const keep = has('keep-frames');
const crf = opt('crf', MAX ? '15' : '17');

// автоподстановка логотипов: если в HTML есть P.logo('Бренд') / data-logo, найти их и записать logos.js (--no-logos отключает)
if (!has('no-logos')) {
  const src = readFileSync(resolve(input), 'utf8');
  if (/P\.logo(?:Tile)?\(|data-logo\s*=/.test(src)) {
    const r = spawnSync(process.execPath, [join(HERE, 'logos.mjs'), 'auto', resolve(input)], { stdio: ['ignore', 'inherit', 'inherit'] });
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

const url = pathToFileURL(resolve(input)).href;
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});

// длина ролика и звуковые события — из самой страницы
const probe = await browser.newPage({ viewport: { width, height } });
await probe.goto(url);
const info = await probe.evaluate(() => ({ total: window.__total || null, audio: window.__AUDIO || null }));
await probe.close();
const t0 = parseFloat(opt('from', '0'));
const t1 = parseFloat(opt('to', opt('duration', info.total ? String(info.total) : '8')));

const startF = Math.round(t0 * fps);
const endF = Math.round(t1 * fps);
const total = endF - startF; // кадров на выходе
const subTotal = total * blurN; // снимков с учётом подкадров
const dir = mkdtempSync(join(tmpdir(), 'html-video-'));
const ext = png ? 'png' : 'jpg';
console.error(`рендер: ${width}×${height}, ${fps} fps${blurN > 1 ? `, motion blur ×${blurN}` : ''}, ${(total / fps).toFixed(1)} с → ${subTotal} снимков, ${workers} потока`);

let done = 0;
const tStart = Date.now();
async function worker(w) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('\nОшибка страницы:', e.message));
  await page.goto(url);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  for (let k = w; k < subTotal; k += workers) {
    const i = startF + Math.floor(k / blurN);
    const j = k % blurN;
    const t = ((i + (blurN > 1 ? (j / blurN) * shutter : 0)) * 1000) / fps;
    await page.evaluate((t) => {
      if (typeof window.__setTime === 'function') window.__setTime(t);
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
    }, t);
    await page.screenshot({ path: join(dir, `f${String(k).padStart(7, '0')}.${ext}`), ...(png ? {} : { type: 'jpeg', quality: 95 }) });
    if (++done % 30 === 0) {
      const eta = Math.round(((Date.now() - tStart) / done) * (subTotal - done) / 1000);
      process.stderr.write(`\rснимок ${done}/${subTotal}  (~${eta} с осталось)   `);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
process.stderr.write(`\rснимок ${subTotal}/${subTotal} за ${Math.round((Date.now() - tStart) / 1000)} с                 \n`);
await browser.close();

// звук из сцен (sfx/music) → wav через scripts/sfx.py
const dur = total / fps;
let sfxWav = null;
if (info.audio && !has('no-sfx')) {
  const spec = join(dir, 'audio.json');
  writeFileSync(spec, JSON.stringify(info.audio));
  sfxWav = join(dir, 'sfx.wav');
  const py = ['python3', 'python'].find((p) => spawnSync(p, ['-c', 'import numpy'], { stdio: 'ignore' }).status === 0);
  if (!py) { console.error('⚠ звук не собран: нужен python3 с numpy (pip install numpy) — видео будет без звука'); sfxWav = null; }
  else {
    const r = spawnSync(py, [join(HERE, 'sfx.py'), spec, sfxWav], { encoding: 'utf8' });
    if (r.status !== 0) { console.error('⚠ звук не собран:', (r.stderr || '').trim().split('\n').slice(-2).join(' ')); sfxWav = null; }
    else console.error('звук: ' + r.stdout.trim());
  }
}

const ff = ['-v', 'error', '-y', '-framerate', String(fps * blurN), '-i', join(dir, `f%07d.${ext}`)];
const audioIns = [];
if (sfxWav) { ff.push('-ss', String(t0), '-i', sfxWav); audioIns.push(audioIns.length + 1); }
if (userAudio) { ff.push('-i', resolve(userAudio)); audioIns.push(audioIns.length + 1); }
const vf = blurN > 1 ? `tmix=frames=${blurN},select='eq(mod(n\\,${blurN})\\,${blurN - 1})',setpts=N/(${fps}*TB)` : null;
const fade = `afade=t=out:st=${Math.max(0, dur - 0.8).toFixed(2)}:d=0.8`;
const loud = 'loudnorm=I=-14:TP=-1.5:LRA=11';
if (audioIns.length === 2) {
  ff.push('-filter_complex', `${vf ? `[0:v]${vf}[v];` : ''}[2:a]volume=0.55[m];[1:a][m]amix=inputs=2:normalize=0,${loud},${fade}[a]`, '-map', vf ? '[v]' : '0:v', '-map', '[a]');
} else {
  if (vf) ff.push('-vf', vf);
  if (audioIns.length === 1) ff.push('-af', `${loud},${fade}`);
}
ff.push('-c:v', 'libx264', '-preset', MAX ? 'slow' : 'medium', ...(MAX ? ['-tune', 'animation'] : []), '-pix_fmt', 'yuv420p', '-crf', crf, '-r', String(fps), '-movflags', '+faststart');
if (audioIns.length) ff.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', dur.toFixed(3));
ff.push(out);
await new Promise((res, rej) => {
  const p = spawn('ffmpeg', ff, { stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg завершился с кодом ${c}`))));
});
if (keep) console.log(`кадры: ${dir}`); else rmSync(dir, { recursive: true, force: true });
console.log(out);
