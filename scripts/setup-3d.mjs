#!/usr/bin/env node
// Установка Three.js, opentype.js и шрифта Inter для 3D-движка (references/engine3d.js) в vendor/ — один раз, через npm.
// node scripts/setup-3d.mjs        (render.mjs вызывает сам, если ролику нужен 3D)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const THREE_VERSION = '0.186.1';
const PKGS = [`three@${THREE_VERSION}`, 'opentype.js@1.3.4', '@fontsource/inter@5.3.0']; // 3D, контуры шрифтов, шрифт Inter (OFL)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
export const threeReady = () => ['three/build/three.module.js', 'opentype.js/dist/opentype.module.js', '@fontsource/inter/files/inter-cyrillic-900-normal.woff'].every((f) => existsSync(join(VENDOR, 'node_modules', f)));

export function setup3d({ quiet = false } = {}) {
  if (threeReady()) return true;
  mkdirSync(VENDOR, { recursive: true });
  if (!existsSync(join(VENDOR, 'package.json'))) writeFileSync(join(VENDOR, 'package.json'), '{"name":"skill-vendor","private":true}\n');
  if (!quiet) console.error(`ставлю ${PKGS.join(', ')} в vendor/ (npm)…`);
  const r = spawnSync('npm', ['install', ...PKGS, '--no-audit', '--no-fund', '--prefix', VENDOR], { encoding: 'utf8' });
  if (r.status !== 0) { console.error('не удалось поставить three:', (r.stderr || '').trim().split('\n').slice(-3).join(' ')); return false; }
  return threeReady();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(setup3d() ? 0 : 1);
