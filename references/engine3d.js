/* 3D-движок для роликов (ES-модуль поверх Three.js): студийный свет и тени, материалы, готовые объекты,
 * объёмный текст (с кириллицей), 3D-логотипы, GLB-модели. Время — только из t, кадры детерминированы.
 *
 * В HTML (пути — от файла ролика; см. references/template-3d.html):
 *   <script type="importmap">{"imports":{"three":"../../vendor/node_modules/three/build/three.module.js",
 *     "three/addons/":"../../vendor/node_modules/three/examples/jsm/","opentype":"../../vendor/node_modules/opentype.js/dist/opentype.module.js"}}</script>
 *   <script src="../../references/engine.js"></script> …
 *   <script type="module"> import { E3D } from '../../references/engine3d.js'; … E.run({...}) </script>
 *
 * Сцена с 3D:
 *   { dur: 4, bg: '#f3e4d0',
 *     mount(el) { v = E3D.view(el, { floor: '#f3e4d0' }); can = v.add(E3D.can({ label: { title: 'ЗАРНИЦА' } })); },
 *     update(t) { can.rotation.y = t * .8; v.orbit({ target: [0, .9, 0], radius: 5.5, angle: 20 + t * 6, height: 1.4 }); v.render(t); } }
 *
 * API:
 *   E3D.view(el, {floor|bg, fov, exposure, tone:'neutral'|'aces'|'agx', env, key, fill, rim, shadows, shadowOpacity, bloom:{strength,radius,threshold},
 *                 quality:'draft'|'high'|'ultra', ao: true|{radius,intensity,thickness,samples}|false, shadowExtent: число|'auto', pixelRatio})
 *        → v.scene v.camera v.add(...) v.on(fn(t)) v.orbit({target,radius,angle,height,fov}) v.look(pos,target) v.render(t)
 *          v.fit(объекты, {angle, elev, pad}) → {target, radius, height}: камера сама кадрирует объекты (вертикаль учитывается)
 *          v.fitShadow(объекты, {pad}) — «коробка» тени по объектам: та же карта теней ложится плотнее → чётче контактные тени
 * Качество (по умолчанию 'high'; глобально — window.__E3D_OPTS = {quality, ao}, его ставят render.mjs/frame.mjs: --ultra, --draft3d, --ao, --no-ao):
 *   draft — превью: без MSAA, тени 1024, геометрия ×0.6;   high — как раньше: MSAA 4, тени 2048
 *   ultra — финал/4K: тени 4096 мягче и без «лестниц», AO (GTAO) в щелях и контактах, преломление в полном разрешении,
 *           отражения 512, геометрия ×1.6, текстуры-надписи ×2. Уровень детализации берут объекты, созданные ПОСЛЕ view().
 *   4K: рендер в devicePixelRatio (render.mjs --preset vertical-4k или --scale 2): вёрстка как в 1080p, пиксели ×2,
 *       все цели постобработки (bloom/DOF/AO) — в реальных пикселях; bloom считается в «1080p-масштабе», чтобы вид не менялся.
 *   E3D.seg(n) — число сегментов с учётом качества (для своих геометрий); E3D.quality() — имя текущего уровня.
 *   E3D.mat(kind, color, extra)  kind: clay plastic glossy paint metal chrome gold glass emissive matte basic
 *   Примитивы: box(w,h,d,{r}) sphere(r) capsule(r,len) cylinder(r,h) torus(R,r,{arc}) cone(r,h)  — опции {color, kind, mat}
 *   Объекты:   can({label,color}) bottle({label,liquid,fill}) phone({screen(ctx,W,H,t)}) mascot({color}) confetti(n,{at,origin})
 *   Текст:     text3D('ЗАРНИЦА', {size, depth, color, kind}) — выдавленные буквы (Inter Black, латиница+кириллица)
 *              label('текст', {size, color, bg}) — плоская надпись-табличка в пространстве
 *   Логотипы:  logo3D('Telegram', {size, depth, color}) / logoTile3D('Telegram') — из logos.js (scripts/logos.mjs) или SVG-строки
 *   Модели:    glb('model.glb', {size}) — грузится асинхронно, рендер ждёт загрузки; анимации модели идут по t
 * Объект с userData.tick(t) обновляется сам при v.render(t).
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
let rectReady = false;
import opentype from 'opentype';

const V3 = THREE.Vector3;
const pending = (window.__pending = window.__pending || []);
const track = (p) => { pending.push(p.catch((e) => console.error('3D: загрузка не удалась —', e && e.message || e))); return p; };
const col = (c) => new THREE.Color(c);
const slug = (s) => (/[Ѐ-ӿ]/.test(s) ? String(s).toLowerCase() : String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')).replace(/&/g, 'and').replace(/\+/g, 'plus').replace(/[^\p{L}\p{N}]/gu, '');
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/* ------------------------------ уровни качества ------------------------------ */
// msaa — сэмплы сглаживания; shadowSize/shadowRadius — карта теней и размытие края (в текселях); transmissionScale — разрешение
// преломления; envSize — грань куба отражений; detail — множитель сегментов геометрии; texRes — множитель разрешения текстур-надписей
const QUALITY = {
  draft: { name: 'draft', msaa: 0, shadowSize: 1024, shadowRadius: 1, transmissionScale: 0.5, envSize: 128, detail: 0.6, texRes: 1, ao: false },
  high: { name: 'high', msaa: 4, shadowSize: 2048, shadowRadius: 1, transmissionScale: 0.5, envSize: 256, detail: 1, texRes: 1, ao: false },
  ultra: { name: 'ultra', msaa: 8, shadowSize: 4096, shadowRadius: 2.5, transmissionScale: 1, envSize: 512, detail: 1.6, texRes: 2, ao: true },
};
let Q = QUALITY[(window.__E3D_OPTS || {}).quality] || QUALITY.high; // текущий уровень: view() переключает его для объектов, созданных после
export const seg = (n, min = 3) => Math.max(min, Math.round(n * Q.detail));
export const quality = () => Q.name;

/* ------------------------------ материалы ------------------------------ */
// цвет по умолчанию у каждого материала свой (золото — золотое, хром — белый и т.д.)
const DEF_COLOR = { clay: '#e8e2d9', plastic: '#f2f2f2', glossy: '#f2f2f2', paint: '#c83a2a', metal: '#c9ccd2', chrome: '#ffffff', gold: '#e8b64c', glass: '#ffffff', emissive: '#ffd27a', matte: '#dddddd', basic: '#ffffff' };
export function mat(kind = 'clay', color, extra = {}) {
  const c = col(color ?? DEF_COLOR[kind] ?? '#dddddd');
  const P = (o) => new THREE.MeshPhysicalMaterial({ color: c, ...o, ...extra });
  const S = (o) => new THREE.MeshStandardMaterial({ color: c, ...o, ...extra });
  switch (kind) {
    case 'clay': return P({ roughness: 0.62, metalness: 0, sheen: 0.4, sheenRoughness: 0.55, sheenColor: col('#ffffff') });
    case 'plastic': return P({ roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.18 });
    case 'glossy': return P({ roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.04 });
    case 'paint': return P({ roughness: 0.3, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 });
    case 'metal': return S({ roughness: 0.3, metalness: 1 });
    case 'chrome': return S({ roughness: 0.06, metalness: 1 });
    case 'gold': return S({ roughness: 0.22, metalness: 1 });
    case 'glass': return P({ roughness: 0.04, metalness: 0, transmission: 1, thickness: 0.6, ior: 1.45, attenuationColor: c, attenuationDistance: 1.6, specularIntensity: 1 });
    case 'emissive': return S({ emissive: c, emissiveIntensity: extra.intensity ?? 2.5, roughness: 0.5 });
    case 'matte': return S({ roughness: 1, metalness: 0 });
    case 'basic': return new THREE.MeshBasicMaterial({ color: c, ...extra });
    default: return S({ roughness: 0.5 });
  }
}
const pick = (o, kind = 'clay') => o.mat || mat(o.kind || kind, o.color);

