/* Сцены рекламы вымышленного cold brew «Зарница». Тема T задаёт цвета, каждая сцена — демонстрация. */
(function () {
  const { seg, eo, pop, set, spring, lerp, cl, type, count } = E;
  const B = {};
  B.themes = {
    dark: { bg: '#1c120c', ink: '#f3e4d0', card: '#2a1b12', accent: '#ff7a2f', hl: '#ff7a2f', hlInk: '#1c120c', soft: '#3a2618', shadow: '#0d0805' },
    cream: { bg: '#fff7ec', ink: '#2b1a12', card: '#fff', accent: '#d9660f', hl: '#2b1a12', hlInk: '#fff7ec', soft: '#f3e4d0', shadow: '#e2cdb2' },
    sun: { bg: '#ffb347', ink: '#2b1a12', card: '#fff7ec', accent: '#2b1a12', hl: '#2b1a12', hlInk: '#ffb347', soft: '#ffd08a', shadow: '#cf8a1c' },
  };
  const st = document.createElement('style');
  st.textContent = `
  .kick{position:absolute;left:0;right:0;top:9vw;text-align:center;font-size:3.8vw;font-weight:800;letter-spacing:.22em;text-transform:uppercase;opacity:.6}
  .can{position:absolute}.can .bd{position:absolute;left:0;right:0;border-radius:11%/6%;background:linear-gradient(90deg,#120a06,#3d2517 30%,#2b1a12 58%,#100805)}
  .can .lb{position:absolute;left:0;right:0;background:#f3e4d0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:900;color:#2b1a12;letter-spacing:-.02em}
  .can .lid{position:absolute;left:1%;right:1%;border-radius:50%;background:linear-gradient(90deg,#8d8d8d,#e8e8e8 40%,#b9b9b9 70%,#7b7b7b);box-shadow:0 .4vw 0 #5a5a5a}
  .can .shine{position:absolute;top:0;bottom:0;width:10%;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.22),rgba(255,255,255,0))}
  .glass{position:absolute;overflow:hidden;clip-path:polygon(5% 0,95% 0,82% 100%,18% 100%);background:linear-gradient(90deg,rgba(255,255,255,.16),rgba(255,255,255,.05) 50%,rgba(255,255,255,.14))}
  .glass .lq{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(#7a4a26,#4a2813 40%,#2e1709)}
  .glass .cb{position:absolute;width:20%;height:18%;border-radius:12%;background:rgba(235,248,255,.5);border:.3vw solid rgba(255,255,255,.7)}
  .row{position:absolute;left:10vw;right:10vw}
  `;
  document.head.appendChild(st);
  const kick = (T, t) => `<div class="kick" style="color:${T.ink}">${t}</div>`;
  const base = (T, o, d) => ({ dur: o.dur || d, bg: o.bg || T.bg, ink: o.ink || T.ink, hl: T.hl, hlInk: T.hlInk, trans: o.trans || 'circle' });

  /* ---------- детали ---------- */
  B.can = (w, id, extra = '') => `<div class="can" id="${id}" style="width:${w}vw;height:${w * 1.95}vw;${extra}">
    <div class="bd" style="top:${w * .12}vw;height:${w * 1.77}vw"></div>
    <div class="lb" style="top:${w * .6}vw;height:${w * .78}vw"><div style="width:${w * .3}vw;height:${w * .3}vw;border-radius:50%;background:#ff7a2f;box-shadow:0 0 0 ${w * .04}vw #ffb347;margin-bottom:${w * .05}vw"></div><div style="font-size:${w * .17}vw;line-height:1">ЗАРНИЦА</div><div style="font-size:${w * .085}vw;font-weight:700;letter-spacing:.14em;opacity:.7;margin-top:${w * .03}vw">COLD BREW</div></div>
    <div class="shine" style="left:14%"></div>
    <div class="lid" style="top:0;height:${w * .26}vw"></div><div class="abs" style="left:${w * .36}vw;top:${w * .06}vw;width:${w * .28}vw;height:${w * .1}vw;border-radius:${w}vw;background:#6e6e6e"></div></div>`;
  B.glass = (w, id, extra = '') => `<div class="glass" id="${id}" style="width:${w}vw;height:${w * 1.25}vw;${extra}"><div class="lq" style="height:0"></div>${[[22, 8], [50, 22], [34, 40]].map((c, i) => `<div class="cb" style="left:${c[0]}%;top:${c[1]}%"></div>`).join('')}<div class="abs" style="left:12%;top:6%;width:5%;height:70%;border-radius:10vw;background:rgba(255,255,255,.35)"></div></div>`;
  const fillGlass = (el, k, t) => { const lq = el.querySelector('.lq'); lq.style.height = (k * 78) + '%'; el.querySelectorAll('.cb').forEach((c, i) => { c.style.transform = `translateY(${-k * (6 + i * 5) + Math.sin(t * 2 + i) * 1.2}vw) rotate(${Math.sin(t * 1.5 + i) * 8}deg)`; }); };

  /* ---------- 1. БУДИЛЬНИК ---------- */
  B.alarm = (T, o = {}) => ({ ...base(T, o, 3.8), cam: [1, 1.05], cap: o.cap || 'Утро. *Глаза* не открываются.', capAt: 1.4,
    html: kick(T, 'Понедельник') + `<div class="abs" id="ck" style="left:0;right:0;top:22vw;text-align:center;font-size:30vw;font-weight:900;letter-spacing:-.05em;color:${T.ink};font-variant-numeric:tabular-nums">07:00</div>
      <div class="abs" id="bl" style="left:80vw;top:9vw">${P.icon('clock', T.ink, 10)}</div><div class="abs" id="sp" style="left:28vw;top:72vw">${P.spark(44, '#fff7ec', '#2b1a12')}</div>` + ['Z', 'z', 'z'].map((z, i) => `<div class="abs zz" style="left:${66 + i * 5}vw;top:${74 - i * 8}vw;font-size:${9 - i * 1.6}vw;font-weight:900;color:${T.ink};opacity:0">${z}</div>`).join(''),
    update(t, $, p, $$) { const sh = Math.sin(t * 50) * (t < 2.6 ? 1 : .2) * .5; set($('#ck'), { x: sh, o: eo(seg(t, 0, .4)) }); set($('#bl'), { r: Math.sin(t * 40) * 14 * (t < 2.6 ? 1 : .2), s: 1 + .08 * Math.sin(t * 20) });
      set($('#sp'), { s: spring((t - .15) / .6), y: Math.sin(t * 2) * 1.2 }); P.sparkAct($('#sp'), { spin: t * 6, blink: .08, mood: 'flat', dx: 0, dy: 3 });
      $$('.zz').forEach((e, i) => { const k = ((t * .5 + i * .3) % 1); e.style.opacity = Math.sin(k * Math.PI) * .8; e.style.transform = `translate(${k * 4}vw,${-k * 10}vw)`; }); } });

  /* ---------- 2. ЗНАКОМСТВО С БАНКОЙ ---------- */
  B.reveal = (T, o = {}) => ({ ...base(T, o, 3.2), bg: o.bg || '#ffb347', ink: '#2b1a12', hl: '#2b1a12', hlInk: '#ffb347', cap: o.cap || 'Знакомьтесь: *Зарница*', capAt: 1.1,
    html: `<div class="abs" id="ry" style="left:-50vw;top:-10vw;width:200vw;height:200vw;background:repeating-conic-gradient(rgba(255,255,255,.28) 0 7deg,transparent 7deg 20deg);border-radius:50%;opacity:.8"></div>` + B.can(34, 'cn', 'left:33vw;top:26vw') +
      `<div class="abs" id="t" style="left:0;right:0;top:106vw;text-align:center;font-size:17vw;font-weight:900;letter-spacing:-.04em;color:#2b1a12">ЗАРНИЦА</div><div class="abs" id="s" style="left:0;right:0;top:128vw;text-align:center;font-size:5vw;font-weight:800;letter-spacing:.16em;color:#2b1a12;opacity:.7">COLD BREW В БАНКЕ</div>`,
    update(t, $) { set($('#ry'), { r: t * 14, o: eo(seg(t, 0, .5)) * .8 }); const k = spring(t / .7); set($('#cn'), { y: (1 - k) * 40, s: .8 + .2 * k, r: (1 - k) * -14 + Math.sin(t * 2) * 1.5 }); const a = spring((t - .4) / .5); set($('#t'), { o: cl(a * 3), s: 1.25 - .25 * a }); set($('#s'), { o: eo(seg(t, .9, 1.4)) * .7 }); } });

  /* ---------- 3. ПРОЦЕСС: 12 часов на холоде ---------- */
  B.process = (T, o = {}) => ({ ...base(T, o, 6.0), cam: [1, 1.03], cap: o.cap || 'Заваривается *12 часов* на холоде', capAt: .5,
    html: kick(T, 'Как это делается') + `<div class="abs" id="tm" style="left:0;right:0;top:15vw;text-align:center;font-size:19vw;font-weight:900;letter-spacing:-.04em;color:${T.ink};font-variant-numeric:tabular-nums">0 ч</div>
    <div class="abs" id="tk" style="left:28vw;top:38vw;width:44vw;height:14vw;border-radius:3vw;background:linear-gradient(#a7d6ff,#5aa9f0);display:grid;place-items:center;font-size:4.4vw;white-space:nowrap;font-weight:900;color:#0b3a66;box-shadow:0 1vw 0 #2f6fb3">холодная вода</div>
    <div class="abs" style="left:49.3vw;top:52vw;width:1.4vw;height:8vw;background:#5aa9f0;border-radius:1vw"></div>
    <div class="abs" id="ch" style="left:28vw;top:60vw;width:44vw;height:22vw;border-radius:2vw;border:.8vw solid ${T.ink}55;overflow:hidden;background:#3a2210">${Array.from({ length: 34 }, (_, i) => `<i style="position:absolute;left:${(i * 37) % 92}%;top:${(i * 53) % 84}%;width:${2 + (i % 3)}vw;height:${1.6 + (i % 2)}vw;border-radius:50%;background:${['#5a3217', '#2b1608', '#7a4a26'][i % 3]};display:block"></i>`).join('')}</div>
    <div class="abs" id="dr" style="left:0;top:0;width:100vw;height:130vw"></div>
    <div class="abs" id="fl" style="left:26vw;top:92vw;width:48vw;height:38vw;border-radius:2vw 2vw 9vw 9vw;border:.8vw solid ${T.ink}66;overflow:hidden;background:rgba(255,255,255,.06)"><div id="lv" class="abs" style="left:0;right:0;bottom:0;height:0;background:linear-gradient(#7a4a26,#3a1f0d)"></div></div>`,
    update(t, $) { const k = eo(seg(t, .6, 5.2)); $('#tm').textContent = Math.round(k * 12) + ' ч'; set($('#tk'), { o: eo(seg(t, 0, .4)), y: (1 - spring(t / .5)) * -6 });
      $('#lv').style.height = (k * 86) + '%'; let d = ''; for (let i = 0; i < 3; i++) { const a = ((t * 1.1 + i / 3) % 1); d += `<i style="position:absolute;left:49.4vw;top:${54 + a * 5}vw;width:1.2vw;height:1.8vw;border-radius:50%;background:#5aa9f0;opacity:${1 - a * .4}"></i>`; const b = ((t * 1.1 + i / 3 + .5) % 1); d += `<i style="position:absolute;left:49.4vw;top:${82 + b * 14}vw;width:1.2vw;height:1.8vw;border-radius:50%;background:#7a4a26;opacity:${t > .8 ? 1 - b * .3 : 0}"></i>`; } $('#dr').innerHTML = d;
      set($('#ch'), { o: eo(seg(t, .1, .5)) }); set($('#fl'), { o: eo(seg(t, .2, .6)) }); } });

  /* ---------- 4. ВКУС: горечь падает ---------- */
  B.taste = (T, o = {}) => ({ ...base(T, o, 5.2), cap: o.cap || 'Без *горечи*: шоколад, орех, цитрус', capAt: 1.6,
    html: kick(T, 'Вкус') + `<div class="row" style="top:24vw"><div style="display:flex;justify-content:space-between;font-size:5vw;font-weight:800;color:${T.ink}"><span>Обычный кофе</span><span id="v1">82%</span></div><div style="height:8vw;border-radius:4vw;background:${T.soft};overflow:hidden;margin-top:2vw"><div id="b1" style="height:100%;width:0;background:#8a6a4d"></div></div></div>
      <div class="row" style="top:52vw"><div style="display:flex;justify-content:space-between;font-size:5vw;font-weight:900;color:${T.accent}"><span>Зарница · горечь</span><span id="v2">82%</span></div><div style="height:8vw;border-radius:4vw;background:${T.soft};overflow:hidden;margin-top:2vw"><div id="b2" style="height:100%;width:0;background:${T.accent}"></div></div></div>` +
      [['шоколад', '#7a4a26', 10], ['орех', '#c58b4e', 36], ['цитрус', '#ffb81f', 62]].map((c, i) => `<div class="abs nt" style="left:${c[2] - 4}vw;top:${86 + (i % 2) * 14}vw;display:flex;align-items:center;gap:2.4vw;background:${T.card};color:${T.ink};font-size:5.4vw;font-weight:800;padding:2.4vw 4vw;border-radius:5vw;box-shadow:0 1vw 0 ${T.shadow}"><i style="width:6vw;height:6vw;border-radius:50%;background:${c[1]};display:block"></i>${c[0]}</div>`).join(''),
    update(t, $, p, $$) { const a = eo(seg(t, .4, 1.2)); $('#b1').style.width = (82 * a) + '%'; $('#v1').textContent = Math.round(82 * a) + '%';
      const b = eo(seg(t, .4, 1.0)); const d = eo(seg(t, 1.3, 2.8)); const v = Math.round(lerp(82 * b, 14, d)); $('#b2').style.width = v + '%'; $('#v2').textContent = v + '%';
      $$('.nt').forEach((e, i) => { const k = spring((t - 2.6 - i * .3) / .5); set(e, { o: cl(k * 2), s: .7 + .3 * k, y: (1 - k) * 6 + Math.sin(t * 2 + i) * .6 }); }); } });

  /* ---------- 5. НАЛИВАНИЕ ---------- */
  B.pour = (T, o = {}) => ({ ...base(T, o, 5.0), cap: o.cap || 'Открыл. Налил. *Готово.*', capAt: 1.8,
    html: kick(T, 'Подача') + B.can(24, 'cn', 'left:58vw;top:18vw') + `<div class="abs" id="sr" style="left:50.6vw;top:56vw;width:1.6vw;height:0;border-radius:1vw;background:#4a2a14"></div>` + B.glass(40, 'gl', 'left:30vw;top:78vw') + `<div class="abs" id="ok" style="left:36vw;top:132vw;background:${T.accent};color:${T.hlInk === '#fff7ec' ? '#fff' : T.hlInk};font-size:5vw;font-weight:900;padding:2vw 5vw;border-radius:5vw;display:flex;gap:2vw;align-items:center;opacity:0">${P.icon('check', '#fff', 6)}Готово</div>`,
    update(t, $) { const tilt = eo(seg(t, .4, 1.4)) * (1 - eo(seg(t, 3.6, 4.4))); const k = spring(t / .5); set($('#cn'), { o: cl(k * 2), x: -tilt * 0, r: -125 * tilt, y: (1 - k) * -10 }); const pouring = t > 1.3 && t < 3.6; const fill = eo(seg(t, 1.5, 3.6));
      $('#sr').style.height = pouring ? (78 + (1 - fill) * 0 - 56 + 0) + 'vw' : '0'; $('#sr').style.height = pouring ? (lerp(100, 78 + 50 * (1 - .78 * fill), 1) - 56) + 'vw' : '0'; $('#sr').style.opacity = pouring ? 1 : 0;
      fillGlass($('#gl'), fill, t); set($('#gl'), { o: eo(seg(t, 0, .4)) }); const ok = spring((t - 3.7) / .4); set($('#ok'), { o: cl(ok * 2), s: .8 + .2 * ok }); } });

  /* ---------- 6. СОСТАВ ---------- */
  B.ingredients = (T, o = {}) => ({ ...base(T, o, 4.0), cap: o.cap || 'В составе — *только* кофе и вода', capAt: .6,
    html: kick(T, 'Состав') + `<div class="abs" id="cd" style="left:8vw;right:8vw;top:24vw;height:62vw;background:${T.card};border-radius:5vw;box-shadow:0 1.4vw 0 ${T.shadow},0 4vw 10vw rgba(0,0,0,.18);padding:6vw;color:${T.ink}"><div style="font-size:3.6vw;font-weight:800;letter-spacing:.18em;opacity:.55">СОСТАВ</div><div id="tx" style="font-size:16vw;font-weight:900;letter-spacing:-.04em;line-height:1;margin-top:6vw"></div></div>` +
      ['ароматизаторы', 'консерванты', 'сахар'].map((x, i) => `<div class="abs no" style="left:10vw;top:${96 + i * 13}vw;font-size:6vw;font-weight:800;color:${T.ink}"><span class="nl">${x}</span><i class="ln" style="position:absolute;left:-1vw;top:3.6vw;height:.9vw;width:0;background:#ff4b4b;border-radius:1vw;display:block"></i><b class="zr" style="position:absolute;left:62vw;top:-.5vw;background:${T.accent};color:#fff;border-radius:3vw;font-size:4vw;padding:.6vw 2.6vw;opacity:0">0</b></div>`).join(''),
    update(t, $, p, $$) { const c = spring((t - .1) / .5); set($('#cd'), { o: cl(c * 2), y: (1 - c) * 8, s: .94 + .06 * c }); $('#tx').innerHTML = type('кофе,', t, .6, 1.2) + '<br>' + type('вода.', t, 1.3, 1.9);
      $$('.no').forEach((e, i) => { const a = 2.0 + i * .5; set(e, { o: eo(seg(t, a - .3, a)) }); e.querySelector('.ln').style.width = (e.querySelector('.nl').offsetWidth + 2 * 7.7) * eo(seg(t, a, a + .3)) / 7.7 + 'vw'; e.querySelector('.ln').style.width = (50 * eo(seg(t, a, a + .3))) + 'vw'; e.querySelector('.nl').style.opacity = 1 - .5 * eo(seg(t, a, a + .3)); const z = spring((t - a - .2) / .4); e.querySelector('.zr').style.opacity = cl(z * 2); }); } });

  /* ---------- 7. ПОБЕДА: утро началось ---------- */
  B.wake = (T, o = {}) => ({ ...base(T, o, 3.6), bg: o.bg || '#ffb347', ink: '#2b1a12', hl: '#2b1a12', hlInk: '#ffb347', cap: o.cap || 'Три минуты — и *утро* началось', capAt: 1.2,
    html: `<div class="abs" id="ry" style="left:-50vw;top:-20vw;width:200vw;height:200vw;background:repeating-conic-gradient(rgba(255,255,255,.3) 0 7deg,transparent 7deg 20deg);border-radius:50%"></div><div class="abs" id="ck" style="left:0;right:0;top:20vw;text-align:center;font-size:26vw;font-weight:900;letter-spacing:-.05em;color:#2b1a12;font-variant-numeric:tabular-nums">07:00</div><div class="abs" id="sp" style="left:28vw;top:62vw">${P.spark(44, '#fff7ec', '#2b1a12')}</div>` + B.can(16, 'cn', 'left:72vw;top:80vw') + `<div id="cfw" class="abs" style="inset:0;z-index:80">${P.confetti(60, 9, ['#ff7a2f', '#fff7ec', '#2b1a12', '#ffd23f'])}</div>`,
    update(t, $) { set($('#ry'), { r: t * 16 }); const m = Math.round(3 * eo(seg(t, .2, 1.4))); $('#ck').textContent = '07:0' + m; set($('#sp'), { s: spring(t / .5), y: -Math.abs(Math.sin(t * 5)) * 3 * seg(t, .8, 1.2) }); P.sparkAct($('#sp'), { spin: t * 90, blink: P.blink(t), mood: 'smile', dx: 0, dy: 0 }); set($('#cn'), { s: spring((t - .3) / .5), r: 10 + Math.sin(t * 4) * 2 }); P.cfUpdate($('#cfw'), t - 1.1, 50, 70); } });

  /* ---------- 8. ПРИЗЫВ ---------- */
  B.cta = (T, o = {}) => { const ink = o.ink || '#f3e4d0', sub = o.sub || '#ffb347'; return ({ ...base(T, o, 4.0), bg: o.bg || '#1c120c', ink, hl: '#ff7a2f', hlInk: '#1c120c', cap: o.cap || 'Первая банка — *попробуй*', capAt: 1.5,
    html: `<div class="abs" id="gl" style="left:15vw;top:12vw;width:70vw;height:70vw;border-radius:50%;background:radial-gradient(circle,rgba(255,122,47,.5),rgba(255,122,47,0) 65%)"></div>` + B.can(28, 'cn', 'left:36vw;top:18vw') + `<div class="abs" id="t" style="left:0;right:0;top:92vw;text-align:center;font-size:19vw;font-weight:900;letter-spacing:-.04em;color:${ink}">ЗАРНИЦА</div><div class="abs" id="s" style="left:0;right:0;top:114vw;text-align:center;font-size:5.6vw;font-weight:700;color:${sub}">Холодный кофе без горечи</div><div class="abs" id="pr" style="left:18vw;top:126vw;display:flex;gap:3vw;align-items:center"><div style="background:#ff7a2f;color:#1c120c;font-size:5.6vw;font-weight:900;padding:2vw 5vw;border-radius:6vw">от 129 ₽</div><div style="font-size:4.2vw;font-weight:700;color:${ink};opacity:.8">zarnica.example</div></div>`,
    update(t, $) { const k = spring(t / .6); set($('#cn'), { y: (1 - k) * 30, s: .85 + .15 * k, r: Math.sin(t * 2) * 2 }); set($('#gl'), { s: 1 + .06 * Math.sin(t * 3), o: eo(seg(t, 0, .6)) }); const a = spring((t - .3) / .5); set($('#t'), { o: cl(a * 3), s: 1.3 - .3 * a }); set($('#s'), { o: eo(seg(t, .9, 1.4)) }); const p = spring((t - 1.2) / .45); set($('#pr'), { o: cl(p * 2), s: .85 + .15 * p }); } }); };

  B.fillGlass = fillGlass;
  window.B = B;
})();
