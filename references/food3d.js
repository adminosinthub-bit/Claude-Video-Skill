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
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { E3D } from './engine3d.js';

const V3 = THREE.Vector3;
const col = (c) => new THREE.Color(c);
let seed = 3;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sh = (o) => E3D.shade(o);

/* ------------------------------ материалы манго ------------------------------ */
// кожура: зелёный низ → жёлтый → красный «бочок», светлые точки-чечевички, лёгкий рельеф, глянец, просвет на контровом свете
export function skinMat(o = {}) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.36, clearcoat: 0.6, clearcoatRoughness: 0.16, sheen: 0.25, sheenRoughness: 0.6, sheenColor: col('#fff1c8'), side: THREE.FrontSide, ...(o.extra || {}) });
  return E3D.enhance(m, {
    scale: 1, bump: o.bump ?? 0.0009, rest: !!o.rest,
    uniforms: { uBlush: o.blush ?? 0.85, uRipe: o.ripe ?? 0.25 },
    pre: 'float skN_ = fbm3(P * 2.2); float skD_ = smoothstep(0.80, 0.93, snoise(P * 52.0));',
    color: `
      float t = P.y, s = P.x; float n = skN_;
      vec3 green = srgb(vec3(0.42,0.60,0.15)), yellow = srgb(vec3(0.99,0.76,0.13)), red = srgb(vec3(0.85,0.20,0.10));
      vec3 c = mix(green, yellow, smoothstep(-0.95, 0.1, t + n*0.35 + s*0.3 + uRipe));
      c = mix(c, red, uBlush * smoothstep(0.05, 0.85, t*0.55 + s*0.75 + n*0.45 + uRipe*0.3));
      c = mix(c, srgb(vec3(0.98,0.92,0.66)), skD_ * 0.5);
      diffuseColor.rgb = c;`,
    height: 'snoise(P * 14.0) * 0.6 + skD_ * 0.35',
    sss: { color: '#ffb040', strength: 0.55, power: 3.5, ambient: 0.05 },
  });
}

// мякоть: глубокий оранжевый к центру, светлее к краю, продольные волокна, бугристость;
// сверху — плёнка сока с собственными пологими волнами (лак) → дробные влажные блики; сильный просвет на контровом свете
export function fleshMat(o = {}) {
  // база почти без спекуляра (иначе широкий блик от светлых панелей «белит» мякоть до розового), мокрые блики — от лака
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.45, specularIntensity: 0.35, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, ...(o.extra || {}) });
  return E3D.enhance(m, {
    scale: 1, bump: o.bump ?? 0.004, coatBump: o.wet ?? 0.014, seed: !!o.seed, rest: !!o.rest,
    uniforms: { uC: new THREE.Vector2(...(o.center || [0, 0])), uRad: new THREE.Vector2(...(o.radius || [0.6, 0.9])), uSeedR: o.seedR ?? 0.0, uDeep: o.deep || '#ff8500', uLight: o.light || '#ffc42e' },
    pre: `vec2 fq_ = (vE3dP.xy - uC) / uRad; float fr_ = length(fq_);
      float fib_ = fbm3(vec3(fq_.x * 15.0, fq_.y * 3.2, 4.0) + vE3dSeed * 5.0);
      float fn_ = fbm3(vec3(fq_ * 3.0, 1.7) + vE3dSeed * 3.0);`,
    color: `
      vec3 deep = uDeep, light = uLight;                                                  // центр среза / край
      vec3 c = mix(deep, light, clamp(smoothstep(0.0, 1.0, fr_) * 0.7 + fn_ * 0.25, 0.0, 1.0));
      c *= 0.9 + 0.12 * fib_;
      float sd_ = length(fq_ * vec2(1.6, 1.0)) + fib_ * 0.06 + fn_ * 0.04;                                           // косточка: вытянутая, волокнистая
      c = mix(c, srgb(vec3(1.0, 0.86, 0.48)) * (0.82 + 0.25 * fib_), smoothstep(uSeedR + 0.06, uSeedR - 0.03, sd_) * step(0.001, uSeedR));
      c = mix(c, srgb(vec3(0.78, 0.72, 0.20)), smoothstep(0.955, 0.99, fr_));                                      // кожица по краю
      diffuseColor.rgb = c;`,
    height: 'fn_ * 0.6 + fib_ * 0.5',
    coat: 'fbm3(vec3(fq_ * 1.8, 7.0) + vE3dSeed * 2.0) + 0.35 * snoise(vec3(fq_ * 6.0, 11.0))',
    rough: 'roughnessFactor = mix(0.3, 0.6, smoothstep(-0.3, 0.5, fn_));',
    sss: { color: o.sssColor || '#ff9a10', strength: o.sss ?? 0.75, power: 2.4, distortion: 0.4, ambient: 0.09 }, // сильнее — красный канал клиппится и мякоть «розовеет» при тонмаппинге
  });
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