export function shade(obj, cast = true, receive = true) {
  obj.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = receive; } });
  return obj;
}
const mesh = (geo, m) => shade(new THREE.Mesh(geo, m));

/* ------------------------------ свет: окружение-«студия» из софтбоксов ------------------------------ */
// HDR-окружение из светящихся панелей: даёт на глянце/мокрых поверхностях красивые длинные блики, как в предметной съёмке
function studioEnv(renderer, o = {}) {
  const s = new THREE.Scene();
  const base = col(o.envBase || '#141414');
  const room = new THREE.Mesh(new THREE.SphereGeometry(30, 48, 24), new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  const pos = room.geometry.attributes.position, cols = [];
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 30; const c = base.clone().lerp(col(o.envTop || '#4a4640'), Math.max(0, y) ** 1.5); cols.push(c.r, c.g, c.b); }
  room.geometry.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  s.add(room);
  const panel = (w, h, p, k, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col(c).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...p); m.lookAt(0, 0.5, 0); s.add(m); };
  const warm = o.warm ? '#ffe2c0' : '#fff6ea';
  panel(7, 5, [-7, 6, 7], 7, warm);            // ключевой софтбокс спереди-слева
  panel(1.4, 12, [8, 2, -4], 6, '#ffffff');     // стрип справа сзади (контур)
  panel(1.4, 12, [-8, 2, -5], 4, warm);         // стрип слева сзади
  panel(10, 10, [0, 14, 0], 2.4, '#ffffff');    // верхний
  panel(6, 3, [6, 1, 8], 1.2, '#ffe9d6');       // заполняющий отражатель
  if (o.backdrop) panel(18, 6, [0, 2.5, -15], o.backdrop, o.backdropColor || warm); // задний фон-софтбокс: отражается в жидкости/полу при съёмке снизу
  if (o.beauty !== false) panel(9, 4, [1.5, 4.5, 13], o.beauty ?? 3.2, warm); // фронтальный «бьюти»-софтбокс над камерой: блики на мокрых/глянцевых поверхностях, смотрящих в кадр
  const tex = new THREE.PMREMGenerator(renderer).fromScene(s, 0.02, 0.1, 100, { size: o.size || 256 }).texture;
  return tex;
}

// пресеты света: studio (мягкий универсальный), product (софтбоксы, глянец), sunset (тёплый низкий + холодное заполнение),
// dramatic (жёсткий ключ сверху, сильный контур, тёмное окружение)
const LIGHTS = {
  studio: { env: 'room', envI: 0.9, key: ['#ffffff', 2.4, [4, 9, 6]], fill: ['#ffffff', '#c9b8a6', 0.55], rim: ['#ffffff', 1.4, [-5, 4, -6]] },
  product: { env: 'studio', envI: 1.0, key: ['#fff4e8', 2.0, [-4, 8, 5]], fill: ['#ffffff', '#8a7a6a', 0.25], rim: ['#ffe0b8', 3.0, [5, 4, -6]], rim2: ['#d8e8ff', 1.6, [-6, 3, -5]] },
  sunset: { env: 'studio', envI: 0.8, warm: true, key: ['#ffb070', 3.0, [6, 3, 4]], fill: ['#7ea6ff', '#ff9a55', 0.6], rim: ['#ffcf8a', 3.4, [-5, 3, -6]] },
  dramatic: { env: 'studio', envI: 0.55, key: ['#fff1de', 3.2, [-2, 10, 3]], fill: ['#ffffff', '#3a3028', 0.12], rim: ['#ffd29a', 4.0, [4, 3, -6]], rim2: ['#ffffff', 2.0, [-5, 2, -5]] },
};

