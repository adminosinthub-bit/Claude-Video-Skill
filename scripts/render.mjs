#!/usr/bin/env node
// Детерминированный рендер HTML-анимации в видео: покадровый скриншот (параллельно) + ffmpeg.
//
// node render.mjs <file.html> --out out.mp4 [--preset vertical|vertical-preview|vertical-4k|horizontal|horizontal-4k|square]
//        [--duration сек]            по умолчанию — длина ролика из движка сцен (window.__total)
//        [--fps 30] [--width 1080] [--height 1920] [--workers N]
//        [--scale 2]                  4K при той же вёрстке: пикселей на CSS-пиксель (то же делают пресеты *-4k)
//        [--ss 2]                     суперсэмплинг: снять в N раз крупнее и сжать lanczos — идеально гладкие края (дороже в N² раз)
//        [--from сек] [--to сек]      рендер только фрагмента (быстрая итерация)
//        [--motion-blur N] [--shutter 0.5]   размытие движения: N подкадров на кадр (как у камеры с затвором 180°)
//        [--max]                      максимальное качество: 60 fps, motion blur 3, crf 15, x264 slow/animation, 3D в ultra
//        [--ultra]                    3D в качестве ultra: тени 4096, AO, плотная геометрия (финал/4K); [--ao] [--no-ao]
//        [--audio music.mp3]          своя музыка (смешивается со звуками сцен)
//        [--no-sfx]                   не собирать звук из sfx/music сцен (scripts/sfx.py, нужен numpy)
//        [--draft3d]                  черновик 3D: быстрее, без сглаживания и AO (для превью)
//        [--png] [--keep-frames] [--no-logos]   (логотипы P.logo('Бренд') ищутся и подставляются автоматически)
import { spawn, spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startServer, commonRoot } from './serve.mjs';
import { setup3d, threeReady } from './setup-3d.mjs';
import { frameOpts } from './quality.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--') && /\.html?$/i.test(a));
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name) => args.includes(`--${name}`);
if (!input) {
  console.error('Использование: render.mjs <file.html> --out out.mp4 [--preset vertical] [--max] [--fps 30] [--motion-blur 3] [--from 0 --to 5] [--audio a.mp3]');
  process.exit(2);
}
const MAX = has('max');
const out = resolve(opt('out', input.replace(/\.html?$/i, '.mp4')));
const fps = parseInt(opt('fps', MAX ? '60' : '30'), 10);
// width×height — вёрстка (CSS-пиксели), outW×outH — итоговое видео; dsf — плотность пикселей при съёмке (scale × ss)
const { width, height, ss, dsf, outW, outH, e3d: E3D_OPTS } = frameOpts(opt, has);
const blurN = Math.max(1, parseInt(opt('motion-blur', MAX ? '3' : '1'), 10));
const shutter = Math.min(1, Math.max(0.05, parseFloat(opt('shutter', '0.5'))));
const IS3D = /engine3d|vendor\/node_modules\/three/.test(readFileSync(resolve(input), 'utf8'));
// 3D считается программным WebGL (SwiftShader), который сам занимает все ядра: параллельные страницы только мешают
const workers = Math.max(1, parseInt(opt('workers', IS3D ? 1 : Math.min(cpus().length, 6)), 10));
const userAudio = opt('audio', null);
const png = has('png');
const keep = has('keep-frames');
const crf = opt('crf', MAX ? '15' : '17');

