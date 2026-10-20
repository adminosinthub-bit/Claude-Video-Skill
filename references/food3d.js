/* Еда и жидкости для 3D-роликов: манго (целое, разрез, «ёжик»), капли/брызги/стекание, всплеск-«корона», лужица с рябью, нож, лист.
 * Всё анимируется от t (детерминированно). Опирается на engine3d.js (enhance, liquidMat).
 *   import { F } from '../../references/food3d.js';
 *   const m = F.mango();                       // целое манго (группа, стоит на полу)
 *   const { body, cheek } = F.mangoCut();      // разрезанное: тело + «щёчка» (поворачивай cheek, чтобы показать мякоть)
 *   const hh = F.hedgehog(); hh.userData.setK(k) // «ёжик»: k 0 → плоский надрезанный срез, 1 → кубики вывернуты
 *   const d = F.drops([...F.spray({...}), F.drip({...}), ...F.beads(...)]) // все капли — один InstancedMesh со стеклом-соком
 *   const sp = F.splash({ at: 1.2, pos: [0,0,0] }); const pool = F.pool({ impacts: [[x,z,t,amp]] });
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { E3D } from './engine3d.js';

const V3 = THREE.Vector3;
const col = (c) => new THREE.Color(c);
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sh = (o) => E3D.shade(o);

/* ------------------------------ материалы манго ------------------------------ */
// Микродетали («4K»): всё мельче нескольких пикселей сглажено по fwidth — дальше деталь плавно заменяется своим средним
// (нет ряби/муара в 1080p). Шум считается один раз в pre и переиспользуется в цвете, рельефе, лаке и шероховатости.
const FOOD_GLSL = `
// размер пикселя в единицах шума с координатой p
float fdW(vec3 p) { return length(fwidth(p)); }
// видимость детали: 1 — период крупнее пикселя, 0 — мельче (тогда деталь заменяют средним). fdA — для цвета;
// fdB — для рельефа, строже: наклон рельефа берётся по квадам 2×2 пикселя, и мелочь даёт «ступеньки» в резких бликах
float fdA(float w) { return 1.0 - smoothstep(0.15, 0.5, w); }
float fdB(float w) { return 1.0 - smoothstep(0.06, 0.2, w); }
float fdAA(vec3 p) { return fdA(fdW(p)); }
float fdAAb(vec3 p) { return fdB(fdW(p)); }
// порог с переходом шириной в пиксель
float fdStep(float e, float x) { float w = fwidth(x) * 0.7 + 1e-4; return smoothstep(e - w, e + w, x); }
// тонкая линия вдоль нуля поля d (полуширина w), f — размер пикселя в единицах d; тоньше пикселя — бледнеет, а не рвётся
float fdLine(float d, float w, float f) { f = max(f, 1e-5); return (1.0 - smoothstep(max(w - 0.5 * f, 0.0), w + 0.5 * f, abs(d))) * min(1.0, 2.0 * w / f); }
`;
// дописать GLSL сразу после #include <chunk> (после enhance): свой лак/блеск/просвет по пикселю; ключ программы — с меткой
function hook(m, tag, adds) {
  const ob = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (s, r) => { ob(s, r); for (const [inc, code] of adds) s.fragmentShader = s.fragmentShader.replace(`#include <${inc}>`, `#include <${inc}>\n${code}`); };
  m.customProgramCacheKey = () => key + '|' + tag;
  return m;
}
// просвет по пикселю (fTr_ — доля, считается в pre): контровой свет проходит сквозь тонкие края и волокна
const TRANSLUCENT = `#if NUM_DIR_LIGHTS > 0
  for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec3 Ld = directionalLights[i].direction;
    float s = pow(saturate(dot(geometryViewDir, -normalize(Ld + normal * 0.5))), 2.0);
    reflectedLight.directDiffuse += uTrCol * directionalLights[i].color * s * fTr_ * diffuseColor.rgb; }
  #endif`;

// искры сока на макушках клеточек: маска по пикселю × узкий блик лака от каждого источника — блик «рассыпается» на капельки
// без ступенек (рельефом такие мелкие искры не сделать: наклон считается по квадам 2×2)
const GLINTS = `
  #ifdef USE_CLEARCOAT
  { float gm = smoothstep(0.5 + 0.2 * fn_, 0.85 + 0.1 * fn_, cnr_) * cA_ * wet_ * smoothstep(-0.2, 0.4, fm_); vec3 gs = vec3(0.0);
    #if NUM_DIR_LIGHTS > 0
    for (int i = 0; i < NUM_DIR_LIGHTS; i++) gs += directionalLights[i].color * pow(saturate(dot(clearcoatNormal, normalize(directionalLights[i].direction + geometryViewDir))), 90.0);
    #endif
    #if NUM_RECT_AREA_LIGHTS > 0
    for (int i = 0; i < NUM_RECT_AREA_LIGHTS; i++) gs += rectAreaLights[i].color * 0.12 * pow(saturate(dot(clearcoatNormal, normalize(normalize(rectAreaLights[i].position + vViewPosition) + geometryViewDir))), 45.0);
    #endif
    reflectedLight.directSpecular += gs * gm * 0.7; }
  #endif`;

// мягкое «колено» для рассеянной части: пересвет не уводит оранжевый в розовый (тонмаппер белит пересвеченный красный,
// синий растёт); оттенок сохраняется, блики (спекуляр, лак) идут поверх как есть
const KNEE = `{ vec3 dd_ = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse; float pk_ = max(dd_.r, max(dd_.g, dd_.b));
  if (pk_ > 0.7) { float k_ = (0.7 + 0.45 * (1.0 - exp(-(pk_ - 0.7) / 0.45))) / pk_; reflectedLight.directDiffuse *= k_; reflectedLight.indirectDiffuse *= k_; } }`;