/* ------------------------------ постобработка: цветокоррекция, виньетка, зерно ------------------------------ */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uContrast: { value: 1.06 }, uSat: { value: 1.08 }, uWarm: { value: 0.0 }, uVig: { value: 0.25 }, uGrain: { value: 0.03 }, uTime: { value: 0 }, uLift: { value: 0.0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uContrast, uSat, uWarm, uVig, uGrain, uTime, uLift; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime*7.13) * 43758.5453); }
    void main(){ vec4 c = texture2D(tDiffuse, vUv); vec3 x = c.rgb;
      x = (x - 0.5) * uContrast + 0.5 + uLift;                       // контраст
      float l = dot(x, vec3(0.2126,0.7152,0.0722)); x = mix(vec3(l), x, uSat); // насыщенность
      x += vec3(0.06, 0.015, -0.05) * uWarm;                           // теплота
      vec2 d = vUv - 0.5; x *= 1.0 - uVig * smoothstep(0.25, 0.85, length(d * vec2(1.0, 0.75)) * 1.25); // виньетка
      x += (h(vUv * 1000.0) - 0.5) * uGrain;                           // плёночное зерно (детерминировано по t)
      gl_FragColor = vec4(clamp(x, 0.0, 1.0), c.a); }`,
};

/* ------------------------------ ambient occlusion (GTAO) ------------------------------ */
// затенение в щелях и местах контакта (между кубиками, под каплей, у пола). Отличия от стандартного GTAOPass:
// шум денойзера — от сида (кадры одинаковы при любом запуске, без мерцания); G-буфер учитывает плоскости обрезки
// (разрез манго) и двусторонние материалы; прозрачное (надписи, ловушка теней, material.userData.noAO) не затеняет
class AOPass extends GTAOPass {
  setSize(w, h) { const k = this.res || 1; super.setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))); }
  _generateNoise(size = 64) {
    let s = 9; const sn = new SimplexNoise({ random: () => ((s = (s * 16807) % 2147483647) / 2147483647) });
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
      const k = (i * size + j) * 4;
      data[k] = (sn.noise(i, j) * 0.5 + 0.5) * 255; data[k + 1] = (sn.noise(i + size, j) * 0.5 + 0.5) * 255;
      data[k + 2] = (sn.noise(i, j + size) * 0.5 + 0.5) * 255; data[k + 3] = (sn.noise(i + size, j + size) * 0.5 + 0.5) * 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.needsUpdate = true;
    return tex;
  }
  _overrideVisibility() {
    super._overrideVisibility();
    this._swapped = [];
    this._normals = this._normals || new WeakMap();
    this.scene.traverse((x) => {
      if (!x.isMesh || !x.visible || Array.isArray(x.material)) return;
      const m = x.material;
      if (m.isShadowMaterial || (m.transparent && !m.transmission) || m.userData.noAO) { x.visible = false; this._visibilityCache.push(x); return; }
      if ((m.clippingPlanes && m.clippingPlanes.length) || m.side !== THREE.FrontSide) {
        let nm = this._normals.get(m);
        if (!nm) { nm = new THREE.MeshNormalMaterial({ side: m.side, clippingPlanes: m.clippingPlanes, blending: THREE.NoBlending }); nm.allowOverride = false; this._normals.set(m, nm); }
        this._swapped.push([x, m]); x.material = nm;
      }
    });
  }
  _restoreVisibility() {
    super._restoreVisibility();
    for (const [x, m] of this._swapped || []) x.material = m;
    this._swapped = [];
  }
}

// проходы, которые перерисовывают сцену подменным материалом (AO — нормали, DOF — глубина), не должны заново считать карты теней:
// в кадре они уже посчитаны основным проходом, а повтор карты 4096² — это лишние секунды на программном WebGL
const noShadowPass = (p) => {
  const render = p.render.bind(p);
  p.render = (renderer, ...a) => { const sm = renderer.shadowMap, au = sm.autoUpdate; sm.autoUpdate = false; render(renderer, ...a); sm.autoUpdate = au; };
  return p;
};

/* ------------------------------ сцена ------------------------------ */
export function view(el, o = {}) {
  // глобальные переопределения (render.mjs --ultra/--draft3d/--ao, замеры): window.__E3D_OPTS = {quality, ao, antialias, shadowSize, ...}
  const G = window.__E3D_OPTS || {}, page = o;
  o = { ...page, ...G };
  const q = (Q = QUALITY[o.quality] || QUALITY.high);
  // AO: параметры задаёт страница, глобальный флаг включает/выключает (объект — дополняет параметры); в черновике — выключен, если не включён явно
  let ao = G.ao === false ? false : G.ao ? (typeof G.ao === 'object' ? { ...(typeof page.ao === 'object' ? page.ao : {}), ...G.ao } : page.ao || true) : (page.ao ?? q.ao);
  if (q === QUALITY.draft && !G.ao) ao = false;
  const aa = (o.antialias ?? true) && q.msaa > 0;
  const post = !!(o.bloom || o.dof || o.grade || ao);
  const L = LIGHTS[o.light || 'studio'];
  const r = el.getBoundingClientRect();
  const W = Math.round(r.width || innerWidth), H = Math.round(r.height || innerHeight);
  const pr = o.pixelRatio || window.devicePixelRatio || 1; // 4K: страница с deviceScaleFactor 2 → холст и все цели ×2
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block';
  el.insertBefore(canvas, el.firstChild);
  // с постобработкой сглаживает цель композитора, а MSAA и глубина у самого холста — лишняя память (в 4K это сотни МБ на сцену)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: aa && !post, depth: !post, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(pr);
  renderer.setSize(W, H, false);
  renderer.toneMapping = { neutral: THREE.NeutralToneMapping, aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, none: THREE.NoToneMapping }[o.tone || 'neutral'];
  renderer.toneMappingExposure = o.exposure ?? 1;
  renderer.shadowMap.enabled = o.shadows !== false;
  // PCF (r186): 5 сэмплов по диску Фогеля с поворотом по пикселю — мягкий край без «лестниц»; ширина края — shadow.radius
  renderer.shadowMap.type = o.shadowType === 'vsm' ? THREE.VSMShadowMap : THREE.PCFShadowMap;
  renderer.localClippingEnabled = true; // разрезы объектов (clippingPlanes у материалов)
  // преломление (стекло, капли) — доля разрешения вёрстки (CSS-пикселей): high — половина (почти не видно, а в разы быстрее), ultra — полное;
  // в 4K (pr=2) не растёт вчетверо: искажённая картинка сквозь каплю не становится от этого детальнее
  renderer.transmissionResolutionScale = (o.transmissionScale ?? q.transmissionScale) / pr;

  const scene = new THREE.Scene();
  scene.environment = (o.env || L.env) === 'studio' ? studioEnv(renderer, { warm: L.warm, envBase: o.envBase, envTop: o.envTop, beauty: o.beauty, backdrop: o.backdrop, backdropColor: o.backdropColor, size: q.envSize }) : new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: q.envSize }).texture;
  scene.environmentIntensity = o.envIntensity ?? L.envI;
  const camera = new THREE.PerspectiveCamera(o.fov ?? 30, W / H, 0.02, 400);

  const shadowSize = o.shadowSize ?? q.shadowSize;
  // «коробка» теневой камеры: half — полуразмер (по умолчанию ±7 — вся студия); меньше коробка → те же текселы плотнее → резче контакт
  const setShadowBox = (d, half, c = [0, 0, 0], dist = null) => {
    if (dist) { const dir = d.position.clone().sub(d.target.position).normalize(); d.target.position.set(...c); d.position.set(...c).addScaledVector(dir, dist); }
    Object.assign(d.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: Math.max(40, (dist || 0) + half * 3) });
    d.shadow.camera.updateProjectionMatrix();
    d.shadow.normalBias = Math.max(0.006, 3 * (2 * half) / shadowSize); // ~3 текселя: без «акне» и без отрыва тени от предмета
  };
  const dl = (c, i, p, cast) => { const d = new THREE.DirectionalLight(c, i); d.position.set(...p); if (cast) { d.castShadow = o.shadows !== false; d.shadow.mapSize.set(shadowSize, shadowSize); d.shadow.radius = o.shadowSoftness ?? q.shadowRadius; d.shadow.bias = -0.0004; setShadowBox(d, typeof o.shadowExtent === 'number' ? o.shadowExtent : 7); } scene.add(d, d.target); return d; };
  // ключевой (с тенью), заполняющий (небо/земля), контровой — и второй контровой у product/dramatic
  const key = dl(o.keyColor || L.key[0], o.key ?? L.key[1], o.keyPos || L.key[2], true);
  const hemi = new THREE.HemisphereLight(L.fill[0], o.ground || L.fill[1], o.fill ?? L.fill[2]);
  scene.add(hemi);
  const rim = dl(o.rimColor || L.rim[0], o.rim ?? L.rim[1], o.rimPos || L.rim[2], false);
  const rim2 = L.rim2 ? dl(L.rim2[0], o.rim2 ?? L.rim2[1], L.rim2[2], false) : null;

  const fy = o.floorY ?? 0;
  if (o.floor) {
    // бесшовная «циклорама»: пол того же цвета, что фон, и туман к горизонту
    const fc = col(o.floor);
    scene.background = fc;
    scene.fog = new THREE.Fog(fc, o.fogNear ?? 18, o.fogFar ?? 48);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshBasicMaterial({ color: fc, toneMapped: false }));
    fl.rotation.x = -Math.PI / 2;
    fl.position.y = fy - 0.002;
    scene.add(fl);
  } else if (o.bg) scene.background = col(o.bg);
  if (o.shadows !== false && o.shadowOpacity !== 0) {
    // ловушка теней: на прозрачном фоне тень ложится прямо на 2D-фон сцены
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.ShadowMaterial({ opacity: o.shadowOpacity ?? 0.24 }));
    sc.rotation.x = -Math.PI / 2;
    sc.position.y = fy;
    sc.receiveShadow = true;
    scene.add(sc);
  }

  // постобработка: AO (ao), глубина резкости (dof), свечение бликов (bloom), цветокоррекция (grade) — цели в реальных пикселях (W×pr);
  // плавные эффекты (AO, ореол bloom) — в разрешении вёрстки: дешевле, а на глаз то же самое
  let composer = null, bokeh = null, grade = null, gtao = null;
  if (post) {
    // в 4K (pr ≥ 2) пиксели и так вдвое мельче — хватает 2 сэмплов; 8 сэмплов на 2160×3840 в программном WebGL стоят минуты
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: aa ? Math.min(pr >= 2 ? 2 : q.msaa, renderer.capabilities.maxSamples) : 0, type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, rt);
    // сцену RenderPass рисует в readBuffer (renderTarget2) — MSAA нужен только ему; второй буфер — без сэмплов (−4 × W×H×8 байт).
    // Чтобы MSAA-буфер был readBuffer в начале каждого кадра, после кадра выравниваем чётность обменов (см. render)
    composer.renderTarget1.samples = 0;
    composer.addPass(new RenderPass(scene, camera));
    if (ao) {
      const a = ao === true ? {} : ao;
      gtao = new AOPass(scene, camera, W, H, undefined,
        { radius: a.radius ?? 0.3, thickness: a.thickness ?? 0.6, distanceFallOff: a.falloff ?? 1, distanceExponent: a.exponent ?? 1.5, samples: a.samples ?? 16, scale: 1 },
        { radius: 6, lumaPhi: 10, depthPhi: 2, normalPhi: 3, samples: 16, rings: 2 }); // денойз: радиус в пикселях AO-буфера
      gtao.blendIntensity = a.intensity ?? 0.9;
      gtao.res = a.res ?? 1 / pr; // AO плавное: в 4K считаем его в разрешении вёрстки — вчетверо дешевле, на глаз не отличить
      composer.addPass(noShadowPass(gtao));
    }
    if (o.dof) { bokeh = new BokehPass(scene, camera, { focus: o.dof.focus ?? 6, aperture: o.dof.aperture ?? 0.004, maxblur: o.dof.maxblur ?? 0.012 }); composer.addPass(noShadowPass(bokeh)); }
    if (o.bloom) {
      const bp = new UnrealBloomPass(new THREE.Vector2(W, H), o.bloom.strength ?? 0.6, o.bloom.radius ?? 0.45, o.bloom.threshold ?? 0.85);
      const size = bp.setSize.bind(bp); // ореол считается в «1080p-масштабе»: при pr=2 он не становится вдвое уже, а проход — вчетверо дороже
      bp.setSize = (w, h) => size(Math.round(w / pr), Math.round(h / pr));
      composer.addPass(bp);
    }
    composer.addPass(new OutputPass());
    if (o.grade) {
      grade = new ShaderPass(GradeShader);
      const g = o.grade === true ? {} : o.grade;
      for (const [k, u] of [['contrast', 'uContrast'], ['saturation', 'uSat'], ['warmth', 'uWarm'], ['vignette', 'uVig'], ['grain', 'uGrain'], ['lift', 'uLift']]) if (g[k] !== undefined) grade.uniforms[u].value = g[k];
      composer.addPass(grade);
    }
    composer.setSize(W, H); // EffectComposer сам умножит на pixelRatio рендерера
  }
  const renderPost = () => { composer.render(); if (composer.readBuffer !== composer.renderTarget2) composer.swapBuffers(); };

  // тень по объектам: центр и полуразмер коробки — по описанной сфере (вызывай в mount, пока объекты в исходном положении)
  const fitShadow = (objs, { pad = 1.3 } = {}) => {
    const b = new THREE.Box3();
    [].concat(objs).forEach((x) => { x.updateMatrixWorld(true); b.expandByObject(x); });
    if (b.isEmpty()) return;
    const sp = b.getBoundingSphere(new THREE.Sphere());
    setShadowBox(key, sp.radius * pad, [sp.center.x, sp.center.y, sp.center.z], 20);
  };
  // 'auto': после mount всех сцен (микрозадача) — по всем отбрасывающим тень мешам; детерминировано, т.к. не зависит от первого t
  if (o.shadowExtent === 'auto') queueMicrotask(() => { const c = []; scene.traverse((x) => { if (x.isMesh && x.castShadow && !x.isInstancedMesh) c.push(x); }); if (c.length) fitShadow(c); });

  const ticks = [];
  const v = {
    THREE, scene, camera, renderer, el, key, rim, rim2, hemi, bokeh, grade, gtao, composer, quality: q.name, pixelRatio: pr,
    fitShadow(objs, opts) { fitShadow(objs, opts); return v; },
    add(...objs) { objs.forEach((x) => scene.add(x)); return objs[0]; },
    on(fn) { ticks.push(fn); return v; },
    // камера по орбите вокруг цели: angle — градусы вокруг вертикали, height — высота над целью
    orbit({ target = [0, 1, 0], radius = 6, angle = 0, height = 2, fov } = {}) {
      const a = THREE.MathUtils.degToRad(angle);
      camera.position.set(target[0] + Math.sin(a) * radius, target[1] + height, target[2] + Math.cos(a) * radius);
      camera.lookAt(target[0], target[1], target[2]);
      if (fov && fov !== camera.fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      return v;
    },
    look(pos, target = [0, 1, 0]) { camera.position.set(...pos); camera.lookAt(...target); return v; },
    // fit: подобрать дистанцию, чтобы объекты целиком влезли в кадр (с учётом вертикального формата).
    // Возвращает {target, radius, height} — дальше анимируй v.orbit({...f, angle}) по t. Вызывай в mount, а не каждый кадр.
    fit(objs, { angle = 0, elev = 10, pad = 1.05 } = {}) {
      const b = new THREE.Box3();
      [].concat(objs).forEach((x) => { x.updateMatrixWorld(true); b.expandByObject(x); });
      const sp = b.getBoundingSphere(new THREE.Sphere());
      const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
      const dist = (sp.radius * pad) / Math.sin(Math.min(vf, hf));
      const e = THREE.MathUtils.degToRad(elev);
      const f = { target: [sp.center.x, sp.center.y, sp.center.z], radius: dist * Math.cos(e), height: dist * Math.sin(e) };
      v.orbit({ ...f, angle });
      return f;
    },
    // подвижный софтбокс (прямоугольный источник): длинный блик на глянце/мокром, который можно «провести» по объекту
    softbox({ w = 3, h = 2, intensity = 6, color = '#ffffff', pos = [0, 3, 4], target = [0, 1, 0] } = {}) {
      if (!rectReady) { RectAreaLightUniformsLib.init(); rectReady = true; }
      const l = new THREE.RectAreaLight(color, intensity, w, h);
      l.position.set(...pos); l.lookAt(...target); l.userData.target = target;
      l.userData.move = (p) => { l.position.set(...p); l.lookAt(...l.userData.target); };
      scene.add(l);
      return l;
    },
    // фокус глубины резкости: расстояние от камеры (или до точки [x,y,z])
    focus(d) { if (bokeh) bokeh.uniforms.focus.value = Array.isArray(d) ? camera.position.distanceTo(new V3(...d)) : d; return v; },
    render(t = 0) {
      ticks.forEach((f) => f(t));
      scene.traverse((x) => { if (x.userData.tick) x.userData.tick(t); if (x.material && x.material.userData.time) x.material.userData.time.value = t; });
      if (grade) grade.uniforms.uTime.value = t;
      if (composer) renderPost(); else renderer.render(scene, camera);
    },
  };
  v.orbit();
  return v;
}

/* ------------------------------ шейдеры: процедурный цвет, рельеф, подповерхностное рассеяние ------------------------------ */
// 3D-шум (simplex, Ashima Arts / Stefan Gustavson, MIT) + fbm — общий для всех процедурных материалов
export const GLSL_NOISE = `
vec3 e3dMod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;} vec4 e3dMod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 e3dPerm(vec4 x){return e3dMod289(((x*34.0)+10.0)*x);} vec4 e3dTis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){ const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
 vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx); vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
 vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=e3dMod289(i);
 vec4 p=e3dPerm(e3dPerm(e3dPerm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
 float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
 vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
 vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0)); vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
 vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
 vec4 norm=e3dTis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
 vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
 return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3))); }
