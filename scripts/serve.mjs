// Мини-сервер статики для рендера: ES-модули (3D-движок, Three.js) не грузятся по file://.
// Слушает только 127.0.0.1, отдаёт файлы из root, живёт ровно столько, сколько рендер.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, sep, extname, relative } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream', '.ktx2': 'application/octet-stream', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

// общий предок нескольких путей — корень сервера (страница + references/ + vendor/ должны быть внутри)
export function commonRoot(paths) {
  const parts = paths.map((p) => resolve(p).split(sep));
  const out = [];
  for (let i = 0; ; i++) { const s = parts[0][i]; if (s === undefined || !parts.every((p) => p[i] === s)) break; out.push(s); }
  return out.join(sep) || sep;
}

export async function startServer(root) {
  root = resolve(root);
  const server = http.createServer((req, res) => {
    const p = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (p !== root && !p.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    let st; try { st = statSync(p); } catch { res.writeHead(404); return res.end('not found'); }
    if (!st.isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(p).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    createReadStream(p).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { url: (file) => base + '/' + relative(root, resolve(file)).split(sep).map(encodeURIComponent).join('/'), close: () => new Promise((r) => server.close(r)) };
}