// кожура: зелёный низ → жёлтый → красный «бочок» крапом; чечевички (гуще у плеча) с микробугорком и ореолом без румянца;
// восковой налёт пятнами (матовее, белесее, бархатный sheen) и потёртые глянцевые места; поры; у черенка — тёмное кольцо и следы сока.
// stem: true — у целого плода (кольцо у черенка), false — для кусков кожуры без черенка
export function skinMat(o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.14, sheen: 0.4, sheenRoughness: 0.5, sheenColor: col('#fff3dc'), side: THREE.FrontSide, ...(o.extra || {}) });
  E3D.enhance(m, {
    scale: 1, bump: o.bump ?? 0.0009, rest: !!o.rest, glsl: FOOD_GLSL,
    uniforms: { uBlush: o.blush ?? 0.85, uRipe: o.ripe ?? 0.25, uStem: o.stem ? 1 : 0 },
    pre: `
      float skN_ = fbm3(P * 2.2);                                            // крупные пятна цвета
      float skM_ = snoise(P * vec3(6.0, 3.5, 6.0) + 3.1);                     // средний масштаб: налёт, потёртости, волнистость
      vec3 lq_ = P * 58.0; float lw_ = fdW(lq_), lA_ = fdA(lw_); float ln_ = snoise(lq_);   // чечевички ~0.6–1 мм
      float lth_ = mix(0.86, 0.68, smoothstep(0.2, 0.9, P.y)) - 0.05 * skN_; // у плеча гуще и крупнее
      float skD_ = mix(0.03, fdStep(lth_, ln_), lA_);                         // светлая точка (вдали — её средняя доля)
      float skHalo_ = mix(0.06, fdStep(lth_ - 0.17, ln_), lA_) - skD_;        // ореол: вокруг точки нет румянца
      float skDome_ = smoothstep(lth_ - 0.05, lth_ + 0.16, ln_) * fdB(lw_);     // микробугорок
      vec3 bq_ = P * vec3(32.0, 20.0, 32.0); float bs_ = snoise(bq_) * fdAA(bq_);   // крап румянца (чуть вытянут вдоль плода)
      vec3 pq_ = P * 120.0; float pr_ = snoise(pq_) * fdAAb(pq_);             // поры / едва заметная «апельсиновая корка»
      vec3 kq_ = P * 23.0 + 17.0; float fk_ = smoothstep(0.82, 0.94, snoise(kq_)) * fdAA(kq_);  // редкие бурые пятнышки
      float bloom_ = smoothstep(-0.45, 0.4, skM_ + skN_ * 0.5);               // восковой налёт (1) / стёрт до глянца (0)
      float sd_ = mix(9.0, length(P - vec3(0.03, 0.975, 0.0)), uStem);       // расстояние до черенка
      float sap_ = 0.0;
      if (uStem > 0.5 && P.y > 0.55) {                                         // подтёки сока от черенка вниз по плечу
        vec2 ad_ = normalize(P.xz - vec2(0.03, 0.0) + 1e-4);
        sap_ = smoothstep(0.5, 0.8, snoise(vec3(ad_ * 3.2, P.y * 0.9 + 4.0))) * smoothstep(0.55, 0.88, P.y) * smoothstep(0.06, 0.1, sd_) * smoothstep(0.45, 0.2, sd_);
      }`,
    color: `
      float t = P.y, s = P.x; float n = skN_;
      vec3 green = srgb(vec3(0.42,0.60,0.15)), yellow = srgb(vec3(0.99,0.76,0.13)), red = srgb(vec3(0.84,0.19,0.09)), wine = srgb(vec3(0.56,0.09,0.06));
      vec3 c = mix(green, yellow, smoothstep(-0.95, 0.1, t + n*0.35 + s*0.3 + uRipe + skM_*0.05));
      float bf = t*0.55 + s*0.75 + n*0.45 + uRipe*0.3;                         // поле румянца
      float bk = smoothstep(0.05, 0.85, bf + bs_ * 0.2 - skHalo_ * 0.3);      // край румянца — крапом, вокруг точек — светлее
      c = mix(c, red, uBlush * bk);
      c = mix(c, wine, uBlush * 0.45 * smoothstep(0.7, 1.3, bf + n*0.3 + bs_*0.1)); // тёмный винный центр румянца
      c *= 0.96 + 0.06 * bs_;
      vec3 lc = mix(srgb(vec3(0.90,0.88,0.52)), srgb(vec3(0.99,0.86,0.56)), bk); // чечевички: на румянце — кремовые и заметнее
      c = mix(c, lc, skD_ * (0.42 + 0.3 * bk));
      c = mix(c, vec3(dot(c, vec3(0.3,0.55,0.15))) * vec3(0.97,1.0,1.03), 0.09 * bloom_); // налёт чуть белесит и холодит
      c = mix(c, srgb(vec3(0.42,0.27,0.08)), fk_ * 0.55);                      // пятнышки
      c = mix(c, srgb(vec3(0.46,0.52,0.13)), uStem * 0.55 * smoothstep(0.17, 0.07, sd_));   // у черенка зеленее
      c = mix(c, srgb(vec3(0.22,0.15,0.06)), 0.75 * smoothstep(0.074, 0.062, sd_) * smoothstep(0.042, 0.05, sd_)); // тёмное кольцо
      c = mix(c, srgb(vec3(0.40,0.20,0.06)), sap_ * 0.35);                    // подсохший сок
      diffuseColor.rgb = c;`,
    height: 'skM_ * 0.35 + skDome_ * 0.45 + pr_ * 0.18 - fk_ * 0.2 + sap_ * 0.3 - uStem * 9.0 * smoothstep(0.13, 0.055, sd_)',
    rough: 'roughnessFactor = roughness + 0.16 * bloom_ - 0.06 + 0.12 * skD_ - 0.12 * sap_;',
    sss: { color: '#ffb040', strength: 0.55, power: 3.5, ambient: 0.05 },
  });
  // налёт: лак слабее и шире, бархат ярче; потёртости и сок — глянцевее
  return hook(m, 'skin', [['lights_physical_fragment', `
    #ifdef USE_CLEARCOAT
      material.clearcoat *= mix(1.15, 0.5, bloom_) * (1.0 - 0.4 * skD_);
      material.clearcoatRoughness = min(material.clearcoatRoughness + 0.12 * bloom_ + 0.1 * skD_ - 0.05 * sap_, 1.0);
    #endif
    #ifdef USE_SHEEN
      material.sheenColor *= 0.35 + 1.1 * bloom_;
    #endif`]]);
}

// мякоть: глубокий оранжевый к центру, светлее к краю; тонкие нити-волокна вдоль плода (видны на просвет и в бликах),
// клеточки-«пузырьки» сока (дробят блики на искры), пятна насыщенности; плёнка сока с микроволнами и подсохшие участки;
// края светлее и просвечивают; у косточки — светлее и волокнистее. Синий канал почти ноль — мякоть не «розовеет».
export function fleshMat(o = {}) {
  // база почти без спекуляра (иначе широкий блик от светлых панелей «белит» мякоть до розового), мокрые блики — от лака
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.45, specularIntensity: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, ...(o.extra || {}) });
  E3D.enhance(m, {
    scale: 1, bump: o.bump ?? 0.004, coatBump: o.wet ?? 0.014, seed: !!o.seed, rest: !!o.rest, glsl: FOOD_GLSL,
    uniforms: { uC: new THREE.Vector2(...(o.center || [0, 0])), uRad: new THREE.Vector2(...(o.radius || [0.6, 0.9])), uSeedR: o.seedR ?? 0.0, uDeep: o.deep || '#ff8500', uLight: o.light || '#ffc42e', uTrCol: o.trColor || '#ffa62a' },
    pre: `vec2 fq_ = (vE3dP.xy - uC) / uRad; float fr_ = length(fq_);
      float fn_ = fbm3(vec3(fq_ * 3.0, 1.7) + vE3dSeed * 3.0);                         // крупные пятна: насыщенность, влажность
      float fm_ = snoise(vec3(fq_ * 7.0, 5.0) + vE3dSeed * 2.0);                       // средний масштаб: микроволны плёнки
      // волокна: вдоль длинной оси, чуть волнистые; нить — ноль растянутого шума, сглаженный по пикселю
      vec3 fa_ = vec3((vE3dP.x + fn_ * 0.006) * 110.0, vE3dP.y * 3.0, vE3dP.z * 110.0) + vE3dSeed * 5.0;   // тонкие, шаг ~0.6 мм
      vec3 fb_ = fa_ * vec3(0.45, 1.3, 0.45) + 7.3;                                                         // пучки покрупнее
      float f1_ = snoise(fa_), f2_ = snoise(fb_), w1_ = fdW(fa_), w2_ = fdW(fb_), fA1_ = fdA(w1_), fA2_ = fdA(w2_);
      float sd_ = length(fq_ * vec2(1.6, 1.0)) + f1_ * 0.012 + fn_ * 0.04;               // косточка: вытянутая
      float hasSeed_ = step(0.001, uSeedR);
      float near_ = mix(1.0 - smoothstep(0.1, 0.8, fr_), smoothstep(uSeedR + 0.4, uSeedR + 0.02, sd_), hasSeed_); // «у косточки»
      float th_ = (fdLine(f1_, 0.12, fwidth(f1_)) * fA1_ * 0.6 + fdLine(f2_, 0.14, fwidth(f2_)) * fA2_ * 0.45) * (0.5 + 0.6 * near_);
      float fib_ = f1_ * fA1_ * 0.4 + f2_ * fA2_ * 0.6, fibB_ = f1_ * fdB(w1_) * 0.4 + f2_ * fdB(w2_) * 0.6;  // тон / рельеф
      // клеточки сока: сеть стенок вокруг выпуклых ячеек (0 — стенка, 1 — центр)
      vec3 cq_ = vec3(vE3dP.x * 55.0, vE3dP.y * 36.0, vE3dP.z * 55.0 + 3.0) + vE3dSeed * 9.0;   // ячейки ~1 мм, вытянуты вдоль волокон
      float wc_ = fdW(cq_), cA_ = fdA(wc_), cB_ = fdB(wc_), cnr_ = snoise(cq_);
      float cel_ = mix(0.6, smoothstep(0.0, 0.55, abs(cnr_)), cA_);
      float wet_ = smoothstep(-0.4, 0.1, fn_ * 0.8 + fm_ * 0.35);                    // мокро (1) / подсохло (0)
      float fTr_ = 0.3 * smoothstep(0.8, 0.98, fr_) + 0.06 * th_;                      // просвет: тонкий край и нити
      float seedM_ = smoothstep(uSeedR + 0.06, uSeedR - 0.03, sd_) * hasSeed_;           // скорлупа косточки
      float husk_ = fib_ * 1.4 + th_ * 0.8 - 0.3;                                       // скорлупа: грубые продольные волокна`,
    color: `
      vec3 deep = uDeep, light = uLight;                                                  // центр среза / край
      vec3 c = mix(deep, light, clamp(smoothstep(0.0, 1.0, fr_) * 0.7 + fn_ * 0.25 + fm_ * 0.05, 0.0, 1.0));
      c *= vec3(1.0, 0.95 + 0.08 * fm_ + 0.04 * fn_, 1.0);                                // насыщенность: то краснее, то желтее
      c *= 0.93 + 0.08 * fib_;
      c = mix(c, light * vec3(1.0, 1.06, 0.5), th_ * 0.16 + hasSeed_ * near_ * 0.22);     // нити и зона у косточки — светлее и желтее
      c *= 0.96 + 0.04 * cel_;                                                             // стенки клеточек чуть темнее
      c = mix(c, srgb(vec3(1.0, 0.86, 0.5)) * (0.82 + 0.16 * husk_), seedM_);
      c = mix(c, light * vec3(1.0, 1.06, 0.8), 0.3 * smoothstep(0.86, 0.95, fr_));       // светлый слой под кожицей
      c = mix(c, srgb(vec3(0.78, 0.72, 0.20)), smoothstep(0.955, 0.99, fr_));             // кожица по краю
      diffuseColor.rgb = c;`,
    height: 'fn_ * 0.6 + fibB_ * 0.15 + th_ * fdB(w1_) * 0.1 + (cel_ - 0.6) * 0.03 * cB_ + seedM_ * (fibB_ * 1.4 - 0.3) * 0.25',
    coat: 'fn_ * 0.8 + fm_ * 0.25 + fibB_ * 0.04',
    rough: 'roughnessFactor = mix(0.5, 0.34, wet_) + 0.05 * (1.0 - cel_);',
    sss: { color: o.sssColor || '#ff9a10', strength: o.sss ?? 0.75, power: 2.4, distortion: 0.4, ambient: 0.09 }, // сильнее — красный канал клиппится и мякоть «розовеет» при тонмаппинге
  });
  // подсохшие места: лак тоньше и чуть матовее (не шире — широкий белый блик «розовит»); просвет краёв и нитей
  return hook(m, 'flesh', [
    ['lights_physical_fragment', `
    #ifdef USE_CLEARCOAT
      material.clearcoat *= mix(0.22, 1.0, wet_);
      material.clearcoatRoughness = min(material.clearcoatRoughness + 0.1 * (1.0 - wet_), 1.0);
    #endif`],
    ['lights_fragment_end', TRANSLUCENT + GLINTS],
    ['aomap_fragment', KNEE],
  ]);
}