float fbm(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; }
float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<3;i++){ s+=a*snoise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5; } return s; } // дешевле: 3 октавы
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); } // цвет «как в макете» (sRGB) → линейный для шейдера
// антиалиасинг узора (только фрагментный шейдер): 1 — деталь частоты freq (шум от p*freq) крупнее пикселя, 0 — мельче (гасим, иначе рябь/муар в движении)
float aaFade(vec3 p, float freq){ return 1.0 - smoothstep(0.35, 0.75, length(fwidth(p)) * freq); }
float snoiseAA(vec3 p, float freq){ return snoise(p * freq) * aaFade(p, freq); }  // snoise(p*freq), гаснущий вдали
float fbmAA(vec3 p){ float w=length(fwidth(p)), f=1.0, a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*snoise(p)*(1.0-smoothstep(0.35,0.75,w*f)); p=p*2.03+vec3(1.7,9.2,3.1); f*=2.03; a*=0.5; } return s; } // fbm без «искр» мелких октав
`;

/* enhance(material, opts) — внедрить шейдерные эффекты в обычный материал Three.js (свет/тени/отражения сохраняются).
 *  color:  GLSL, меняет diffuseColor.rgb; доступны P (позиция ×scale + сид), N0 (нормаль объекта), snoise(), fbm(), srgb(), uTime, свои uniforms
 *  height: GLSL-выражение float — процедурный рельеф (bump) силой bump; лак (clearcoat) остаётся гладким = «мокрая плёнка»
 *  rough:  GLSL, меняет roughnessFactor (мокрые/сухие участки)
 *  coat:   GLSL-выражение float — рельеф лакового слоя силой coatBump (плёнка сока/воды с пологими волнами → дробные влажные блики)
 *  glsl:   свои функции/объявления в заголовок фрагментного шейдера
 *  post:   GLSL, правит итоговый цвет gl_FragColor (линейный, до тонмаппинга): растворить край в фоне, подкрасить и т.п.
 *  pre:    GLSL в общей области main (до color): посчитай шум один раз и переиспользуй в color/height/coat/rough — это главный способ ускорить рендер
 *  sss:    {color, strength, power, distortion, ambient} — свет «просвечивает» сквозь объект от контровых источников
 *  rim:    {color, intensity, power} — мягкое свечение по контуру (бархат, кожица, «ореол»)
 *  space:  'object' (по умолчанию) | 'world'; scale — масштаб P; uniforms: {имя: значение}
 *  rest:   true — P берётся из атрибута aRest (vec3, «исходные» координаты вершины): узор не «плывёт», когда геометрию деформируют на CPU
 * У InstancedMesh можно задать атрибут aSeed (vec3) — каждый экземпляр получит свой узор.
 * Мелкие детали без ряби (и в 1080p, и в 4K): высокочастотный шум умножай на aaFade(P, частота) — он гаснет, когда деталь
 * становится мельче пикселя (объект отъехал, кадр уменьшен). Готовые варианты: snoiseAA(P, 52.0) вместо snoise(P*52.0),
 * fbmAA(P*k) вместо fbm(P*k). Особенно важно для height/coat: рельеф мельче пикселя даёт «искрящиеся» блики. */
export function enhance(m, o = {}) {
  const U = { uScale: { value: o.scale ?? 1 }, uBump: { value: o.bump ?? 0.0 }, uCoatBump: { value: o.coatBump ?? 0.0 }, uTime: { value: 0 } };
  if (o.sss) Object.assign(U, { uSssCol: { value: col(o.sss.color || '#ff8a00') }, uSssK: { value: o.sss.strength ?? 1 }, uSssP: { value: o.sss.power ?? 3 }, uSssD: { value: o.sss.distortion ?? 0.35 }, uSssA: { value: o.sss.ambient ?? 0.12 } });
  if (o.rim) Object.assign(U, { uRimCol: { value: col(o.rim.color || '#ffffff') }, uRimK: { value: o.rim.intensity ?? 0.5 }, uRimP: { value: o.rim.power ?? 3 } });
  for (const [k, v] of Object.entries(o.uniforms || {})) U[k] = { value: typeof v === 'string' && v.startsWith('#') ? col(v) : v };
  m.userData.time = U.uTime;
  m.userData.uniforms = U;
  const key = JSON.stringify([o.pre, o.color, o.height, o.rough, o.coat, o.glsl, o.post, !!o.sss, !!o.rim, o.space, !!o.seed, !!o.rest, Object.keys(o.uniforms || {})]);
  m.customProgramCacheKey = () => key;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const ty = (v) => (typeof v === 'number' ? 'float' : (typeof v === 'string' || v.isColor || v.isVector3) ? 'vec3' : v.isVector2 ? 'vec2' : v.isVector4 ? 'vec4' : v.isTexture ? 'sampler2D' : 'float');
    const decl = Object.entries(o.uniforms || {}).map(([k, v]) => (Array.isArray(v) ? `uniform ${ty(v[0])} ${k}[${v.length}];` : `uniform ${ty(v)} ${k};`)).join('\n');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vE3dP; varying vec3 vE3dSeed; varying vec3 vE3dN;\n#ifdef E3D_SEED\nattribute vec3 aSeed;\n#endif\n${o.rest ? 'attribute vec3 aRest;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${o.rest ? 'vE3dP = aRest;' : o.space === 'world' ? `#ifdef USE_INSTANCING\n vE3dP = (modelMatrix * instanceMatrix * vec4(position,1.0)).xyz;\n#else\n vE3dP = (modelMatrix * vec4(position,1.0)).xyz;\n#endif` : 'vE3dP = position;'}
        vE3dN = normal; vE3dSeed = vec3(0.0);
        #ifdef E3D_SEED
        vE3dSeed = aSeed;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vE3dP; varying vec3 vE3dSeed; varying vec3 vE3dN; uniform float uScale, uBump, uCoatBump, uTime;
        ${o.sss ? 'uniform vec3 uSssCol; uniform float uSssK, uSssP, uSssD, uSssA;' : ''}
        ${o.rim ? 'uniform vec3 uRimCol; uniform float uRimK, uRimP;' : ''}
        ${decl}
        ${GLSL_NOISE}
        vec3 e3dBump(vec3 n, float h, float k){ vec3 p = -vViewPosition; vec3 dx = dFdx(p), dy = dFdy(p);
          float hx = dFdx(h)*k, hy = dFdy(h)*k; vec3 r1 = cross(dy, n), r2 = cross(n, dx); float det = dot(dx, r1);
          vec3 g = sign(det) * (hx * r1 + hy * r2); return normalize(abs(det) * n - g); }
        ${o.glsl || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 P = vE3dP * uScale + vE3dSeed * 7.0; vec3 N0 = normalize(vE3dN);
        ${o.pre || ''}
        ${o.color ? `{ ${o.color} }` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${o.rough ? `{ ${o.rough} }` : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${o.height ? `{ float h = ${o.height}; normal = e3dBump(normal, h, uBump); }` : ''}`)
      .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>\n${o.coat ? `#ifdef USE_CLEARCOAT\n{ float hc = ${o.coat}; clearcoatNormal = e3dBump(clearcoatNormal, hc, uCoatBump); }\n#endif` : ''}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        ${o.sss ? `#if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec3 Ld = directionalLights[i].direction;
            float s = pow(saturate(dot(geometryViewDir, -normalize(Ld + normal * uSssD))), uSssP) * uSssK;
            reflectedLight.directDiffuse += uSssCol * directionalLights[i].color * s * diffuseColor.rgb; }
          #endif
          reflectedLight.indirectDiffuse += uSssCol * uSssA * diffuseColor.rgb;` : ''}
        ${o.rim ? 'reflectedLight.directSpecular += uRimCol * uRimK * pow(1.0 - saturate(dot(normal, geometryViewDir)), uRimP);' : ''}`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>\n${o.post ? `{ ${o.post} }` : ''}`);
    if (o.seed) sh.defines = { ...(sh.defines || {}), E3D_SEED: '' };
  };
  if (o.seed) m.defines = { ...(m.defines || {}), E3D_SEED: '' };
  m.needsUpdate = true;
  return m;
}

// жидкость (сок, вода, мёд): преломление, поглощение цвета по толщине, мокрый блик
// glow — свечение на контровом свете и ореол по краю (сок «горит» на просвет, а не темнеет на тёмном фоне)
export function liquidMat(color = '#ffa000', o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: col(o.tint || '#ffffff'), transmission: o.transmission ?? 1, thickness: o.thickness ?? 0.35, ior: o.ior ?? 1.34, roughness: o.roughness ?? 0.02,
    attenuationColor: col(color), attenuationDistance: o.depth ?? 0.25, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02, ...(o.extra || {}) });
  if (o.glow !== false) enhance(m, { sss: { color, strength: o.glow ?? 1.2, power: 2.2, distortion: 0.3, ambient: o.ambient ?? 0.22 }, rim: { color: o.rimColor || '#ffe6b0', intensity: 0.4, power: 2.6 } });
  return m;
}

// мягкая контактная тень (пятно затемнения под объектом) — «приземляет» предмет даже без резкой тени
export function contactShadow(w = 1.6, d = 1.2, opacity = 0.45) {
  const { tex } = canvasTex(256, 256, (ctx, W, H) => { const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.5, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  m.renderOrder = -1;
  return m;
}

/* ------------------------------ примитивы ------------------------------ */
// число сегментов — через seg(): в ultra гуще (гладкий силуэт в 4K), в draft — реже
export const box = (w = 1, h = 1, d = 1, o = {}) => mesh(new RoundedBoxGeometry(w, h, d, seg(6), o.r ?? Math.min(w, h, d) * 0.14), pick(o));
export const sphere = (r = 0.5, o = {}) => mesh(new THREE.SphereGeometry(r, seg(64), seg(40)), pick(o));
export const capsule = (r = 0.2, len = 0.6, o = {}) => mesh(new THREE.CapsuleGeometry(r, len, seg(12), seg(32)), pick(o));
export const cylinder = (r = 0.5, h = 1, o = {}) => mesh(new THREE.CylinderGeometry(o.rt ?? r, r, h, seg(72)), pick(o));
export const torus = (R = 0.5, r = 0.15, o = {}) => mesh(new THREE.TorusGeometry(R, r, seg(32), seg(96), o.arc ?? Math.PI * 2), pick(o));
export const cone = (r = 0.5, h = 1, o = {}) => mesh(new THREE.ConeGeometry(r, h, seg(72)), pick(o));

/* ------------------------------ текстуры с надписями (кириллица — через шрифты страницы) ------------------------------ */
// рисуй в логических единицах w×h: в ultra холст в texRes раз плотнее (ctx уже масштабирован) — надписи чёткие и в 4K
export function canvasTex(w, h, draw, res = Q.texRes) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * res); c.height = Math.round(h * res);
  const ctx = c.getContext('2d');
  ctx.scale(c.width / w, c.height / h);
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Q.detail > 1 ? 16 : 8;
  return { tex, ctx, canvas: c };
}
function fitFont(ctx, text, weight, maxW, maxPx) {
  let px = maxPx;
  ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) px = Math.floor(px * maxW / w);
  ctx.font = `${weight} ${px}px Inter, system-ui, sans-serif`;
  return px;
}
// этикетка банки/бутылки по умолчанию: фон, полосы, эмблема-солнце, название и подзаголовок по центру «фаса»
function drawLabel(ctx, W, H, L) {
  if (typeof L === 'function') return L(ctx, W, H);
  const bg = L.bg || '#f3e4d0', ink = L.ink || '#2b1a12', ac = L.accent || '#ff7a2f';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = ac; ctx.fillRect(0, H * 0.06, W, H * 0.035); ctx.fillRect(0, H * 0.905, W, H * 0.035);
  const cx = W / 2;
  if (L.emblem !== false) {
    ctx.beginPath(); ctx.arc(cx, H * 0.3, H * 0.12, 0, Math.PI * 2); ctx.fillStyle = ac; ctx.fill();
    ctx.lineWidth = H * 0.025; ctx.strokeStyle = L.accent2 || '#ffb347'; ctx.stroke();
  }
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  fitFont(ctx, L.title || 'BRAND', 900, W * 0.3, H * 0.2); ctx.fillText(L.title || 'BRAND', cx, H * 0.58);
  if (L.sub) { fitFont(ctx, L.sub, 700, W * 0.24, H * 0.07); ctx.globalAlpha = 0.75; ctx.fillText(L.sub, cx, H * 0.75); ctx.globalAlpha = 1; }
}

export function label(text, o = {}) {
  const px = 160, pad = o.bg ? 70 : 20;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = `${o.weight || 900} ${px}px Inter, system-ui, sans-serif`;
  const tw = Math.ceil(meas.measureText(text).width);
  const W = tw + pad * 2, H = Math.round(px * 1.35) + pad;
  const { tex } = canvasTex(W, H, (ctx) => {
    if (o.bg) { ctx.fillStyle = o.bg; ctx.beginPath(); ctx.roundRect(0, 0, W, H, H * 0.28); ctx.fill(); }
    ctx.font = `${o.weight || 900} ${px}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = o.color || '#1d1b19'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2 + px * 0.04);
  });
  const h = o.size ?? 0.5;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * W / H, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  return m;
}