function stemAndLeaf(o = {}) {
  const g = new THREE.Group();
  const stem = sh(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.14, 16), E3D.mat('clay', '#5b3a1e')));
  stem.position.set(0.03, 0.99 + 0.05, 0);
  g.add(stem);
  if (o.leaf !== false) {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(0.12, 0.18, 0.14, 0.55, 0, 0.82); s.bezierCurveTo(-0.14, 0.55, -0.12, 0.18, 0, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 24 });
    const pp = geo.attributes.position;
    for (let i = 0; i < pp.count; i++) { const y = pp.getY(i), x = pp.getX(i); pp.setZ(i, pp.getZ(i) + 0.22 * y * y - 0.35 * x * x); } // изгиб листа
    geo.computeVertexNormals();
    const lm = E3D.enhance(new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.35, clearcoatRoughness: 0.3, side: THREE.DoubleSide }), {
      color: ` float mid = smoothstep(0.012, 0.0, abs(vE3dP.x)); float vein = smoothstep(0.9, 1.0, sin(vE3dP.y*60.0 - abs(vE3dP.x)*80.0));
        diffuseColor.rgb = mix(srgb(vec3(0.16,0.42,0.12)), srgb(vec3(0.55,0.75,0.30)), max(mid, vein*0.4));`,
      sss: { color: '#9be34a', strength: 0.8, power: 2 },
    });
    const leaf = sh(new THREE.Mesh(geo, lm));
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
  inner.add(sh(new THREE.Mesh(mangoGeometry(), o.skin || skinMat(o))));
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
    const sm = o.skin ? o.skin.clone() : skinMat(o);
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
// срез щёчки с надрезами сеткой, вывернутый наружу: setK(0) — плоско, setK(1) — кубики веером на выпуклой кожуре
export function hedgehog(o = {}) {
  const a = o.a ?? 0.62, b = o.b ?? 0.88, depth = o.depth ?? 0.42, s = o.size ?? 0.16;
  const g = new THREE.Group();
  const cells = [];
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
    const u = i * s * 1.02, v = j * s * 1.02;
    if ((u / (a - s * 0.4)) ** 2 + (v / (b - s * 0.4)) ** 2 < 1) cells.push([u, v]);
  }
  const fm = fleshMat({ center: [0, 0], radius: [0.9, 0.9], seed: true, bump: 0.003, wet: 0.01, deep: o.deep || '#ff9400', light: o.light || '#ffbf1a', extra: { specularIntensity: 0.4, clearcoat: 0.8 } });
  const geo = new RoundedBoxGeometry(s * 0.97, s * 0.97, s * 1.15, 4, s * 0.16);
  const seeds = new Float32Array(cells.length * 3);
  seed = 41; for (let i = 0; i < seeds.length; i++) seeds[i] = rnd() * 10;
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  const im = new THREE.InstancedMesh(geo, fm, cells.length);
  im.castShadow = im.receiveShadow = true;
  g.add(im);
  // кожура-основание (поверхность купола), пересчитывается при setK
  const SEG = 48, RING = 18;
  const sg = new THREE.BufferGeometry(), sp = new Float32Array((RING + 1) * SEG * 3), si = [];
  for (let r = 0; r < RING; r++) for (let k = 0; k < SEG; k++) { const A = r * SEG + k, B = r * SEG + ((k + 1) % SEG), C = (r + 1) * SEG + k, D = (r + 1) * SEG + ((k + 1) % SEG); si.push(A, C, B, B, C, D); }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setIndex(si);
  const skin = sh(new THREE.Mesh(sg, o.skin || skinMat({ blush: 0.6 })));
  skin.material.side = THREE.DoubleSide;
  g.add(skin);
  const dm = new THREE.Object3D(), up = new V3(0, 0, 1), n = new V3();
  const dome = (u, v, k) => depth * k * (1 - (u / a) ** 2 - (v / b) ** 2);
  g.userData.setK = (k) => {
    const spread = 1 + 0.12 * Math.max(0, k);
    cells.forEach(([u0, v0], i) => {
      const u = u0 * spread, v = v0 * spread;
      const z = dome(u0, v0, k);
      n.set((2 * depth * k * u0) / (a * a), (2 * depth * k * v0) / (b * b), 1).normalize();
      dm.position.set(u, v, z).addScaledVector(n, s * 0.55);
      dm.quaternion.setFromUnitVectors(up, n);
      dm.scale.setScalar(1);
      dm.updateMatrix(); im.setMatrixAt(i, dm.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    for (let r = 0; r <= RING; r++) for (let kk = 0; kk < SEG; kk++) {
      const f = r / RING, ang = (kk / SEG) * Math.PI * 2, u0 = Math.cos(ang) * a * f, v0 = Math.sin(ang) * b * f;
      const zz = dome(u0, v0, k) - 0.02 - 0.06 * f * f;
      const i3 = (r * SEG + kk) * 3; sp[i3] = u0 * spread; sp[i3 + 1] = v0 * spread; sp[i3 + 2] = zz;
    }
    sg.attributes.position.needsUpdate = true; sg.computeVertexNormals(); sg.computeBoundingSphere();
  };
  g.userData.setK(0);
  g.userData.count = cells.length;
  return g;
}

/* ------------------------------ капли ------------------------------ */
// все капли — один InstancedMesh (материал сока: преломление + оранжевое поглощение). Каждая капля — функция f(t) → {p,s,dir}
export function drops(list, o = {}) {
  const geo = new THREE.SphereGeometry(1, 28, 20);
  const im = new THREE.InstancedMesh(geo, o.mat || E3D.liquidMat(o.color || '#ffa31a', { depth: o.depth ?? 0.5, tint: '#ffd98a', transmission: 0.85 }), list.length);
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

export const F = { skinMat, fleshMat, mango, mangoSurface, mangoCut, hedgehog, drops, spray, drip, bead, splash, pool, knife };
window.F = F;