/* ------------------------------ форма манго ------------------------------ */
// точка единичной сферы → поверхность манго (высота ~1.96, ширина ~1.45, толщина ~1.16; «плечо» и «носик»)
function mangoPt(x, y, z) {
  const nb = Math.max(0, -y);
  let X = x * 0.7 * (1 - 0.16 * nb ** 1.5), Y = y * 0.98, Z = z * 0.58 * (1 - 0.14 * nb ** 2);
  X += 0.07 * (1 - y * y);
  X -= 0.22 * nb ** 2.4;
  Y += 0.05 * x;
  return [X, Y, Z];
}
let mangoGeoCache = null;
function mangoGeometry() {
  if (mangoGeoCache) return mangoGeoCache;
  let g = new THREE.SphereGeometry(1, 160, 120);
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const [x, y, z] = mangoPt(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, x, y, z); }
  g.computeVertexNormals();
  g.computeBoundingBox();
  return (mangoGeoCache = g);
}
const MANGO_LIFT = 0.98; // чтобы стояло на полу (низ ≈ -0.98)
// точка поверхности манго по долготе/широте (рад): {p, n} в координатах манго (для капель на кожуре — добавляй их в mango().userData.inner)
export function mangoSurface(lon, lat) {
  const P = (a, b) => new V3(...mangoPt(Math.sin(a) * Math.cos(b), Math.sin(b), Math.cos(a) * Math.cos(b)));
  const p = P(lon, lat), e = 1e-3, du = P(lon + e, lat).sub(p), dv = P(lon, lat + e).sub(p);
  const n = du.cross(dv).normalize();
  return { p: [p.x, p.y, p.z], n: [n.x, n.y, n.z] };
}

// черенок: утолщение-«пуговка» у плода, тонкая шейка, узелок; волокнистая кора вдоль, сверху — шрам среза (древесина, кольцо коры)
const STEM_BEND = 0.9; // наклон черенка: x += k·y²
function stemMesh() {
  const prof = [[0.0, -0.03], [0.07, -0.03], [0.074, -0.008], [0.062, 0.01], [0.046, 0.028], [0.038, 0.055], [0.035, 0.095], [0.039, 0.118], [0.037, 0.135], [0.03, 0.146], [0.012, 0.149], [0.0, 0.149]];
  const pts = new THREE.SplineCurve(prof.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(48);
  pts[0].set(0, -0.03); pts[pts.length - 1].set(0, 0.149);
  const geo = new THREE.LatheGeometry(pts, 40);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = Math.max(0, p.getY(i)); p.setX(i, p.getX(i) + STEM_BEND * y * y * 0.5); }
  geo.computeVertexNormals();
  const tx = (STEM_BEND * 0.149 * 0.149 * 0.5).toFixed(4);
  const m = E3D.enhance(new THREE.MeshPhysicalMaterial({ roughness: 0.72, sheen: 0.3, sheenRoughness: 0.6, sheenColor: col('#d8c8a8') }), {
    bump: 0.0012, glsl: FOOD_GLSL,
    pre: `float sy_ = vE3dP.y; vec2 sa_ = normalize(vE3dP.xz - vec2(${(STEM_BEND * 0.5).toFixed(3)} * max(sy_, 0.0) * max(sy_, 0.0), 0.0) + 1e-4);
      vec3 sq_ = vec3(sa_ * 13.0, sy_ * 7.0); float s1_ = snoise(vec3(sa_ * 4.0, sy_ * 3.0)), s2_ = snoise(sq_) * fdAA(sq_);
      float sf_ = s1_ * 0.55 + s2_ * 0.45;                                                // волокна коры вдоль черенка
      float top_ = smoothstep(0.55, 0.85, N0.y) * smoothstep(0.125, 0.14, sy_);           // срез сверху
      float rr_ = length(vE3dP.xz - vec2(${tx}, 0.0)) / 0.03;                              // 0 — центр среза, 1 — кора
      float base_ = smoothstep(0.03, -0.01, sy_);                                         // «пуговка» у плода`,
    color: `
      vec3 c = mix(srgb(vec3(0.27, 0.18, 0.09)), srgb(vec3(0.46, 0.33, 0.17)), 0.5 + 0.5 * sf_);
      c = mix(c, srgb(vec3(0.36, 0.38, 0.13)), base_ * 0.75);                              // у плода — зеленоватая
      c = mix(c, c * 0.6, smoothstep(0.112, 0.118, sy_) * smoothstep(0.128, 0.122, sy_) * 0.6); // перетяжка-узелок
      vec3 wood = mix(srgb(vec3(0.70, 0.58, 0.36)), srgb(vec3(0.52, 0.40, 0.22)), 0.5 + 0.5 * sin(rr_ * 14.0 + s1_ * 2.0) * 0.6);
      wood = mix(wood, srgb(vec3(0.30, 0.20, 0.10)), smoothstep(0.75, 0.9, rr_) + smoothstep(0.2, 0.05, rr_) * 0.7); // кольцо коры, сердцевина
      c = mix(c, wood, top_);
      diffuseColor.rgb = c;`,
    height: 'sf_ * 0.8 * (1.0 - top_) + top_ * sin(rr_ * 14.0) * 0.15 - base_ * s1_ * 0.3',
    rough: 'roughnessFactor = mix(0.72, 0.85, top_) - 0.1 * base_;',
  });
  return sh(new THREE.Mesh(geo, m));
}