/* ------------------------------ продукты ------------------------------ */
const lathe = (pts, m, n = 96) => mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg(n)), m);

// банка 0.33 л: высота 1.8, радиус 0.5; label — {title, sub, bg, ink, accent} или функция (ctx, W, H)
export function can(o = {}) {
  const g = new THREE.Group();
  const alu = mat('metal', '#d9dbe0', { roughness: 0.28 });
  g.add(lathe([[0, 0.035], [0.4, 0], [0.47, 0.03], [0.5, 0.1], [0.5, 0.135]], alu));
  g.add(lathe([[0.5, 1.6], [0.47, 1.7], [0.43, 1.75], [0.445, 1.78], [0.425, 1.8], [0.405, 1.79], [0, 1.785]], alu));
  const { tex } = canvasTex(2048, 958, (ctx, W, H) => drawLabel(ctx, W, H, o.label || {}));
  tex.wrapS = THREE.RepeatWrapping;
  tex.offset.x = 0.5; // центр этикетки — к камере (+Z)
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.47, seg(128), 1, true),
    new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.32, metalness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.1 }));
  body.position.y = 0.135 + 1.47 / 2;
  g.add(shade(body));
  const tab = mesh(new RoundedBoxGeometry(0.17, 0.02, 0.27, seg(3), 0.008), alu);
  tab.position.set(0, 1.8, 0.12);
  tab.rotation.x = -0.06;
  g.add(tab);
  g.userData.texture = tex;
  return g;
}

