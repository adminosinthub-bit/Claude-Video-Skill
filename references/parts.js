/* Готовые детали для сцен: маскот-бот, иконки, окно macOS, пузыри чата. Все размеры — в vw.
 * Подключение после engine.js: <script src="../../references/parts.js"></script>
 *   P.bot(size, color)            SVG-маскот. Классы: .eye (глаза), .armL/.armR (руки), .ant (антенна)
 *   P.blink(t)                    масштаб глаз по Y для моргания (0.1..1)
 *   P.icon(name, color, size)     mail globe chart bulb code doc spark send check mic image search clock
 *   P.win(title, inner, cls)      окно macOS с кнопками; внутри — inner
 *   P.me(text) / P.ai(text)       пузыри чата (класс .b-me / .b-ai)
 *   P.owl(size,c,c2) + P.owlLook(root,dx,dy,blinkK)   сова-маскот (.wingL/.wingR — крылья для анимации)
 *   P.spark(size,c) + P.sparkAct(root,{spin,dx,dy,blink,mood})   маскот-искорка (Claude)
 *   P.logo(name,size,{color}) / P.logoTile(name,size,{bg,color})   логотип бренда (ищет scripts/logos.mjs сам; нет логотипа — текстовая плашка)
 *   P.flame(size)                 огонёк серии
 *   P.phone(w, inner, style)      макет телефона (внутри .scr); w в vw
 *   P.tapHTML() + P.touch(root,t,[[t,x,y],..],[времена нажатий])   касание пальцем с рябью
 *   P.confetti(n,seed) + P.cfUpdate(root,t,x0,y0)   детерминированное конфетти
 */