// лист: средняя жилка (выпуклая, светлая), вторичные жилки ёлочкой (продавлены, загибаются к верхушке), краевая жилка,
// мелкая сетка третичных жилок; восковой глянец; неровный волнистый край; изнанка светлее и матовее
const LEAF_W = (y) => 0.115 * Math.pow(Math.sin(Math.PI * Math.pow(Math.min(1, Math.max(0, y / 0.82)), 0.85)), 0.8) + 0.004;
function leafMesh() {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.bezierCurveTo(0.12, 0.18, 0.14, 0.55, 0, 0.82); s.bezierCurveTo(-0.14, 0.55, -0.12, 0.18, 0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 48 });
  const pp = geo.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const y = pp.getY(i), x = pp.getX(i), e = Math.min(1, Math.abs(x) / LEAF_W(y)), e2 = e * e;
    pp.setX(i, x + Math.sign(x) * e2 * 0.0035 * Math.sin(y * 47 + (x > 0 ? 0 : 1.7)));                    // неровный край
    pp.setZ(i, pp.getZ(i) + 0.22 * y * y - 0.35 * x * x + e2 * 0.012 * Math.sin(y * 23 + (x > 0 ? 0.4 : 2.1))); // изгиб и волна по краю
  }
  geo.computeVertexNormals();
  const lm = E3D.enhance(new THREE.MeshPhysicalMaterial({ roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.12, side: THREE.DoubleSide }), {
    bump: 0.0007, glsl: FOOD_GLSL,
    pre: `vec2 lp_ = vE3dP.xy; float ly_ = clamp(lp_.y / 0.82, 0.0, 1.0);
      float lw_ = 0.115 * pow(sin(3.14159 * pow(ly_, 0.85)), 0.8) + 0.004;              // полуширина листа на этой высоте
      float lx_ = clamp(abs(lp_.x) / lw_, 0.0, 1.0);                                     // 0 — средняя жилка, 1 — край
      float mid_ = fdLine(lp_.x, 0.0055 * (1.0 - 0.75 * ly_) + 0.0012, fwidth(lp_.x));
      float vs_ = lp_.y - 0.62 * abs(lp_.x) - 4.5 * lp_.x * lp_.x;                       // вторичные: от средней к краю и вверх
      float vk_ = vs_ / 0.033 + 0.5 * step(0.0, lp_.x) + 0.25 * sin(ly_ * 9.0);            // слева/справа — вразбежку
      float sec_ = fdLine((fract(vk_) - 0.5) * 0.033, 0.0011 * (1.3 - 0.8 * lx_), fwidth(vs_)) * (1.0 - smoothstep(0.82, 0.96, lx_)) * smoothstep(0.03, 0.08, ly_);
      float rim_ = fdLine(lx_ - 0.9, 0.012, fwidth(lx_)) * 0.6;                           // краевая жилка
      vec3 tq_ = vec3(lp_ * 120.0, 1.0); float tn_ = snoise(tq_);
      float ter_ = fdLine(tn_, 0.13, fwidth(tn_)) * fdAA(tq_);                             // сетка третичных жилок
      float lv_ = snoise(vec3(lp_ * vec2(9.0, 5.0), 2.0));                                // неравномерность цвета`,
    color: `
      vec3 c = mix(srgb(vec3(0.06, 0.19, 0.04)), srgb(vec3(0.16, 0.33, 0.07)), clamp(0.4 + 0.3 * lv_ + 0.3 * (1.0 - ly_) * lx_, 0.0, 1.0));
      c = mix(c, srgb(vec3(0.27, 0.44, 0.12)), sec_ * 0.6 + rim_ * 0.4);
      c = mix(c, c * 1.3, ter_ * 0.22);
      c = mix(c, srgb(vec3(0.55, 0.62, 0.28)), mid_ * 0.9);
      c = mix(c, srgb(vec3(0.42, 0.46, 0.14)), smoothstep(0.93, 1.0, lx_) * 0.55);       // желтоватая кайма края
      if (!gl_FrontFacing) c = mix(c, srgb(vec3(0.30, 0.44, 0.17)), 0.5);                // изнанка светлее
      diffuseColor.rgb = c;`,
    height: 'mid_ * 1.2 - sec_ * 0.7 - rim_ * 0.3 - ter_ * 0.2 + lv_ * 0.15',
    rough: 'roughnessFactor = 0.4 + 0.12 * sec_ + 0.08 * ter_ + (gl_FrontFacing ? 0.0 : 0.2);',
    sss: { color: '#9be34a', strength: 0.8, power: 2 },
  });
  return sh(new THREE.Mesh(geo, lm));
}

function stemAndLeaf(o = {}) {
  const g = new THREE.Group();
  const stem = stemMesh();
  stem.position.set(0.03, 0.975, 0);
  g.add(stem);
  if (o.leaf !== false) {
    const leaf = leafMesh();
    leaf.position.set(0.04, 1.08, 0.02); leaf.rotation.set(-0.5, 0.3, -1.05);
    g.add(leaf);
  }
  return g;
}

// целое манго: группа, низ на полу (y=0)
export function mango(o = {}) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = MANGO_LIFT;
  inner.add(sh(new THREE.Mesh(mangoGeometry(), o.skin || skinMat({ stem: true, ...o }))));
  inner.add(stemAndLeaf(o));
  g.add(inner);
  g.userData.inner = inner;
  return g;
}