// бутылка: стекло + жидкость (fill 0..1) + крышка + этикетка
export function bottle(o = {}) {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.38, 0], [0.42, 0.04], [0.42, 1.2], [0.36, 1.45], [0.17, 1.75], [0.15, 1.95], [0.16, 2.0], [0, 2.0]];
  g.add(lathe(prof, mat('glass', o.glass || '#e8f4ff')));
  const lc = o.liquid || '#7a3b12';
  const fill = o.fill ?? 0.8;
  const level = 1.95 * fill, lp = [];
  for (let i = 0; i < prof.length - 1; i++) { // профиль жидкости = профиль бутылки, срезанный на уровне fill
    const [x0, y0] = prof[i], [x1, y1] = prof[i + 1];
    if (y0 <= level) lp.push([x0 * 0.92, Math.max(y0, 0.015)]);
    if (y0 < level && y1 > level) lp.push([(x0 + (x1 - x0) * (level - y0) / (y1 - y0)) * 0.92, level]);
  }
  lp.push([0, level]);
  const liq = lathe(lp, new THREE.MeshPhysicalMaterial({ color: col(lc), roughness: 0.1, transmission: 0.35, thickness: 0.8 }));
  g.add(liq);
  const cap = cylinder(0.175, 0.2, { kind: 'plastic', color: o.cap || '#1d1b19' });
  cap.position.y = 2.05;
  g.add(cap);
  if (o.label) {
    const { tex } = canvasTex(2048, 1100, (ctx, W, H) => drawLabel(ctx, W, H, o.label));
    tex.wrapS = THREE.RepeatWrapping; tex.offset.x = 0.5;
    const lb = new THREE.Mesh(new THREE.CylinderGeometry(0.425, 0.425, 0.62, seg(128), 1, true), new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.55 }));
    lb.position.y = 0.66;
    g.add(shade(lb));
  }
  return g;
}

