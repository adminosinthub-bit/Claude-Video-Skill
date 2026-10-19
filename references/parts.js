/* Готовые детали для сцен: маскот-бот, иконки, окно macOS, пузыри чата. Все размеры — в vw.
 * Подключение после engine.js: <script src="../../references/parts.js"></script>
 *   P.bot(size, color)            SVG-маскот. Классы: .eye (глаза), .armL/.armR (руки), .ant (антенна)
 *   P.blink(t)                    масштаб глаз по Y для моргания (0.1..1)
 *   P.icon(name, color, size)     mail globe chart bulb code doc spark send check mic image search clock
 *   P.win(title, inner, cls)      окно macOS с кнопками; внутри — inner
 *   P.me(text) / P.ai(text)       пузыри чата (класс .b-me / .b-ai)
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

  const style = document.createElement('style');
  style.textContent = `
  .mwin{position:absolute;background:var(--win,#fff);color:var(--winInk,#1d1b19);border-radius:3.2vw;overflow:hidden;box-shadow:0 4vw 10vw rgba(20,20,40,.28),0 0 0 .2vw rgba(0,0,0,.08);display:flex;flex-direction:column}
  .mbar{height:7vw;background:var(--winBar,#f1efec);display:flex;align-items:center;gap:1.4vw;padding:0 2.6vw;flex:none;position:relative}
  .mbar i{width:2.2vw;height:2.2vw;border-radius:50%;display:block}
  .mbar span{position:absolute;left:0;right:0;text-align:center;font-size:2.5vw;color:#8a837b;font-weight:500}
  .mbody{flex:1;position:relative;overflow:hidden}
  .b-me{background:var(--accent,#10a37f);color:#fff;font-size:4vw;line-height:1.3;padding:2.4vw 3.6vw;border-radius:4vw 4vw 1vw 4vw}
  .b-ai{font-size:3.8vw;line-height:1.4}
  .mono{font:3.3vw/1.5 ui-monospace,Menlo,"DejaVu Sans Mono",monospace}
  `;
  document.head.appendChild(style);
  window.P = { bot, blink, icon, win, me, ai, paths };
})();