/* ------------------------------ разрез ------------------------------ */
// сечение геометрии плоскостью z = c: возвращает центр и контур (радиус по углу), чтобы построить «крышку» с мякотью
function section(geo, c) {
  const p = geo.attributes.position, idx = geo.index.array, pts = [];
  const v = [new V3(), new V3(), new V3()];
  for (let i = 0; i < idx.length; i += 3) {
    for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(p, idx[i + k]);
    for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3]; const da = a.z - c, db = b.z - c; if ((da < 0) !== (db < 0)) { const f = da / (da - db); pts.push([a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f]); } }
  }
  const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length, cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
  const N = 256, R = new Array(N).fill(0);
  for (const [x, y] of pts) { const a = Math.atan2(y - cy, x - cx); const k = Math.round(((a + Math.PI) / (2 * Math.PI)) * N) % N; R[k] = Math.max(R[k], Math.hypot(x - cx, y - cy)); }
  for (let k = 0; k < N; k++) if (!R[k]) { let j = 1; while (!R[(k + j) % N] && j < N) j++; R[k] = R[(k + j) % N]; }
  const rx = Math.max(...pts.map((q) => Math.abs(q[0] - cx))), ry = Math.max(...pts.map((q) => Math.abs(q[1] - cy)));
  return { cx, cy, R, N, rx, ry };
}
// «крышка» среза — радиальная сетка (кольца), чтобы шейдер мякоти считал расстояние до края
function capGeometry(sec, z, facing) {
  const { cx, cy, R, N } = sec, K = 28, pos = [], nrm = [], ind = [];
  pos.push(cx, cy, z); nrm.push(0, 0, facing);
  for (let r = 1; r <= K; r++) for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * Math.PI - Math.PI, f = r / K, rr = R[k] * 0.999 * f;
    pos.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z); nrm.push(0, 0, facing);
  }
  const at = (r, k) => (r === 0 ? 0 : 1 + (r - 1) * N + (k % N));
  for (let r = 0; r < K; r++) for (let k = 0; k < N; k++) {
    if (r === 0) ind.push(0, at(1, k), at(1, k + 1));
    else { const a = at(r, k), b = at(r, k + 1), c2 = at(r + 1, k), d = at(r + 1, k + 1); ind.push(a, c2, b, b, c2, d); }
  }
  if (facing < 0) for (let i = 0; i < ind.length; i += 3) { const t = ind[i + 1]; ind[i + 1] = ind[i + 2]; ind[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(ind);
  return g;
}
// разрезанное манго: «щёчка» (cheek, z > c) и тело с косточкой (body). Каждая — группа с центром вращения в центре среза.
// Обрезка кожуры — clipping-плоскости, они пересчитываются вместе с движением частей.
export function mangoCut(o = {}) {
  const c = o.cut ?? 0.17, geo = mangoGeometry(), sec = section(geo, c);
  const make = (side) => {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    const local = new THREE.Plane(new V3(0, 0, side), -side * c);
    const sm = o.skin ? o.skin.clone() : skinMat({ stem: true, ...o });
    if (o.skin) { sm.onBeforeCompile = o.skin.onBeforeCompile; sm.customProgramCacheKey = o.skin.customProgramCacheKey; sm.userData = o.skin.userData; }
    sm.clippingPlanes = [local.clone()]; sm.clipShadows = true;
    const skin = sh(new THREE.Mesh(geo, sm));
    const fm = fleshMat({ center: [sec.cx, sec.cy], radius: [sec.rx, sec.ry], seedR: side < 0 ? 0.42 : 0 });
    const cap = sh(new THREE.Mesh(capGeometry(sec, c, -side), fm));
    inner.add(skin, cap);
    if (side < 0) inner.add(stemAndLeaf(o));
    inner.position.set(-sec.cx, -sec.cy, -c);
    g.add(inner);
    g.position.set(sec.cx, sec.cy + MANGO_LIFT, c);
    g.userData = {
      flesh: fm, skin: sm,
      tick: () => { inner.updateWorldMatrix(true, false); sm.clippingPlanes[0].copy(local).applyMatrix4(inner.matrixWorld); },
    };
    return g;
  };
  return { cheek: make(1), body: make(-1), section: sec, cutZ: c, lift: MANGO_LIFT };
}

/* ------------------------------ «ёжик» ------------------------------ */
// Как в жизни: щёчку надрезают сеткой до кожуры (не насквозь) и выворачивают. Столбики мякоти приросли к кожуре —
// у основания соседи касаются (щель — только линия ножа), к верхушкам щели раскрываются клиньями.
// Высота столбика — настоящая толщина щёчки (в центре толще, к краю сходит на нет), краевые обрезаны контуром плода.
// setK(0) — ровный надрезанный срез (кожура — чаша), setK(1) — кожура вывернута куполом. Пересчёт на CPU, узор мякоти — по aRest.

// толщина щёчки за плоскостью разреза z = c: карта высот поверхности манго, h(x, y) в координатах манго
function cheekHeight(c) {
  const N = 160, X0 = -0.9, X1 = 0.9, Y0 = -1.08, Y1 = 1.08, H = new Float32Array(N * N).fill(-1);
  for (let i = 0; i <= 900; i++) for (let j = 0; j <= 450; j++) {
    const lon = -Math.PI / 2 + (Math.PI * i) / 900, lat = -Math.PI / 2 + (Math.PI * j) / 450;
    const [x, y, z] = mangoPt(Math.sin(lon) * Math.cos(lat), Math.sin(lat), Math.cos(lon) * Math.cos(lat));
    const a = Math.round(((x - X0) / (X1 - X0)) * (N - 1)), b = Math.round(((y - Y0) / (Y1 - Y0)) * (N - 1));
    if (a >= 0 && a < N && b >= 0 && b < N && z - c > H[b * N + a]) H[b * N + a] = z - c;
  }
  for (let pass = 0; pass < 2; pass++) { // лёгкое сглаживание (сглаживает дискретизацию сетки)
    const S = H.slice();
    for (let b = 1; b < N - 1; b++) for (let a = 1; a < N - 1; a++) {
      let s = 0; for (let db = -1; db <= 1; db++) for (let da = -1; da <= 1; da++) s += Math.max(0, S[(b + db) * N + a + da]);
      if (S[b * N + a] > 0) H[b * N + a] = s / 9;
    }
  }
  return (x, y) => {
    const fx = Math.min(N - 1.001, Math.max(0, ((x - X0) / (X1 - X0)) * (N - 1))), fy = Math.min(N - 1.001, Math.max(0, ((y - Y0) / (Y1 - Y0)) * (N - 1)));
    const a = Math.floor(fx), b = Math.floor(fy), u = fx - a, v = fy - b, q = (i, j) => Math.max(0, H[j * N + i]);
    return (q(a, b) * (1 - u) + q(a + 1, b) * u) * (1 - v) + (q(a, b + 1) * (1 - u) + q(a + 1, b + 1) * u) * v;
  };
}

export function hedgehog(o = {}) {
  const cz = o.cut ?? 0.17, sec = section(mangoGeometry(), cz), hm = cheekHeight(cz), { cx, cy } = sec;
  const step = o.step ?? 0.21, kerf = o.kerf ?? 0.003, sink = 0.035, bevel = o.bevel ?? 0.02, bulge = o.bulge ?? 0;
  const dome = o.dome ?? 0.7, tilt = o.tilt ?? 0.6, skinT = 0.014; // высота купола (доля толщины), доля наклона «чаши», толщина кожуры
  const h = (x, y) => hm(x + cx, y + cy); // локальные координаты: центр среза в (0, 0)
  const Rof = (x, y) => { const k = ((Math.atan2(y, x) + Math.PI) / (2 * Math.PI)) * sec.N, k0 = Math.floor(k), f = k - k0; return sec.R[k0 % sec.N] * (1 - f) + sec.R[(k0 + 1) % sec.N] * f; };
  // сетка ножа: чуть повёрнута и сдвинута, линии слегка «гуляют» (рука не идеальна)
  const ga = o.gridAngle ?? 0.07, ca = Math.cos(ga), sa = Math.sin(ga), ox = step * 0.31, oy = step * 0.47;
  const toPlane = (gx, gy) => {
    const x = gx * ca - gy * sa + ox, y = gx * sa + gy * ca + oy;
    return [x + 0.006 * Math.sin(y * 7.3 + 1.1) + 0.003 * Math.sin(y * 17.0), y + 0.006 * Math.sin(x * 6.1 + 2.3) + 0.003 * Math.sin(x * 15.0 + 0.7)];
  };
  // мякоть мягкая: бока чуть волнистые, без идеальных плоскостей (детерминированная сумма синусов)
  const wob = (x, y, z, s) => 0.5 * Math.sin(x * 37.1 + y * 11.3 + z * 23.7 + s) + 0.3 * Math.sin(-x * 19.7 + y * 41.9 - z * 13.1 + 2 * s) + 0.2 * Math.sin(x * 61.3 - y * 29.1 + z * 47.9 + 3 * s);
  const clip = (p, e) => { const r = Math.hypot(p[0], p[1]), lim = Rof(p[0], p[1]) * 0.985 - e; return r > lim ? [(p[0] * lim) / r, (p[1] * lim) / r] : p; };

  // столбики: кольца суперэллипса (скруглённый квадрат) от основания (утоплено в кожуру) до верхушки с фаской
  const NR = 48, SE = 2 / 9, D_FIXED = [-sink, 0, 0.012, 0.03, 0.06, 0.1], BEV = [0, 0.3, 0.6, 0.85, 1];
  const RINGS = D_FIXED.length + BEV.length;
  const pos = [], rest = [], meta = [], idx = [], cols = [];
  seed = 47;
  const span = Math.ceil(1.1 / step) + 2;
  for (let i = -span; i <= span; i++) for (let j = -span; j <= span; j++) {
    let inside = 0;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) { const p = toPlane((i + (a + 0.5) / 5) * step, (j + (b + 0.5) / 5) * step); if (Math.hypot(p[0], p[1]) < Rof(p[0], p[1]) * 0.97 && h(p[0], p[1]) > 0.012) inside++; }
    if (inside < 8) continue; // обрезки меньше трети ячейки — отбрасываем
    const base = pos.length / 3, gc = [(i + 0.5) * step, (j + 0.5) * step], ring = [];
    for (let r = 0; r < RINGS; r++) {
      const isBev = r >= D_FIXED.length, bf = isBev ? BEV[r - D_FIXED.length] : 0;
      for (let k = 0; k < NR; k++) {
        const f = (k / NR) * Math.PI * 2, cu = Math.cos(f), su = Math.sin(f);
        // фаска: радиус ограничен высотой столбика в этой точке; inset по четверти окружности
        const p0 = toPlane(gc[0] + Math.sign(cu) * Math.abs(cu) ** SE * (step / 2 - kerf), gc[1] + Math.sign(su) * Math.abs(su) ** SE * (step / 2 - kerf));
        // фаска неровная: мякоть по краю где-то смята, где-то острее
        const hh0 = h(...clip(p0, 0)), rb = Math.min(bevel * (0.55 + 0.45 * (0.5 + 0.5 * wob(p0[0], p0[1], 0, 7.7))), 0.45 * hh0), e = isBev ? rb * (1 - Math.cos(bf * Math.PI / 2)) : 0;
        const hs = step / 2 - kerf - e;
        const p = clip(toPlane(gc[0] + Math.sign(cu) * Math.abs(cu) ** SE * hs, gc[1] + Math.sign(su) * Math.abs(su) ** SE * hs), e);
        const hh = h(p[0], p[1]);
        const d = isBev ? hh - rb + rb * Math.sin(bf * Math.PI / 2) : Math.min(D_FIXED[r], Math.max(-sink, hh - rb));
        const wk = Math.min(1, Math.max(0, (d - 0.02) / 0.05)) * 0.006; // у основания не трогаем — там столбики касаются
        const q = [p[0] + wk * (wob(p[0], p[1], d, 1.3) + 0.6 * Math.sin(d * 9.0 + p[1] * 5.0 + i)), p[1] + wk * (wob(p[1], p[0], d, 4.1) + 0.6 * Math.sin(d * 8.0 + p[0] * 6.0 + j))];
        pos.push(0, 0, 0); rest.push(q[0] + cx, q[1] + cy, d - hh); meta.push(q[0], q[1], d, hh);
        if (r === RINGS - 1) ring.push(q);
      }
    }
    // крышка (бывший срез) — внутренние кольца к центру с лёгкой выпуклостью: мякоть чуть вспучивается
    const cxr = ring.reduce((s, q) => s + q[0], 0) / NR, cyr = ring.reduce((s, q) => s + q[1], 0) / NR;
    const CAP = [0.72, 0.44, 0.18];
    for (const f of CAP) for (let k = 0; k < NR; k++) {
      const x = cxr + (ring[k][0] - cxr) * f, y = cyr + (ring[k][1] - cyr) * f, hh = h(x, y), z = bulge * (1 - f * f) * Math.min(1, hh / 0.12);
      pos.push(0, 0, 0); rest.push(x + cx, y + cy, z); meta.push(x, y, hh + z, hh);
    }
    const hc = h(cxr, cyr), zc = bulge * Math.min(1, hc / 0.12);
    pos.push(0, 0, 0); rest.push(cxr + cx, cyr + cy, zc); meta.push(cxr, cyr, hc + zc, hc);
    const NRING = RINGS + CAP.length;
    for (let r = 0; r < NRING - 1; r++) for (let k = 0; k < NR; k++) {
      const a = base + r * NR + k, b = base + r * NR + ((k + 1) % NR), c2 = a + NR, d2 = b + NR;
      idx.push(a, b, d2, a, d2, c2);
    }
    const top = base + (NRING - 1) * NR, ctr = base + NRING * NR;
    for (let k = 0; k < NR; k++) idx.push(ctr, top + k, top + ((k + 1) % NR));
    cols.push({ from: base, to: ctr + 1, c: [cxr, cyr], jit: [rnd() * Math.PI * 2, 0.4 + rnd() * 0.6] });
  }

  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(pos.length), M = new Float32Array(meta);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('aRest', new THREE.Float32BufferAttribute(rest, 3));
  geo.setIndex(idx);
  const fm = o.flesh || fleshMat({ center: [cx, cy], radius: [sec.rx, sec.ry], rest: true, bump: 0.003, wet: 0.01, deep: o.deep || '#ff9400', light: o.light || '#ffbf1a', extra: { specularIntensity: 0.4, clearcoat: 0.85 } });
  const flesh = sh(new THREE.Mesh(geo, fm));
  const g = new THREE.Group();
  g.add(flesh);

  // кожура: внешняя (кожица, смотрит вниз-наружу), внутренняя (светлый подкожный слой между основаниями) и кромка толщины
  const RING = 28, SEG = 128, nS = 1 + RING * SEG, sk = [];
  for (let r = 0; r <= RING; r++) for (let s = 0; s < (r ? SEG : 1); s++) {
    const a = (s / SEG) * Math.PI * 2 - Math.PI, f = r / RING, R = Rof(Math.cos(a), Math.sin(a)) * 0.985 * f;
    sk.push([Math.cos(a) * R, Math.sin(a) * R]);
  }
  const skIdx = [];
  for (let r = 0; r < RING; r++) for (let s = 0; s < SEG; s++) {
    const at = (rr, ss) => (rr === 0 ? 0 : 1 + (rr - 1) * SEG + (ss % SEG));
    if (r === 0) skIdx.push(0, at(1, s + 1), at(1, s));
    else skIdx.push(at(r, s), at(r + 1, s + 1), at(r + 1, s), at(r, s), at(r, s + 1), at(r + 1, s + 1));
  }
  const mkSkin = (mat) => {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nS * 3), 3));
    sg.setAttribute('aRest', new THREE.Float32BufferAttribute(sk.flatMap(([x, y]) => [x + cx, y + cy, cz + h(x, y)]), 3));
    sg.setIndex(skIdx);
    return sh(new THREE.Mesh(sg, mat));
  };
  const outer = mkSkin(o.skin || skinMat({ blush: 0.6, rest: true }));
  outer.material.side = THREE.DoubleSide;
  const inner = mkSkin(new THREE.MeshPhysicalMaterial({ color: col('#e8a52a'), roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.1, side: THREE.DoubleSide }));
  inner.receiveShadow = true;
  const rimGeo = new THREE.BufferGeometry(), rimIdx = [];
  rimGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3));
  for (let s = 0; s < SEG; s++) { const a = s * 2, b = ((s + 1) % SEG) * 2; rimIdx.push(a, b, a + 1, b, b + 1, a + 1); }
  rimGeo.setIndex(rimIdx);
  const rim = sh(new THREE.Mesh(rimGeo, new THREE.MeshPhysicalMaterial({ color: col('#e9d27a'), roughness: 0.5, side: THREE.DoubleSide })));
  g.add(outer, inner, rim);

  // поверхность кожуры при выворачивании k: z = m·h(x, y), m: −1 (чаша) → dome (купол)
  const mOf = (k) => -1 + (1 + dome) * k;
  const grad = (x, y) => { const e = 0.012; return [(h(x + e, y) - h(x - e, y)) / (2 * e), (h(x, y + e) - h(x, y - e)) / (2 * e)]; };
  const frame = (x, y, m) => {
    const [hx, hy] = grad(x, y), t1 = new V3(1, 0, m * hx).normalize(), n = new V3(-m * hx, -m * hy, 1).normalize(), t2 = new V3().crossVectors(n, t1);
    return new THREE.Matrix4().makeBasis(t1, t2, n);
  };
  const R = new THREE.Matrix4(), J = new THREE.Matrix4(), v = new V3(), w3 = new V3(), up = new V3();
  g.userData.setK = (k) => {
    const m = mOf(k);
    for (const cl of cols) {
      const [xc, yc] = cl.c;
      // поворот столбика = поворот участка кожуры под ним (наклон «чаши» учтён частично — tilt), плюс лёгкий разнобой
      R.copy(frame(xc, yc, tilt * m)).multiply(J.makeRotationAxis(up.set(Math.cos(cl.jit[0]), Math.sin(cl.jit[0]), 0), 0.1 * cl.jit[1] * Math.max(0, k))).multiply(frame(xc, yc, -tilt).transpose());
      const B0z = -h(xc, yc), Bkz = m * h(xc, yc);
      cl.R = (cl.R || new THREE.Matrix4()).copy(R); cl.B = [xc, yc, Bkz, B0z];
      for (let i = cl.from; i < cl.to; i++) {
        const x = M[i * 4], y = M[i * 4 + 1], d = M[i * 4 + 2], hh = M[i * 4 + 3];
        v.set(x - xc, y - yc, d - hh - B0z).applyMatrix4(R).add(w3.set(xc, yc, Bkz)); // жёстко с центром основания
        const fw = Math.min(1, Math.max(0, d / 0.08)), s = fw * fw * (3 - 2 * fw);
        if (s < 1) { w3.set(0, 0, d).applyMatrix4(R).add(up.set(x, y, m * hh)); v.lerp(w3, 1 - s); } // у кожуры — точно по куполу: соседи касаются
        P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      }
    }
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
    const op = outer.geometry.attributes.position, ip = inner.geometry.attributes.position, rp = rimGeo.attributes.position;
    sk.forEach(([x, y], i) => {
      const [hx, hy] = grad(x, y), n = v.set(-m * hx, -m * hy, 1).normalize(), z = m * h(x, y);
      ip.setXYZ(i, x, y, z); op.setXYZ(i, x - n.x * skinT, y - n.y * skinT, z - n.z * skinT);
      if (i >= nS - SEG) { const s = i - (nS - SEG); rp.setXYZ(s * 2, x, y, z); rp.setXYZ(s * 2 + 1, x - n.x * skinT, y - n.y * skinT, z - n.z * skinT); }
    });
    for (const mm of [outer, inner, rim]) { const gg = mm.geometry; gg.attributes.position.needsUpdate = true; gg.computeVertexNormals(); gg.computeBoundingSphere(); }
  };
  // капли сока выступают на верхушках, когда ёжик выворачивается (мякоть сжимается у основания)
  let kNow = 0;
  const setK0 = g.userData.setK;
  g.userData.setK = (k) => { kNow = k; setK0(k); };
  const nb = o.beads ?? 18, bl = [];
  seed = 59;
  const tall = cols.filter((cl) => h(...cl.c) > 0.18);
  for (let b = 0; b < nb && tall.length; b++) {
    const cl = tall[Math.floor(rnd() * tall.length)], ox = (rnd() - 0.5) * step * 0.55, oy = (rnd() - 0.5) * step * 0.55, r = 0.011 + rnd() * 0.016, k0 = 0.45 + rnd() * 0.4;
    const pp = new V3(), nn = new V3();
    bl.push(() => {
      const gk = Math.min(1, Math.max(0, (kNow - k0) / 0.3));
      if (gk <= 0 || !cl.R) return null;
      const [xc, yc, Bkz, B0z] = cl.B;
      pp.set(ox, oy, -B0z).applyMatrix4(cl.R).add(nn.set(xc, yc, Bkz)); // точка на верхушке (z = 0 в покое)
      nn.set(0, 0, 1).transformDirection(cl.R);
      const rr = r * (0.3 + 0.7 * gk);
      return { p: [pp.x + nn.x * rr * 0.42, pp.y + nn.y * rr * 0.42, pp.z + nn.z * rr * 0.42], s: [rr, rr * 0.55, rr], dir: [nn.x, nn.y, nn.z] };
    });
  }
  if (bl.length) g.add(drops(bl, { depth: 0.55 }));
  g.userData.setK(0);
  g.userData.count = cols.length;
  g.userData.flesh = fm;
  return g;
}