// телефон с «живым» экраном: screen(ctx, W, H, t) рисует интерфейс на каждом кадре
export function phone(o = {}) {
  const g = new THREE.Group();
  const frame = mesh(new RoundedBoxGeometry(0.84, 1.72, 0.09, seg(8), 0.1), mat('metal', o.color || '#1f2026', { roughness: 0.35 }));
  g.add(frame);
  const W = 720, H = 1480;
  const c = canvasTex(W, H, () => {});
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.78 * H / W), new THREE.MeshBasicMaterial({ map: c.tex, toneMapped: false, transparent: true }));
  scr.position.z = 0.0465;
  g.add(scr);
  const cam = mesh(new RoundedBoxGeometry(0.28, 0.28, 0.03, seg(4), 0.06), mat('metal', '#2a2b31'));
  cam.position.set(-0.2, 0.62, -0.055);
  g.add(cam);
  const draw = (t) => {
    const ctx = c.ctx;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath(); ctx.roundRect(0, 0, W, H, 84); ctx.clip();
    ctx.fillStyle = '#0d0f14'; ctx.fillRect(0, 0, W, H);
    if (o.screen) o.screen(ctx, W, H, t);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.roundRect(W / 2 - 110, 26, 220, 62, 31); ctx.fill(); // «островок» камеры
    ctx.restore();
    c.tex.needsUpdate = true;
  };
  draw(0);
  g.userData.tick = draw;
  return g;
}

// маскот-«искорка» в 3D: шар-тело, 8 лучей, глаза, улыбка; userData: petals, setMood('smile'|'o'), blink(k), paint(color)
export function mascot(o = {}) {
  const g = new THREE.Group();
  const m = mat('clay', o.color || '#ffb347');
  const body = mesh(new THREE.SphereGeometry(0.6, seg(64), seg(40)), m);
  g.add(body);
  const petals = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const p = mesh(new THREE.CapsuleGeometry(0.14, 0.4, seg(10), seg(24)), m);
    p.position.set(Math.cos(a) * 0.86, Math.sin(a) * 0.86, -0.05);
    p.rotation.z = a - Math.PI / 2;
    petals.add(p);
  }
  g.add(petals);
  const face = new THREE.Group();
  const ink = mat('glossy', o.face || '#24160e');
  const eyes = [-0.2, 0.2].map((x) => { const e = mesh(new THREE.SphereGeometry(0.085, seg(32), seg(20)), ink); e.position.set(x, 0.1, 0.54); e.scale.set(1, 1.35, 0.6); face.add(e); return e; });
  [-0.17, 0.23].forEach((x) => { const h = new THREE.Mesh(new THREE.SphereGeometry(0.024, seg(16), seg(10)), mat('basic', '#ffffff')); h.position.set(x, 0.16, 0.6); face.add(h); });
  const smile = mesh(new THREE.TorusGeometry(0.16, 0.03, seg(12), seg(40), Math.PI), ink);
  smile.position.set(0, -0.08, 0.56); smile.rotation.z = Math.PI;
  const oMouth = mesh(new THREE.TorusGeometry(0.07, 0.028, seg(12), seg(32)), ink);
  oMouth.position.set(0, -0.16, 0.56); oMouth.visible = false;
  face.add(smile, oMouth);
  g.add(face);
  g.userData = {
    petals, face,
    setMood: (k) => { smile.visible = k !== 'o'; oMouth.visible = k === 'o'; },
    blink: (k) => eyes.forEach((e) => (e.scale.y = 1.35 * Math.max(0.08, k))),
    paint: (c) => m.color.set(c),
  };
  return g;
}