(function () {
  const paths = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3.5 3.5 3.5 14.5 0 18M12 3c-3.5 3.5-3.5 14.5 0 18"/>',
    chart: '<path d="M5 20V11M11 20V4M17 20v-7M3 20h18"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.9.7 1.1 1.5 1.1 2.2h5c0-.7.2-1.5 1.1-2.2A6 6 0 0 0 12 3z"/>',
    code: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
    spark: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
    send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  const icon = (name, color = '#000', size = 8) =>
    `<svg width="${size}vw" height="${size}vw" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;

  const bot = (size = 30, color = '#10a37f') => `
  <svg class="bot" width="${size}vw" height="${size}vw" viewBox="0 0 100 100" style="overflow:visible">
    <g class="ant"><line x1="50" y1="20" x2="50" y2="9" stroke="${color}" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="7" r="5" fill="#ffd166"/></g>
    <line class="armL" x1="30" y1="80" x2="14" y2="90" stroke="${color}" stroke-width="7" stroke-linecap="round" style="transform-origin:30px 80px"/>
    <line class="armR" x1="70" y1="80" x2="86" y2="90" stroke="${color}" stroke-width="7" stroke-linecap="round" style="transform-origin:70px 80px"/>
    <rect x="30" y="72" width="40" height="22" rx="11" fill="${color}"/>
    <rect x="16" y="20" width="68" height="56" rx="22" fill="${color}"/>
    <rect x="24" y="29" width="52" height="36" rx="15" fill="#0b2e27"/>
    <ellipse class="eye" cx="39" cy="45" rx="5" ry="7" fill="#9ff5dc" style="transform-box:fill-box;transform-origin:center"/>
    <ellipse class="eye" cx="61" cy="45" rx="5" ry="7" fill="#9ff5dc" style="transform-box:fill-box;transform-origin:center"/>
    <path class="mouth" d="M43 57q7 5 14 0" stroke="#9ff5dc" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`;
  const blink = (t) => { const k = t % 3.2; return k > 3.05 && k < 3.2 ? 0.1 : 1; };

  const win = (title = '', inner = '', cls = '') => `
  <div class="mwin ${cls}"><div class="mbar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${title}</span></div><div class="mbody">${inner}</div></div>`;
  const me = (t) => `<div class="b-me">${t}</div>`;
  const ai = (t) => `<div class="b-ai">${t}</div>`;


  // ---------- сова-маскот (оригинальный рисунок) ----------
  const owl = (size = 30, c = '#8b5cf6', c2 = '#c9b8ff') => `
  <svg class="owl" width="${size}vw" height="${size}vw" viewBox="0 0 100 100" style="overflow:visible">
    <g class="wingL" style="transform-origin:22px 58px"><ellipse cx="13" cy="64" rx="9" ry="17" fill="${c}" transform="rotate(12 13 64)"/></g>
    <g class="wingR" style="transform-origin:78px 58px"><ellipse cx="87" cy="64" rx="9" ry="17" fill="${c}" transform="rotate(-12 87 64)"/></g>
    <path d="M17 36 L23 6 L43 24 Z" fill="${c}"/><path d="M83 36 L77 6 L57 24 Z" fill="${c}"/>
    <ellipse cx="50" cy="56" rx="36" ry="38" fill="${c}"/>
    <ellipse cx="50" cy="73" rx="23" ry="20" fill="${c2}"/>
    <g class="eyes" style="transform-box:fill-box;transform-origin:center">
      <circle cx="35" cy="44" r="14" fill="#fff"/><circle cx="65" cy="44" r="14" fill="#fff"/>
      <circle class="pupil" cx="37" cy="46" r="6" fill="#1b2a1b"/><circle class="pupil" cx="63" cy="46" r="6" fill="#1b2a1b"/>
    </g>
    <path d="M43 54 Q50 51 57 54 L50 67 Z" fill="#ffb020"/>
    <ellipse cx="40" cy="97" rx="9" ry="4" fill="#ffb020"/><ellipse cx="60" cy="97" rx="9" ry="4" fill="#ffb020"/>
  </svg>`;
  // owlLook: куда смотрит сова (dx,dy в единицах viewBox, ±3), blink — масштаб глаз
  const owlLook = (root, dx = 0, dy = 0, blinkK = 1) => {
    root.querySelectorAll('.pupil').forEach((p) => (p.style.transform = `translate(${dx}px,${dy}px)`));
    root.querySelectorAll('.eyes').forEach((e) => (e.style.transform = `scaleY(${blinkK})`));
  };

  // ---------- огонёк серии ----------
  const flame = (size = 10, c1 = '#ff9600', c2 = '#ffd23f') => `
  <svg class="flame" width="${size}vw" height="${size * 1.25}vw" viewBox="0 0 24 30" style="overflow:visible">
    <path d="M12 1c1.2 6 8.5 9 8.5 17.5a8.5 8.5 0 0 1-17 0C3.5 14 6 11.5 7 9c.4 2.6 1.6 4 3 4.2C9.6 8.5 10.6 4.4 12 1z" fill="${c1}"/>
    <path d="M12 14c.6 3 4 4.6 4 8.2a4 4 0 0 1-8 0c0-1.8 1-2.8 2-3.8.2 1.2.8 1.8 1.4 2 -.2-2.4.2-4.2.6-6.4z" fill="${c2}"/>
  </svg>`;

  // ---------- телефон ----------
  const phone = (w, inner, style = '') => `
  <div class="phone" style="width:${w}vw;height:${w * 2.05}vw;border-radius:${w * 0.17}vw;border:${w * 0.03}vw solid #17171c;${style}">
    <div style="position:absolute;z-index:5;left:50%;top:${w * 0.03}vw;width:${w * 0.27}vw;height:${w * 0.055}vw;margin-left:${-w * 0.135}vw;border-radius:${w}vw;background:#17171c"></div>
    <div class="scr">${inner}</div></div>`;

  // ---------- касание пальцем ----------
  const tapHTML = () => '<div class="tr"></div><div class="tp"></div>';
  // touch(root, t, kf, taps): kf=[[t,x,y],...] траектория касания (vw внутри root), taps=[времена нажатий]
  const touch = (root, t, kf, taps = []) => {
    const tp = root.querySelector('.tp'), tr = root.querySelector('.tr');
    const at = (tt) => {
      if (tt <= kf[0][0]) return [kf[0][1], kf[0][2]];
      for (let i = 1; i < kf.length; i++) if (tt <= kf[i][0]) {
        const k = smoothK((tt - kf[i - 1][0]) / (kf[i][0] - kf[i - 1][0]));
        return [kf[i - 1][1] + (kf[i][1] - kf[i - 1][1]) * k, kf[i - 1][2] + (kf[i][2] - kf[i - 1][2]) * k];
      }
      const l = kf[kf.length - 1]; return [l[1], l[2]];
    };
    const smoothK = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const [x, y] = at(t);
    const last = taps.filter((a) => a <= t).pop();
    const dt = last === undefined ? 9 : t - last;
    const press = dt < 0.14 ? 0.8 : 1;
    const vis = t >= kf[0][0] - 0.2 && t <= kf[kf.length - 1][0] + 0.6 ? 1 : 0;
    tp.style.opacity = vis;
    tp.style.transform = `translate(${x}vw,${y}vw) scale(${press})`;
    if (last !== undefined && dt < 0.55) {
      const [rx, ry] = at(last); const k = dt / 0.55;
      tr.style.opacity = (1 - k) * 0.9; tr.style.transform = `translate(${rx}vw,${ry}vw) scale(${0.4 + 1.8 * k})`;
    } else tr.style.opacity = 0;
  };

  // ---------- конфетти (детерминированное) ----------
  const confetti = (n = 60, seed = 7, colors = ['#ff9600', '#58cc02', '#1cb0f6', '#ffd23f', '#ff4b4b', '#ce82ff']) => {
    let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: n }, (_, i) =>
      `<i class="cf" data-vx="${((r() - 0.5) * 80).toFixed(1)}" data-vy="${(-(30 + r() * 60)).toFixed(1)}" data-rot="${((r() - 0.5) * 1000).toFixed(0)}" style="width:${(1.2 + r() * 1.6).toFixed(1)}vw;height:${(2 + r() * 2.2).toFixed(1)}vw;background:${colors[i % colors.length]}"></i>`).join('');
  };
  const cfUpdate = (root, t, x0 = 50, y0 = 70, g = 85) => {
    root.querySelectorAll('.cf').forEach((e) => {
      if (t < 0) { e.style.opacity = 0; return; }
      const vx = +e.dataset.vx, vy = +e.dataset.vy, rot = +e.dataset.rot;
      e.style.opacity = Math.max(0, Math.min(1, 1 - (t - 1.6) / 1.2));
      e.style.transform = `translate(${x0 + vx * t}vw,${y0 + vy * t + 0.5 * g * t * t}vw) rotate(${rot * t}deg)`;
    });
  };


  // ---------- искорка: оригинальный маскот-«звёздочка» (.petals вращать, .eyes моргать) ----------
  const spark = (size = 30, c = '#d97757', face = '#2b1a12') => `
  <svg class="spark" width="${size}vw" height="${size}vw" viewBox="0 0 100 100" style="overflow:visible">
    <g class="petals" style="transform-origin:50px 50px">${[0, 45, 90, 135].map((a) => `<rect x="44" y="3" width="12" height="94" rx="6" fill="${c}" transform="rotate(${a} 50 50)"/>`).join('')}</g>
    <circle cx="50" cy="50" r="28" fill="${c}"/>
    <g class="eyes" style="transform-box:fill-box;transform-origin:center"><ellipse class="pupil" cx="41" cy="47" rx="4" ry="6" fill="${face}"/><ellipse class="pupil" cx="59" cy="47" rx="4" ry="6" fill="${face}"/></g>
    <path class="mouth" d="M42 59 Q50 66 58 59" stroke="${face}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  </svg>`;
  // sparkAct(root, {spin, dx, dy, blink, mood}) mood: 'smile' | 'o' | 'flat'
  const sparkAct = (root, o = {}) => {
    const pt = root.querySelector('.petals'); if (pt && o.spin !== undefined) pt.style.transform = `rotate(${o.spin}deg)`;
    root.querySelectorAll('.pupil').forEach((e) => (e.style.transform = `translate(${o.dx || 0}px,${o.dy || 0}px)`));
    root.querySelectorAll('.eyes').forEach((e) => (e.style.transform = `scaleY(${o.blink === undefined ? 1 : o.blink})`));
    const m = root.querySelector('.mouth');
    if (m && o.mood) m.setAttribute('d', o.mood === 'o' ? 'M45 60 Q50 67 55 60 Q50 55 45 60Z' : o.mood === 'flat' ? 'M43 61 L57 61' : 'M42 59 Q50 66 58 59');
  };


  // ---------- логотипы брендов (данные кладёт scripts/logos.mjs в logos.js → window.LOGOS) ----------
  const slugOf = (s) => (/[\u0400-\u04FF]/.test(s) ? String(s).toLowerCase() : String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')).replace(/&/g, 'and').replace(/\+/g, 'plus').replace(/[^\p{L}\p{N}]/gu, '');
  // logo(name, size, {color}) — color: 'brand' (официальный цвет), '#fff', 'currentColor'… (перекраска только у однотонных SVG)
  const logo = (name, size = 10, o = {}) => {
    const L = (window.LOGOS || {})[slugOf(name)];
    if (!L) return `<span class="logo-fb" style="font-size:${size * 0.42}vw;height:${size}vw;padding:0 ${size * 0.35}vw;border-radius:${size * 0.3}vw">${name}</span>`;
    if (L.svg) {
      const fill = !o.color || o.color === 'brand' ? '#' + L.hex : o.color;
      return L.svg.replace(/<svg\b/, `<svg width="${size}vw" height="${size}vw" fill="${fill}" style="display:block"`);
    }
    return `<img src="${L.src}" alt="${name}" style="display:block;height:${size}vw;width:auto;max-width:${size * 3}vw;object-fit:contain">`;
  };
  // logoTile(name, size, {bg, color, radius}) — плитка с логотипом: по умолчанию цвет бренда + белый знак (у растровых — белая плитка)
  const logoTile = (name, size = 16, o = {}) => {
    const L = (window.LOGOS || {})[slugOf(name)];
    const mono = L && L.svg;
    const bg = o.bg || (mono ? '#' + L.hex : '#fff');
    const color = o.color || (mono ? '#fff' : undefined);
    return `<div class="logo-tile" style="width:${size}vw;height:${size}vw;border-radius:${o.radius === undefined ? size * 0.24 : o.radius}vw;background:${bg}">${logo(name, size * 0.56, { color })}</div>`;
  };
  const hasLogo = (name) => !!(window.LOGOS || {})[slugOf(name)];

  const style = document.createElement('style');
  style.textContent = `
  .mwin{position:absolute;background:var(--win,#fff);color:var(--winInk,#1d1b19);border-radius:3.2vw;overflow:hidden;box-shadow:0 4vw 10vw rgba(20,20,40,.28),0 0 0 .2vw rgba(0,0,0,.08);display:flex;flex-direction:column}
  .mbar{height:7vw;background:var(--winBar,#f1efec);display:flex;align-items:center;gap:1.4vw;padding:0 2.6vw;flex:none;position:relative}
  .mbar i{width:2.2vw;height:2.2vw;border-radius:50%;display:block}
  .mbar span{position:absolute;left:0;right:0;text-align:center;font-size:2.5vw;color:#8a837b;font-weight:500}
  .mbody{flex:1;position:relative;overflow:hidden}
  .b-me{background:var(--accent,#10a37f);color:#fff;font-size:4vw;line-height:1.3;padding:2.4vw 3.6vw;border-radius:4vw 4vw 1vw 4vw}
  .b-ai{font-size:3.8vw;line-height:1.4}
  .phone{position:absolute;background:#fff;overflow:hidden;box-shadow:0 4vw 10vw rgba(0,0,0,.3)}
  .scr{position:absolute;inset:0;overflow:hidden}
  .tp,.tr{position:absolute;left:0;top:0;width:9vw;height:9vw;margin:-4.5vw 0 0 -4.5vw;border-radius:50%;z-index:60;pointer-events:none}
  .tp{background:rgba(40,40,60,.35);border:.5vw solid rgba(255,255,255,.95);box-shadow:0 1vw 3vw rgba(0,0,0,.3);opacity:0}
  .tr{border:.6vw solid rgba(255,255,255,.9);opacity:0}
  .cf{position:absolute;left:0;top:0;display:block;border-radius:.3vw;opacity:0;z-index:70}
  .logo-fb{display:inline-flex;align-items:center;background:#1d1b19;color:#fff;font-weight:800;letter-spacing:-.01em;white-space:nowrap}
  .logo-tile{display:grid;place-items:center;box-shadow:0 1vw 0 rgba(0,0,0,.15)}
  .mono{font:3.3vw/1.5 ui-monospace,Menlo,"DejaVu Sans Mono",monospace}
  `;
  document.head.appendChild(style);
  window.P = { bot, blink, icon, win, me, ai, paths, owl, owlLook, spark, sparkAct, logo, logoTile, hasLogo, flame, phone, tapHTML, touch, confetti, cfUpdate };
})();
