/* Движок сцен для рекламных/сюжетных роликов (вертикальных и любых).
 * Подключение: <script src="../../references/engine.js"></script>, затем E.run({...}).
 * Всё — функция времени: окно.__setTime(ms) вызывает рендерер на каждый кадр.
 *
 * E.run({
 *   hl: '#ff6a3d',            // цвет подсветки ключевых слов в субтитрах
 *   progress: 'bar',          // 'bar' | 'segments' | false — индикатор сверху
 *   trans: 0.35,              // длительность перехода между сценами, с
 *   scenes: [{
 *     dur: 3,                 // длительность, с
 *     bg: '#fff' | gradient,  // фон сцены
 *     ink: '#1d1b19',         // цвет субтитров
 *     hlInk: '#fff',          // цвет текста внутри подсветки
 *     hl: '#111',             // цвет подсветки слов в этой сцене (иначе общий)
 *     html: '<div class="x"></div>',   // разметка сцены (позиционируй absolute, единицы vw/vh)
 *     cap: 'Текст с *подсветкой*',     // субтитры (слова появляются по очереди)
 *     capAt: 0.25,            // когда начать субтитры, с
 *     capPos: 'bottom'|'top'|'center', // положение субтитров
 *     trans: 'fade'|'up'|'left'|'zoom'|'circle'|'wipe'|'none', // как сцена входит
 *     cam: [1, 1.08],         // плавный наезд камеры на сцену (масштаб начало→конец)
 *     update(lt, $, p) {}     // lt — секунды от начала сцены, $ — querySelector внутри сцены, p = lt/dur
 *     mount(el, $) {}         // один раз при создании сцены (3D: E3D.view(el, ...))
 *     sfx: [[0.5, 'pop'], [1.2, 'pour', {dur: 2, gain: .7, pan: -.3}]]  // звуки по времени сцены (scripts/sfx.py --list)
 *   }],
 *   music: { style: 'lofi', from: 'scene:2+0.3', drums: 'scene:4+1.2', bpm: 86, gain: 0.5 }  // фоновая музыка
 * })
 * Звук собирает render.mjs автоматически (python3 + numpy); отключить: --no-sfx.
 */