// 3D-конфетти: InstancedMesh, траектории считаются из t (детерминированно)
export function confetti(n = 120, o = {}) {
  seed = o.seed || 7;
  const colors = (o.colors || ['#ff7a2f', '#ffd23f', '#58cc02', '#1cb0f6', '#ce82ff', '#ff4b4b']).map(col);
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.12, 0.01), new THREE.MeshStandardMaterial({ roughness: 0.45, side: THREE.DoubleSide }), n);
  im.castShadow = true;
  const P = Array.from({ length: n }, (_, i) => {
    im.setColorAt(i, colors[i % colors.length]);
    const a = rnd() * Math.PI * 2, s = 1.5 + rnd() * 3.2;
    return { v: new V3(Math.cos(a) * s * 0.55, 4 + rnd() * 4, Math.sin(a) * s * 0.55), w: new V3(rnd() * 14 - 7, rnd() * 14 - 7, rnd() * 14 - 7), d: rnd() * 0.15 };
  });
  const org = new V3(...(o.origin || [0, 0.5, 0]));
  const dm = new THREE.Object3D();
  const at = o.at ?? 0, g = o.gravity ?? -7.5, floor = o.floorY ?? 0.03;
  im.userData.tick = (t) => {
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const tt = t - at - p.d;
      if (tt < 0) { dm.scale.setScalar(0); }
      else {
        const drag = Math.min(tt, 1.2) + Math.max(0, tt - 1.2) * 0.35; // в воздухе тормозят и «планируют»
        dm.position.set(org.x + p.v.x * drag, Math.max(floor, org.y + p.v.y * tt + 0.5 * g * tt * tt * (tt > 1 ? 0.55 : 1)), org.z + p.v.z * drag);
        dm.rotation.set(p.w.x * tt, p.w.y * tt, p.w.z * tt);
        dm.scale.setScalar(1);
      }
      dm.updateMatrix();
      im.setMatrixAt(i, dm.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  im.userData.tick(-1);
  return im;
}

/* ------------------------------ SVG → 3D (логотипы, текст) ------------------------------ */
export function extrudeSVG(svg, o = {}) {
  const data = new SVGLoader().parse(svg);
  const shapes = [];
  for (const p of data.paths) {
    const fill = p.userData && p.userData.style && p.userData.style.fill;
    if (fill === 'none' && !o.forceFill) continue;
    shapes.push(...SVGLoader.createShapes(p));
  }
  const b = new THREE.Box2();
  shapes.forEach((s) => s.getPoints(8).forEach((pt) => b.expandByPoint(pt)));
  const sz = b.getSize(new THREE.Vector2()), c = b.getCenter(new THREE.Vector2());
  const fit = o.fit === 'height' ? sz.y : o.fit === 'width' ? sz.x : Math.max(sz.x, sz.y);
  const k = (o.size ?? 1.6) / (fit || 1);
  const depth = (o.depth ?? 0.25) / k, bevel = (o.bevel ?? 0.03) / k;
  const m = o.mat || mat(o.kind || 'plastic', o.color);
  const inner = new THREE.Group();
  shapes.forEach((s) => inner.add(mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: seg(4, 2), curveSegments: seg(28, 8) }), m)));
  inner.position.set(-c.x, -c.y, -depth / 2);
  const g = new THREE.Group();
  g.add(inner);
  g.scale.set(k, -k, k); // в SVG ось Y вниз
  g.userData.material = m;
  return g;
}

export function logo3D(src, o = {}) {
  let svg = null, hex = null;
  if (typeof src === 'string' && src.trim().startsWith('<svg')) svg = src;
  else {
    const L = (window.LOGOS || {})[slug(src)];
    if (L && L.svg) { svg = L.svg; hex = '#' + L.hex; }
    else if (L && L.src) return label(src, { size: (o.size ?? 1.6) * 0.3, color: o.color || '#1d1b19', bg: '#ffffff' }); // растровый логотип — табличка
  }
  if (!svg) { console.warn('3D: нет векторного логотипа для', src, '— запусти рендер (logos.mjs найдёт) или передай SVG'); return label(String(src), { size: (o.size ?? 1.6) * 0.3, bg: '#ffffff' }); }
  return extrudeSVG(svg, { ...o, color: o.color || hex || '#222222' });
}

// плитка-иконка приложения: скруглённый куб цвета бренда + белый выпуклый знак
export function logoTile3D(src, o = {}) {
  const L = (window.LOGOS || {})[slug(src)];
  const s = o.size ?? 1.6;
  const g = new THREE.Group();
  g.add(box(s, s, s * 0.22, { r: s * 0.2, kind: 'plastic', color: o.bg || (L && L.hex ? '#' + L.hex : '#ffffff') }));
  const lg = logo3D(src, { size: s * 0.58, depth: s * 0.06, color: o.color || '#ffffff', kind: 'glossy' });
  lg.position.z = s * 0.11 + s * 0.02;
  g.add(lg);
  return g;
}

// объёмный текст: контуры букв Inter Black (латиница + кириллица) → выдавливание
let fontsP = null;
const FONT_FILES = ['inter-latin-900-normal.woff', 'inter-cyrillic-900-normal.woff'];
const loadFonts = () => (fontsP ||= Promise.all(FONT_FILES.map((f) => fetch(new URL(`../vendor/node_modules/@fontsource/inter/files/${f}`, import.meta.url)).then((r) => r.arrayBuffer()).then((b) => opentype.parse(b)))));
export function text3D(text, o = {}) {
  const g = new THREE.Group();
  track(loadFonts().then((fonts) => {
    const fs = 100;
    let x = 0, d = '', prev = null, prevFont = null;
    for (const ch of String(text)) {
      const f = fonts.find((ff) => ff.charToGlyph(ch).index > 0) || fonts[0];
      const gl = f.charToGlyph(ch);
      if (prev && prevFont === f) x += f.getKerningValue(prev, gl) * fs / f.unitsPerEm;
      d += gl.getPath(x, 0, fs).toPathData(2);
      x += gl.advanceWidth * fs / f.unitsPerEm + (o.tracking ?? 0) * fs;
      prev = gl; prevFont = f;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#000"/></svg>`;
    const kind = o.kind || 'plastic';
    const color = o.color ?? (['gold', 'chrome', 'metal', 'glass'].includes(kind) ? undefined : '#1d1b19');
    const t = extrudeSVG(svg, { fit: 'height', size: o.size ?? 0.8, depth: o.depth ?? 0.22, bevel: o.bevel ?? 0.02, kind, color, mat: o.mat });
    g.add(t);
    g.userData.material = t.userData.material;
  }));
  return g;
}

/* ------------------------------ модели GLB/GLTF ------------------------------ */
export function glb(url, o = {}) {
  const g = new THREE.Group();
  track(new GLTFLoader().loadAsync(url).then((gltf) => {
    const s = gltf.scene;
    shade(s);
    const b = new THREE.Box3().setFromObject(s), sz = b.getSize(new V3()), c = b.getCenter(new V3());
    const k = (o.size ?? 2) / Math.max(sz.x, sz.y, sz.z);
    s.scale.setScalar(k);
    s.position.set(-c.x * k, -b.min.y * k, -c.z * k); // по центру и стоит на полу
    g.add(s);
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(s);
      gltf.animations.forEach((a) => mixer.clipAction(a).play());
      g.userData.tick = (t) => mixer.setTime(t * (o.speed ?? 1));
    }
  }));
  return g;
}

export const E3D = { THREE, view, seg, quality, mat, shade, enhance, liquidMat, contactShadow, GLSL_NOISE, box, sphere, capsule, cylinder, torus, cone, can, bottle, phone, mascot, confetti, label, extrudeSVG, logo3D, logoTile3D, text3D, glb, canvasTex };
window.E3D = E3D;