/* ------------------------------ капли ------------------------------ */
// сок в каплях — линза: сквозь каплю видна мякоть (поглощение слабое, толщина ≈ размер капли, иначе сок густеет до красного),
// к краю капля глубже по цвету (длинный путь в соке) — читается объём; каустика — светлое пятно напротив блика;
// тёплое свечение изнутри — капля «живая» и не темнеет на тёмном фоне
export function juiceMat(color = '#ffa31a', o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: col(o.tint || '#fff0cc'), transmission: o.transmission ?? 0.88, thickness: o.thickness ?? 0.1, ior: 1.34, roughness: 0.02,
    attenuationColor: col(color).lerp(col('#ffe08a'), 0.5), attenuationDistance: o.depth ?? 0.5, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02 });
  E3D.enhance(m, { uniforms: { uJc: color, uJk: o.glow ?? 1 }, sss: { color, strength: 1.2, power: 2.2, distortion: 0.3, ambient: 0.22 } });
  return hook(m, 'juice', [['transmission_fragment', `
    { float nv = saturate(dot(normal, geometryViewDir));
      totalDiffuse *= mix(vec3(1.0), uJc * 0.85, pow(1.0 - nv, 1.6) * 0.85);              // край — глубже и темнее: объём линзы
      // каустика: свет, собранный каплей, — светлое пятно внутри напротив блика (на ~половине радиуса, по проекции на экран)
      vec2 nd_ = normal.xy; float rr_ = length(nd_), ring_ = exp(-pow((rr_ - 0.55) / 0.24, 2.0));
      vec3 cc_ = mix(uJc, vec3(1.0, 0.85, 0.35), 0.5);                                 // золотистая, не белёсая
      #if NUM_DIR_LIGHTS > 0
      for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec2 ld = -directionalLights[i].direction.xy; float lp = length(ld);
        float cau = smoothstep(0.35, 1.0, dot(nd_, ld) / max(rr_ * lp, 1e-4)) * ring_ * smoothstep(0.05, 0.4, lp);
        totalDiffuse += cc_ * directionalLights[i].color * cau * 0.3 * uJk; }
      #endif
      #if NUM_RECT_AREA_LIGHTS > 0
      for (int i = 0; i < NUM_RECT_AREA_LIGHTS; i++) { vec2 ld = -normalize(rectAreaLights[i].position + vViewPosition).xy; float lp = length(ld);
        float cau = smoothstep(0.35, 1.0, dot(nd_, ld) / max(rr_ * lp, 1e-4)) * ring_ * smoothstep(0.05, 0.4, lp);
        totalDiffuse += cc_ * rectAreaLights[i].color * cau * 0.035 * uJk; }
      #endif
      totalDiffuse += uJc * (0.035 + 0.05 * pow(1.0 - nv, 2.0)) * uJk;                    // тёплое свечение изнутри
    }`]]);
}
export function drops(list, o = {}) {
  const geo = new THREE.SphereGeometry(1, 28, 20);
  const im = new THREE.InstancedMesh(geo, o.mat || juiceMat(o.color || '#ffa31a', { depth: o.depth ?? 0.5 }), list.length);
  im.castShadow = true;
  const dm = new THREE.Object3D(), Y = new V3(0, 1, 0), d = new V3();
  im.userData.tick = (t) => {
    list.forEach((f, i) => {
      const r = f(t);
      if (!r) { dm.scale.setScalar(0); }
      else {
        dm.position.set(...r.p);
        if (r.dir && (r.dir[0] || r.dir[1] || r.dir[2])) { d.set(...r.dir).normalize(); dm.quaternion.setFromUnitVectors(Y, d); } else dm.quaternion.identity();
        dm.scale.set(...r.s);
      }
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
  };
  im.frustumCulled = false;
  im.userData.tick(0);
  return im;
}
const G = -9.8;
// брызги: n капель из точки по направлению dir с разбросом; растягиваются по скорости
export function spray({ n = 40, origin = [0, 1, 0], dir = [0, 1, 0], spread = 0.6, speed = [1.5, 3.5], size = [0.02, 0.05], at = 0, gravity = G, slow = 1, floor = 0.01, seed: sd = 7 } = {}) {
  seed = sd;
  const base = new V3(...dir).normalize(), out = [];
  for (let i = 0; i < n; i++) {
    const rv = new V3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).multiplyScalar(spread);
    const v = base.clone().add(rv).normalize().multiplyScalar(speed[0] + rnd() * (speed[1] - speed[0]));
    const r = size[0] + rnd() * (size[1] - size[0]), delay = rnd() * 0.05;
    out.push((t) => {
      const tt = (t - at - delay) * slow;
      if (tt < 0) return null;
      const y = origin[1] + v.y * tt + 0.5 * gravity * tt * tt;
      if (y < floor) return null;
      const vy = v.y + gravity * tt, sp = Math.hypot(v.x, vy, v.z);
      return { p: [origin[0] + v.x * tt, y, origin[2] + v.z * tt], s: [r, r * (1 + Math.min(1.2, sp * 0.12)), r], dir: [v.x, vy, v.z] };
    });
  }
  return out;
}
// капля, набухающая в точке и срывающаяся вниз (как с края мякоти): grow [t0,t1], затем падение
export function drip({ pos = [0, 1, 0], t0 = 0, t1 = 1, size = 0.06, slow = 1, floor = 0.0, gravity = G } = {}) {
  return (t) => {
    if (t < t0) return null;
    if (t < t1) { const k = (t - t0) / (t1 - t0); const r = size * (0.25 + 0.75 * Math.sqrt(k)); return { p: [pos[0], pos[1] - r * 0.9 * k, pos[2]], s: [r, r * (1 + 0.5 * k), r] }; }
    const tt = (t - t1) * slow, y = pos[1] - size * 0.9 + 0.5 * gravity * tt * tt;
    if (y < floor) return null;
    const vy = gravity * tt;
    return { p: [pos[0], y, pos[2]], s: [size, size * (1.15 + Math.min(0.8, -vy * 0.08)), size], dir: [0, -1, 0] };
  };
}
// капли на поверхности: появляются в t0 и (если задан to) сползают к точке to за [t1,t2]; normal — куда «смотрит» поверхность
export function bead({ pos, to = null, t0 = 0, t1 = 1e9, t2 = 1e9, size = 0.04, normal = [0, 0, 1] } = {}) {
  const n = new V3(...normal).normalize();
  return (t) => {
    if (t < t0) return null;
    const g = Math.min(1, (t - t0) / 0.35), k = to ? Math.min(1, Math.max(0, (t - t1) / (t2 - t1))) : 0, e = k * k;
    const p = to ? pos.map((v, i) => v + (to[i] - v) * e) : pos;
    const r = size * (0.3 + 0.7 * g);
    return { p: [p[0] + n.x * r * 0.4, p[1] + n.y * r * 0.4, p[2] + n.z * r * 0.4], s: [r, r * (1 + 0.6 * k), r * 0.55], dir: to && k > 0 && k < 1 ? [to[0] - pos[0], to[1] - pos[1], to[2] - pos[2]] : [n.x, n.y, n.z].map((x, i) => (i === 1 ? 1 : 0)) };
  };
}

/* ------------------------------ всплеск и лужица ------------------------------ */
// всплеск-«корона»: тонкая стенка жидкости, капли по краю, затем столбик-отскок (Worthington jet)
export function splash({ pos = [0, 0, 0], at = 1, color = '#ffa31a', size = 1, slow = 1, n = 22 } = {}) {
  const g = new THREE.Group();
  g.position.set(...pos);
  const lm = E3D.liquidMat(color, { depth: 0.45, tint: '#ffd98a', thickness: 0.08, transmission: 0.8 });
  lm.side = THREE.DoubleSide;
  // тонкая стенка «короны» с рваным зубчатым краем
  const cg = new THREE.CylinderGeometry(1, 0.62, 1, 96, 6, true), cp = cg.attributes.position;
  for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i), a = Math.atan2(z, x), k = (y + 0.5);
    const teeth = 0.5 + 0.5 * Math.cos(a * 22) * Math.cos(a * 7 + 1.3); cp.setY(i, y + k * k * (teeth * 0.55 - 0.15)); const f = 1 + k * k * 0.25 * teeth; cp.setX(i, x * f); cp.setZ(i, z * f); }
  cg.computeVertexNormals();
  const crown = new THREE.Mesh(cg, lm);
  g.add(crown);
  const jet = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.2, 8, 20), lm);
  g.add(jet);
  seed = 99;
  const rimDrops = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rnd() * 0.2; rimDrops.push({ a, v: 0.9 + rnd() * 0.6, up: 1.6 + rnd() * 1.2, r: 0.025 + rnd() * 0.025 }); }
  const list = rimDrops.map((d) => (t) => {
    const tt = (t - at - 0.12) * slow;
    if (tt < 0) return null;
    const y = d.up * tt * size + 0.5 * G * tt * tt * size;
    if (y < 0) return null;
    const rr = (0.28 + d.v * tt) * size;
    return { p: [pos[0] + Math.cos(d.a) * rr, pos[1] + y + 0.12 * size, pos[2] + Math.sin(d.a) * rr], s: [d.r * size, d.r * size * 1.3, d.r * size], dir: [Math.cos(d.a) * d.v, d.up + G * tt, Math.sin(d.a) * d.v] };
  });
  const dropsMesh = drops(list, { color });
  g.add(dropsMesh);
  dropsMesh.position.set(-pos[0], -pos[1], -pos[2]);
  g.userData.tick = (t) => {
    const tt = (t - at) * slow;
    const ck = tt < 0 ? 0 : Math.min(1, tt / 0.18), cf = tt < 0.18 ? 1 : Math.max(0, 1 - (tt - 0.18) / 0.35);
    crown.visible = tt > 0 && cf > 0.02;
    crown.scale.set((0.12 + 0.2 * ck + 0.12 * Math.max(0, tt)) * size, (0.02 + 0.22 * ck) * size * cf, (0.12 + 0.2 * ck + 0.12 * Math.max(0, tt)) * size);
    crown.position.y = crown.scale.y / 2;
    const jt = tt - 0.45, jh = jt > 0 ? Math.max(0, 1.4 * jt - 2.4 * jt * jt) : 0;
    jet.visible = jh > 0.01;
    jet.scale.set(size, Math.max(0.01, jh * 3) * size, size);
    jet.position.y = jh * 0.5 * size;
  };
  return g;
}
// лужица сока: глянцевый диск с процедурной рябью от ударов капель; impacts: [[x, z, время, сила], ...] (мировые x,z; до 4)
// bg — цвет фона, в который растворяется край; fade: [начало, конец] растворения в долях радиуса
export function pool(o = {}) {
  const { r = 2.4, color = '#c85400', impacts = [], slow = 1 } = o;
  const imp = Array.from({ length: 4 }, (_, i) => { const q = impacts[i] || [0, 0, 1e9, 0]; return new THREE.Vector4(q[0], -q[1], q[2], q[3]); }); // диск повёрнут: мировой z = -y диска
  const m = new THREE.MeshPhysicalMaterial({ color: col(color), roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.01, transmission: 0.0, sheen: 0 });
  E3D.enhance(m, {
    bump: 1.0, uniforms: { uImp: imp, uSlow: slow, uBg: o.bg || '#000000' },
    // край растворяется в цвете фона целиком (вместе с отражениями) — нет жёсткого «горизонта» диска
    post: `gl_FragColor.rgb = mix(gl_FragColor.rgb, uBg, smoothstep(${(o.fade?.[0] ?? 0.6).toFixed(3)}, ${(o.fade?.[1] ?? 1.0).toFixed(3)}, length(vE3dP.xy) / ${r.toFixed(3)}));`,
    color: ` float rr = length(vE3dP.xy) / ${r.toFixed(3)}; diffuseColor.rgb = diffuse * mix(1.0, 0.5, smoothstep(0.1, 0.6, rr));`, // к краю темнее
    height: `0.0 ${[0, 1, 2, 3].map((i) => `+ (((uTime - uImp[${i}].z) * uSlow) > 0.0 ? uImp[${i}].w * sin(length(vE3dP.xy - uImp[${i}].xy) * 34.0 - ((uTime - uImp[${i}].z) * uSlow) * 12.0) * exp(-length(vE3dP.xy - uImp[${i}].xy) * 2.2) * exp(-((uTime - uImp[${i}].z) * uSlow) * 1.4) * smoothstep(((uTime - uImp[${i}].z) * uSlow) * 1.1 + 0.05, ((uTime - uImp[${i}].z) * uSlow) * 1.1 - 0.25, length(vE3dP.xy - uImp[${i}].xy)) : 0.0)`).join(' ')}`,
  });
  m.customProgramCacheKey = () => 'pool' + r;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 96), m);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.004;
  disc.receiveShadow = true;
  disc.userData.impacts = imp;
  return disc;
}

/* ------------------------------ нож ------------------------------ */
export function knife() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(1.25, 0); s.quadraticCurveTo(1.55, 0.02, 1.7, 0.26); s.quadraticCurveTo(1.2, 0.28, 0, 0.3); s.lineTo(0, 0);
  const blade = sh(new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.012, bevelSegments: 2, curveSegments: 24 }), E3D.mat('chrome', '#e9edf2', { roughness: 0.12 })));
  blade.position.set(0, -0.15, -0.006);
  g.add(blade);
  const handle = E3D.box(0.95, 0.24, 0.12, { r: 0.06, kind: 'plastic', color: '#1e1a17' });
  handle.position.set(-0.5, 0, 0);
  g.add(handle);
  [-0.3, -0.7].forEach((x) => { const rv = E3D.cylinder(0.025, 0.13, { kind: 'chrome' }); rv.rotation.x = Math.PI / 2; rv.position.set(x, 0, 0); g.add(rv); });
  return g;
}

export const F = { skinMat, fleshMat, juiceMat, mango, mangoSurface, mangoCut, hedgehog, drops, spray, drip, bead, splash, pool, knife };
window.F = F;