(function () {
  const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const seg = (t, a, b) => cl((t - a) / (b - a));
  const eo = (x) => 1 - Math.pow(1 - x, 3);
  const ei = (x) => x * x * x;
  const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const eb = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const lerp = (a, b, x) => a + (b - a) * x;
  // spring: плавная «пружина» с лёгким перелётом (x от 0 до 1 → 0…1.0x…1)
  const spring = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.exp(-7 * x) * Math.cos(10 * x));
  const smooth = (x) => x * x * (3 - 2 * x);
  // count: число, плавно бегущее от a до b за отрезок [t0,t1]
  const count = (a, b, t, t0, t1) => Math.round(lerp(a, b, eo(seg(t, t0, t1))));
  // mix: плавный переход между цветами '#rrggbb' (k от 0 до 1)
  const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const mix = (a, b, k) => { const x = hex(a), y = hex(b); k = cl(k); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`; };
  const type = (s, t, a, b) => s.slice(0, Math.floor(seg(t, a, b) * s.length));
  // pop: масштаб с «пружинкой» от 0 до 1 за d секунд, начиная с a
  const pop = (t, a, d = 0.45) => (t < a ? 0 : eb(seg(t, a, a + d)));
  // set: opacity + transform в одном вызове. x,y — vw; s — масштаб; r — градусы
  const set = (el, o = {}) => {
    if (!el) return;
    if (o.o !== undefined) el.style.opacity = o.o;
    el.style.transform = `translate(${o.x || 0}vw,${o.y || 0}vw) scale(${o.s === undefined ? 1 : o.s}) rotate(${o.r || 0}deg)`;
  };

  const css = `
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100vw;height:100vh;overflow:hidden;background:#000;font-family:Inter,system-ui,"Helvetica Neue",Arial,sans-serif}
  #stage{position:absolute;inset:0;overflow:hidden}
  .scene{position:absolute;inset:0;overflow:hidden}
  .scene .abs,.abs{position:absolute}
  .cap{position:absolute;left:6vw;right:6vw;text-align:center;font-weight:800;font-size:5.4vw;line-height:1.28;letter-spacing:-.01em;z-index:50}
  .cap.bottom{bottom:9vh}.cap.top{top:11vh}.cap.center{top:50%;transform:translateY(-50%)}
  .cap .w{display:inline-block;margin:0 .14em;white-space:nowrap}
  .cap .h{background:var(--hl);color:var(--hlInk,#fff);padding:.02em .34em .06em;border-radius:.3em;margin:0 .08em}
  #prog{position:absolute;left:0;right:0;top:0;height:.9vw;z-index:99;display:flex;gap:.8vw;padding:0}
  #prog .seg{flex:1;background:rgba(127,127,127,.25);position:relative;overflow:hidden}
  #prog i{position:absolute;inset:0;background:var(--hl);transform-origin:left;transform:scaleX(0)}
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  function parseCap(str) {
    const out = [];
    const re = /\*([^*]+)\*|(\S+)/g;
    let m;
    while ((m = re.exec(str))) out.push(m[1] ? { t: m[1], h: true } : { t: m[2], h: false });
    return out;
  }

  function run(cfg) {
    const scenes = cfg.scenes;
    const trD = cfg.trans === undefined ? 0.35 : cfg.trans;
    document.documentElement.style.setProperty('--hl', cfg.hl || '#ff6a3d');
    const stage = document.createElement('div');
    stage.id = 'stage';
    document.body.appendChild(stage);

    let acc = 0;
    scenes.forEach((s, i) => {
      s.start = acc; acc += s.dur; s.end = acc;
      const el = document.createElement('section');
      el.className = 'scene';
      el.style.background = s.bg || '#fff';
      el.style.zIndex = i + 1;
      el.innerHTML = `<div class="camw" style="position:absolute;inset:0">${s.html || ''}</div>`;
      s.camEl = el.firstChild;
      if (s.cap) {
        const cap = document.createElement('div');
        cap.className = 'cap ' + (s.capPos || 'bottom');
        cap.style.color = s.ink || '#1d1b19';
        if (s.hl) cap.style.setProperty('--hl', s.hl);
        if (s.hlInk) cap.style.setProperty('--hlInk', s.hlInk);
        cap.innerHTML = parseCap(s.cap).map((w) => `<span class="w${w.h ? ' h' : ''}">${w.t}</span>`).join(' ');
        el.appendChild(cap);
        s.capWords = [...cap.querySelectorAll('.w')];
      }
      stage.appendChild(el);
      s.el = el;
      s.$ = (q) => s.camEl.querySelector(q);
      s.$$ = (q) => [...s.camEl.querySelectorAll(q)];
    });
    const total = acc;
    window.__total = total;
    // mount(el, $, scene) — один раз после создания DOM сцены (например, вставить 3D-холст: E3D.view)
    scenes.forEach((s) => s.mount && s.mount(s.camEl, s.$, s));

    // звук: события сцен в абсолютном времени + музыка → window.__AUDIO (его читает render.mjs)
    const abs = (v) => {
      if (typeof v === 'number') return v;
      const m = String(v).match(/^scene:(\d+)([+-][\d.]+)?$/);
      return m ? scenes[+m[1]].start + (m[2] ? parseFloat(m[2]) : 0) : 0;
    };
    const cues = [];
    scenes.forEach((s) => (s.sfx || []).forEach(([t, type, o]) => cues.push({ t: +(s.start + t).toFixed(3), type, ...(o || {}) })));
    window.__AUDIO = (cues.length || cfg.music) ? {
      duration: total, cues,
      music: cfg.music ? { ...cfg.music, from: abs(cfg.music.from || 0), drums: cfg.music.drums === undefined ? null : abs(cfg.music.drums) } : null,
    } : null;

    let prog = null, bar = null, segs = [];
    if (cfg.progress !== false) {
      prog = document.createElement('div'); prog.id = 'prog'; stage.appendChild(prog);
      if (cfg.progress === 'segments') {
        segs = scenes.map(() => { const sg = document.createElement('div'); sg.className = 'seg'; sg.innerHTML = '<i></i>'; prog.appendChild(sg); return sg.firstChild; });
      } else {
        prog.innerHTML = '<div class="seg"><i></i></div>'; bar = prog.querySelector('i');
      }
    }

    function drawScene(s, lt) {
      const capStart = s.capAt === undefined ? 0.25 : s.capAt;
      if (s.capWords) {
        s.capWords.forEach((w, k) => {
          const a = capStart + k * 0.09;
          const v = w.classList.contains('h') ? pop(lt, a, 0.4) : eo(seg(lt, a, a + 0.25));
          w.style.opacity = cl(v);
          w.style.transform = `translateY(${(1 - cl(v)) * 1.2}vw) scale(${w.classList.contains('h') ? 0.6 + 0.4 * v : 1})`;
        });
      }
      if (s.cam) { // медленный наезд/отъезд камеры: cam: [масштаб в начале, масштаб в конце]
        const k = lerp(s.cam[0], s.cam[1], smooth(cl(lt / s.dur)));
        s.camEl.style.transform = `scale(${k})`;
      }
      if (s.update) s.update(lt, s.$, cl(lt / s.dur), s.$$);
    }

    window.__setTime = (ms) => {
      const t = Math.min(ms / 1000, total - 0.001);
      let idx = scenes.findIndex((s) => t >= s.start && t < s.end);
      if (idx < 0) idx = scenes.length - 1;
      scenes.forEach((s, i) => {
        const lt = t - s.start;
        const prevDur = i > 0 ? scenes[i - 1].dur : 0;
        let show = i === idx;
        let tx = '', op = 1;
        if (i === idx) {
          const k = i === 0 ? 1 : eo(seg(lt, 0, trD));
          const mode = s.trans || 'fade';
          if (mode === 'fade') op = k;
          else if (mode === 'up') tx = `translateY(${(1 - k) * 100}%)`;
          else if (mode === 'left') tx = `translateX(${(1 - k) * 100}%)`;
          else if (mode === 'zoom') { op = k; tx = `scale(${0.9 + 0.1 * k})`; }
          else if (mode === 'circle') { s.el.style.clipPath = k >= 1 ? 'none' : `circle(${k * 75}% at 50% 55%)`; }
          else if (mode === 'wipe') { s.el.style.clipPath = k >= 1 ? 'none' : `inset(${(1 - k) * 100}% 0 0 0)`; }
          else if (mode === 'none') { op = 1; }
        } else if (i === idx - 1 && t - scenes[idx].start < trD && (scenes[idx].trans || 'fade') !== 'none') {
          show = true; // предыдущая сцена остаётся под входящей на время перехода
        }
        if (i !== idx) s.el.style.clipPath = 'none';
        s.el.style.display = show ? 'block' : 'none';
        if (show) {
          s.el.style.opacity = op;
          s.el.style.transform = tx;
          drawScene(s, i === idx ? lt : scenes[i].dur + (t - scenes[idx].start));
        }
      });
      if (bar) bar.style.transform = `scaleX(${t / total})`;
      segs.forEach((sg, i) => { sg.style.transform = `scaleX(${seg(t, scenes[i].start, scenes[i].end)})`; });
    };
    window.__setTime(0);
  }

  window.E = { run, cl, seg, eo, ei, eio, eb, lerp, type, pop, set, spring, smooth, count, mix };
})();