// автоподстановка логотипов: если в HTML есть P.logo('Бренд') / data-logo, найти их и записать logos.js (--no-logos отключает)
if (!has('no-logos')) {
  const src = readFileSync(resolve(input), 'utf8');
  if (/P\.logo(?:Tile)?\(|logo(?:Tile)?3D\(|data-logo\s*=/.test(src)) {
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

// 3D: страница с engine3d/three — поставить Three.js при первом запуске
const html = readFileSync(resolve(input), 'utf8');
if (/engine3d|vendor\/node_modules\/three/.test(html) && !threeReady() && !setup3d()) { console.error('нет Three.js — 3D не отрендерится'); process.exit(1); }
// страница открывается через локальный http-сервер (ES-модули не работают по file://)
const server = await startServer(commonRoot([dirname(resolve(input)), join(HERE, '..')]));
const url = server.url(resolve(input));
const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}), args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
// дождаться движка (в т.ч. модулей 3D) и всех асинхронных загрузок (модели, шрифты)
const ready = async (page) => {
  await page.waitForFunction(() => typeof window.__setTime === 'function', null, { timeout: 300000 });
  await page.evaluate(() => Promise.all(window.__pending || []));
  await page.evaluate(() => document.fonts && document.fonts.ready);
};

// длина ролика и звуковые события — из самой страницы
const probe = await browser.newPage({ viewport: { width, height } });
await probe.addInitScript(() => { window.__E3D_OPTS = { quality: 'draft', ao: false }; }); // пробе нужны только длина и звук — 3D попроще
await probe.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
await ready(probe);
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
console.error(`рендер: ${outW}×${outH}${dsf !== 1 ? ` (вёрстка ${width}×${height}, снимок ×${dsf}${ss > 1 ? `, суперсэмплинг ${ss}× → lanczos` : ''})` : ''}${E3D_OPTS && E3D_OPTS.quality ? `, 3D: ${E3D_OPTS.quality}` : ''}, ${fps} fps${blurN > 1 ? `, motion blur ×${blurN}` : ''}, ${(total / fps).toFixed(1)} с → ${subTotal} снимков, ${workers} потока`);

let done = 0;
const tStart = Date.now();
async function worker(w) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
  page.on('pageerror', (e) => console.error('\nОшибка страницы:', e.message));
  if (E3D_OPTS) await page.addInitScript((o) => { window.__E3D_OPTS = o; }, E3D_OPTS);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await ready(page);
  for (let k = w; k < subTotal; k += workers) {
    const i = startF + Math.floor(k / blurN);
    const j = k % blurN;
    const t = ((i + (blurN > 1 ? (j / blurN) * shutter : 0)) * 1000) / fps;
    await page.evaluate((t) => {
      if (typeof window.__setTime === 'function') window.__setTime(t);
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = t; }
    }, t);
    await page.screenshot({ path: join(dir, `f${String(k).padStart(7, '0')}.${ext}`), timeout: 0, ...(png ? {} : { type: 'jpeg', quality: 95 }) }); // 4K/ultra-кадр 3D может считаться дольше 30 с
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
await server.close();

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

// звук: свести источники в один wav, затем двухпроходная нормализация громкости до −14 LUFS
let mixWav = null;
const srcs = [sfxWav ? ['-ss', String(t0), '-i', sfxWav] : null, userAudio ? ['-i', resolve(userAudio)] : null].filter(Boolean);
if (srcs.length) {
  mixWav = join(dir, 'mix.wav');
  const fade = `afade=t=out:st=${Math.max(0, dur - 0.8).toFixed(2)}:d=0.8`;
  const filt = srcs.length === 2 ? `[1:a]volume=0.55[m];[0:a][m]amix=inputs=2:normalize=0,${fade}` : fade;
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...srcs.flat(), '-t', dur.toFixed(3), srcs.length === 2 ? '-filter_complex' : '-af', filt, '-ar', '48000', '-ac', '2', mixWav]);
  if (r.status !== 0) { console.error('⚠ не удалось свести звук — видео будет без звука'); mixWav = null; }
}
let loud = 'loudnorm=I=-14:TP=-1.5:LRA=11';
if (mixWav) {
  const m = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', mixWav, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const js = (m.stderr || '').match(/\{[\s\S]*?\}/g)?.pop();
  try {
    const v = JSON.parse(js);
    loud = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`;
  } catch { /* остаётся однопроходная нормализация */ }
}

const ff = ['-v', 'error', '-y', '-framerate', String(fps * blurN), '-i', join(dir, `f%07d.${ext}`)];
if (mixWav) ff.push('-i', mixWav);
// суперсэмплинг: сначала сжать снимки до итогового размера (lanczos), потом смешивать подкадры — так дешевле
const vf = [ss > 1 ? `scale=${outW}:${outH}:flags=lanczos` : null, blurN > 1 ? `tmix=frames=${blurN},select='eq(mod(n\\,${blurN})\\,${blurN - 1})',setpts=N/(${fps}*TB)` : null].filter(Boolean);
if (vf.length) ff.push('-vf', vf.join(','));
if (mixWav) ff.push('-af', `${loud},aresample=48000`);
ff.push('-c:v', 'libx264', '-preset', MAX ? 'slow' : 'medium', ...(MAX ? ['-tune', 'animation'] : []), '-pix_fmt', 'yuv420p', '-crf', crf, '-r', String(fps), '-movflags', '+faststart');
if (mixWav) ff.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', dur.toFixed(3));
ff.push(out);
await new Promise((res, rej) => {
  const p = spawn('ffmpeg', ff, { stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg завершился с кодом ${c}`))));
});
if (keep) console.log(`кадры: ${dir}`); else rmSync(dir, { recursive: true, force: true });
console.log(out);
