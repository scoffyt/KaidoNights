// =====================================================================
//  GLB car import: normalises orientation/scale, merges ~1400 meshes
//  into a handful of draw calls, extracts the 4 wheels (+calipers) as
//  separately animated parts, and builds per-instance cars (paint,
//  brake lights, headlights).
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL_RE = /3DWheel[\s_]*(Front|Rear)[\s_]*(L|R)|^WHEEL[\s_]*(F|R)(L|R)$/i;
const CALIPER_RE = /^Calliper[\s_]*(Front|Rear)[\s_]*(L|R)_|^CALIPER[\s_]*(F|R)(L|R)$/i;
const LOD_SKIP = /Interior|SeatBelt|WindowInside|Engine|ManufacturerPlate|cal_m|Calliper|Caliper|GlassInside|Shifter|Steer/i;

function cleanGeometry(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position.clone());
  if (g.attributes.normal) out.setAttribute('normal', g.attributes.normal.clone());
  const count = g.attributes.position.count;
  out.setAttribute('uv', g.attributes.uv ? g.attributes.uv.clone() : new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (g.index) out.setIndex(g.index.clone());
  else { const idx = new Uint32Array(count); for (let i = 0; i < count; i++) idx[i] = i; out.setIndex(new THREE.BufferAttribute(idx, 1)); }
  if (!g.attributes.normal) out.computeVertexNormals();
  return out;
}

function mergeByMaterial(list) {
  // list of {geometry (already transformed), material}
  const byMat = new Map();
  for (const it of list) {
    let e = byMat.get(it.material); if (!e) { e = []; byMat.set(it.material, e); } e.push(it.geometry);
  }
  const out = [];
  for (const [material, geos] of byMat) {
    // make indices uniform (Uint32) before merging
    for (const g of geos) if (g.index && !(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
    const merged = mergeGeometries(geos, false);
    if (merged) { merged.computeBoundingSphere(); merged.computeBoundingBox(); out.push({ geometry: merged, material }); }
    geos.forEach(g => g.dispose());
  }
  return out;
}

export async function loadCarTemplate(url, onProgress, opts = {}) {
  const loader = new GLTFLoader();
  const gltf = await new Promise((res, rej) => loader.load(url, res, e => onProgress && e.total && onProgress(e.loaded / e.total), rej));
  return buildTemplate(gltf.scene, opts);
}

// ---------------------------------------------------------------------
//  Geometric wheel extraction for models whose wheels are not named per
//  corner (Sketchfab exports): every mesh matching opts.wheelRe (node name,
//  any ancestor, or material) is a spinning part, opts.caliperRe a fixed
//  part. Corners come from each part's world position; meshes holding both
//  the left and right wheel (opts.splitWheels) are split by triangle side.
//  opts.front: world axis the car's nose points to ('+z', '-z', '+x', '-x').
// ---------------------------------------------------------------------
// keep only the vertices referenced by `tri` (indices into g)
function compactGeometry(g, tri) {
  const remap = new Map(); const newIdx = new Uint32Array(tri.length);
  for (let i = 0; i < tri.length; i++) { let n = remap.get(tri[i]); if (n === undefined) { n = remap.size; remap.set(tri[i], n); } newIdx[i] = n; }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new a.array.constructor(remap.size * a.itemSize);
    for (const [o, n] of remap) for (let k = 0; k < a.itemSize; k++) arr[n * a.itemSize + k] = a.getComponent ? a.getComponent(o, k) : a.array[o * a.itemSize + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  out.setIndex(new THREE.BufferAttribute(newIdx, 1));
  return out;
}

export function geometricWheels(root, opts) {
  const ax = { '+z': [0, 0, 1], '-z': [0, 0, -1], '+x': [1, 0, 0], '-x': [-1, 0, 0] }[opts.front || '+z'];
  const fwd = new THREE.Vector3(...ax), up = new THREE.Vector3(0, 1, 0);
  const left = new THREE.Vector3().crossVectors(up, fwd);
  const chainMatch = (o, re) => { for (let p = o; p && p !== root; p = p.parent) if (re.test(p.name || '')) return true; return false; };
  const matName = o => (Array.isArray(o.material) ? o.material[0] : o.material)?.name || '';
  const found = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    const isCal = opts.caliperRe && (chainMatch(o, opts.caliperRe) || opts.caliperRe.test(matName(o)));
    const isWheel = !isCal && (chainMatch(o, opts.wheelRe) || (opts.wheelMatRe && opts.wheelMatRe.test(matName(o))));
    if (isCal || isWheel) found.push({ mesh: o, type: isCal ? 'caliper' : 'wheel' });
  });
  if (!found.length) { console.warn('geometricWheels: no wheel meshes'); return null; }
  // centre of all wheel parts (world)
  const wb = new THREE.Box3();
  for (const f of found) if (f.type === 'wheel') wb.union(new THREE.Box3().setFromObject(f.mesh));
  const centre = wb.getCenter(new THREE.Vector3());
  // optional split of two-sided meshes
  const parts = [];
  for (const f of found) {
    const o = f.mesh;
    if (f.type === 'wheel' && opts.splitWheels) {
      const g = o.geometry, pos = g.attributes.position;
      const idx = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
      const sideOf = new THREE.Vector3(), tmp = new THREE.Vector3();
      const L = [], R = [], bL = new THREE.Box3(), bR = new THREE.Box3();
      for (let i = 0; i < idx.length; i += 3) {
        sideOf.set(0, 0, 0);
        const vs = [0, 1, 2].map(k => tmp.clone().fromBufferAttribute(pos, idx[i + k]).applyMatrix4(o.matrixWorld));
        vs.forEach(v => sideOf.add(v));
        sideOf.multiplyScalar(1 / 3).sub(centre);
        const isL = sideOf.dot(left) > 0;
        (isL ? L : R).push(idx[i], idx[i + 1], idx[i + 2]);
        vs.forEach(v => (isL ? bL : bR).expandByPoint(v));
      }
      for (const [tri, bx] of [[L, bL], [R, bR]]) {
        if (!tri.length) continue;
        const g2 = compactGeometry(g, tri);
        const m2 = new THREE.Mesh(g2, o.material); m2.name = o.name;
        o.parent.add(m2); m2.matrix.copy(o.matrix); m2.matrixAutoUpdate = false; m2.matrixWorld.copy(o.matrixWorld);
        parts.push({ mesh: m2, type: 'wheel', box: bx });
      }
      o.parent.remove(o);
    } else parts.push(f);
  }
  const owner = new Map(), groups = {};
  for (const p of parts) {
    const pb = p.box || new THREE.Box3().setFromObject(p.mesh);
    const c = pb.getCenter(new THREE.Vector3()).sub(centre);
    const key = (c.dot(fwd) > 0 ? 'Front' : 'Rear') + (c.dot(left) > 0 ? 'L' : 'R');
    owner.set(p.mesh, { type: p.type, key });
    if (p.type === 'wheel') (groups[key] = groups[key] || new THREE.Box3()).union(pb);
  }
  const wheels = [];
  for (const key of ['FrontL', 'FrontR', 'RearL', 'RearR']) {
    if (!groups[key]) { console.warn('geometricWheels: missing corner', key, Object.keys(groups), parts.length); return null; }
    const n = new THREE.Object3D(); n.name = 'geoWheel_' + key;
    n.position.copy(groups[key].getCenter(new THREE.Vector3())); root.add(n); n.updateMatrixWorld(true);
    wheels.push({ node: n, key, front: key.startsWith('Front'), left: key.endsWith('L') });
  }
  return { wheels, calipers: [], owner };
}

function buildTemplate(root, opts = {}) {
  const WB = opts.wheelBase || 2.665;
  root.updateMatrixWorld(true);
  // ---- locate wheels / calipers
  const wheels = [], calipers = [];
  const geo = opts.wheelRe ? geometricWheels(root, opts) : null;
  if (geo) { wheels.push(...geo.wheels); calipers.push(...geo.calipers); }
  else root.traverse(o => {
    const norm = (fr, lr) => (/^f/i.test(fr) ? 'Front' : 'Rear') + lr.toUpperCase();
    const m = WHEEL_RE.exec(o.name || '');
    if (m) {
      const key = m[1] ? norm(m[1], m[2]) : norm(m[3], m[4]);
      if (!wheels.find(w => w.key === key)) wheels.push({ node: o, key, front: key.startsWith('Front'), left: key.endsWith('L') });
    }
    const c = CALIPER_RE.exec(o.name || '');
    if (c) calipers.push({ node: o, key: c[1] ? norm(c[1], c[2]) : norm(c[3], c[4]) });
  });

  // world-space bbox of whole car
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const wp = k => { const w = wheels.find(w => w.key.toLowerCase() === k.toLowerCase()); return w ? new THREE.Vector3().setFromMatrixPosition(w.node.matrixWorld) : null; };
  let fl = wp('FrontL'), fr = wp('FrontR'), rl = wp('RearL'), rr = wp('RearR');
  const M = new THREE.Matrix4();
  let wheelBase = 2.67, scale = 1;
  if (fl && fr && rl && rr) {
    const front = fl.clone().add(fr).multiplyScalar(0.5), rear = rl.clone().add(rr).multiplyScalar(0.5);
    const fwd = front.clone().sub(rear); const wbWorld = fwd.length(); fwd.normalize();
    const leftV = fl.clone().sub(fr).normalize();
    const up = new THREE.Vector3().crossVectors(fwd, leftV).normalize(); // fwd x left = up (z x x = y)
    const left = new THREE.Vector3().crossVectors(up, fwd).normalize();
    scale = WB / wbWorld; // real wheelbase of the car (m)
    wheelBase = WB;
    // basis matrix: car-local axes (x=left, y=up, z=fwd)
    const basis = new THREE.Matrix4().makeBasis(left, up, fwd); // local->world rotation
    const inv = basis.clone().invert();
    const centre = front.clone().add(rear).multiplyScalar(0.5);
    // ground height: lowest point of bbox along up
    let minUp = Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) minUp = Math.min(minUp, new THREE.Vector3(x, y, z).sub(centre).dot(up));
    const T1 = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
    const S = new THREE.Matrix4().makeScale(scale, scale, scale);
    const T2 = new THREE.Matrix4().makeTranslation(0, -minUp * scale, 0);
    M.multiplyMatrices(T2, S).multiply(inv).multiply(T1);
  } else {
    // fallback: assume +z forward, y up, scale to 4.6m length
    const len = Math.max(size.x, size.z); scale = 4.6 / len;
    const c = box.getCenter(new THREE.Vector3());
    M.makeScale(scale, scale, scale).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  }

  // which nodes belong to a wheel/caliper subtree
  const owner = new Map();
  if (geo) for (const [mesh, own] of geo.owner) owner.set(mesh, own);
  else {
    wheels.forEach(w => w.node.traverse(o => owner.set(o, { type: 'wheel', key: w.key })));
    calipers.forEach(c => c.node.traverse(o => owner.set(o, { type: 'caliper', key: c.key })));
  }

  // wheel centres in car space
  const wheelInfo = {};
  wheels.forEach(w => {
    const p = new THREE.Vector3().setFromMatrixPosition(w.node.matrixWorld).applyMatrix4(M);
    wheelInfo[w.key.toLowerCase()] = { key: w.key, front: w.front, left: w.left, center: p, parts: [], caliper: [] };
  });

  const body = [], bodyLod = [];
  let wheelRadius = 0.33;
  root.traverse(o => {
    if (!o.isMesh) return;
    let own = null; let p = o; while (p && !own) { own = owner.get(p); p = p.parent; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g0 = cleanGeometry(o.geometry);
    const mw = new THREE.Matrix4().multiplyMatrices(M, o.matrixWorld);
    if (own && wheelInfo[own.key.toLowerCase()]) {
      const wi = wheelInfo[own.key.toLowerCase()];
      const local = new THREE.Matrix4().makeTranslation(-wi.center.x, -wi.center.y, -wi.center.z).multiply(mw);
      g0.applyMatrix4(local);
      (own.type === 'wheel' ? wi.parts : wi.caliper).push({ geometry: g0, material: mats[0] });
      if (own.type === 'wheel') { g0.computeBoundingBox(); wheelRadius = Math.max(wheelRadius * 0, Math.max(g0.boundingBox.max.y, wheelRadius)); }
    } else {
      g0.applyMatrix4(mw);
      if (mw.determinant() < 0) { // flip winding
        const idx = g0.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
      }
      body.push({ geometry: g0, material: mats[0] });
      if (!LOD_SKIP.test(mats[0].name || '')) bodyLod.push({ geometry: g0.clone(), material: mats[0] });
    }
  });

  // the wheel node origin is not always the geometric hub centre (e.g. the Supra):
  // re-centre every wheel on the bounding box of its own geometry so it spins true
  for (const wi of Object.values(wheelInfo)) {
    if (!wi.parts.length) continue;
    const bb = new THREE.Box3();
    wi.parts.forEach(p => { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); });
    const c = bb.getCenter(new THREE.Vector3());
    wi.radius = (bb.max.y - bb.min.y) / 2;
    if (c.length() < 1e-4) continue;
    [...wi.parts, ...wi.caliper].forEach(p => p.geometry.translate(-c.x, -c.y, -c.z));
    wi.center.add(c);
    wi.radius = (bb.max.y - bb.min.y) / 2;
  }
  // real axle direction (camber/toe baked in some models): smallest-variance axis of the wheel geometry
  for (const wi of Object.values(wheelInfo)) {
    let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0, n = 0;
    for (const p of wi.parts) {
      const a = p.geometry.attributes.position;
      for (let i = 0; i < a.count; i += 3) { const x = a.getX(i), y = a.getY(i), z = a.getZ(i); cxx += x * x; cyy += y * y; czz += z * z; cxy += x * y; cxz += x * z; cyz += y * z; n++; }
    }
    if (!n) { wi.axle = new THREE.Vector3(1, 0, 0); continue; }
    const tr = (cxx + cyy + czz);
    const M = [[tr - cxx, -cxy, -cxz], [-cxy, tr - cyy, -cyz], [-cxz, -cyz, tr - czz]];
    let v = new THREE.Vector3(1, 0, 0);
    for (let it = 0; it < 60; it++) { v = new THREE.Vector3(M[0][0] * v.x + M[0][1] * v.y + M[0][2] * v.z, M[1][0] * v.x + M[1][1] * v.y + M[1][2] * v.z, M[2][0] * v.x + M[2][1] * v.y + M[2][2] * v.z).normalize(); }
    if (v.x < 0) v.negate();
    // only trust it if it is close to lateral (avoid odd meshes)
    wi.axle = Math.abs(v.x) > 0.9 ? v : new THREE.Vector3(1, 0, 0);
  }
  wheelRadius = Math.max(...Object.values(wheelInfo).map(w => w.radius || 0), 0.3);

  // material upgrades
  const allMats = new Set([...body, ...Object.values(wheelInfo).flatMap(w => [...w.parts, ...w.caliper])].map(b => b.material));
  for (const m of allMats) {
    const n = m.name || '';
    m.envMapIntensity = 1.0;
    // transmission forces an extra full-scene render pass in three.js: use plain alpha blending instead
    if (m.transmission !== undefined && m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity ?? 1, 0.45); m.depthWrite = false; }
    if (m.thickness) m.thickness = 0;
    if (/Window_Material|GlassMtl/.test(n) || (m.transparent && /Window|Glass/.test(n) && !/Red|Amber/i.test(n))) { m.transparent = true; m.opacity = Math.max(0.35, m.opacity); m.depthWrite = false; m.roughness = 0.02; m.metalness = 0.1; m.envMapIntensity = 1.6; }
    if (/ambar|amber|red_glass|GlassRed/i.test(n)) { m.transparent = true; m.depthWrite = false; m.opacity = 0.75; }
    if (m.map) m.map.anisotropy = 8;
  }

  const tpl = {
    body: mergeByMaterial(body),
    bodyLod: mergeByMaterial(bodyLod),
    wheels: Object.values(wheelInfo).map(w => ({ ...w, parts: mergeByMaterial(w.parts), caliper: mergeByMaterial(w.caliper) })),
    wheelBase,
    wheelRadius,
    paintRe: opts.paintRe || null, brakeRe: opts.brakeRe || null, rimRe: opts.rimRe || null,
  };
  // dimensions
  const b2 = new THREE.Box3();
  tpl.body.forEach(b => b2.union(b.geometry.boundingBox));
  tpl.bounds = b2;
  tpl.trackWidth = tpl.wheels.length === 4 ? Math.abs(tpl.wheels.find(w => w.left).center.x - tpl.wheels.find(w => !w.left).center.x) : 1.5;
  // geometry for lights: find extents for head/tail lamps
  return tpl;
}

// ---------------------------------------------------------------------
//  Placeholder car (used if the GLB fails to load)
// ---------------------------------------------------------------------
export function placeholderTemplate() {
  const paint = new THREE.MeshPhysicalMaterial({ name: 'Paint_Material', color: 0x2255ff, metalness: 0.5, roughness: 0.3, clearcoat: 1 });
  const dark = new THREE.MeshStandardMaterial({ name: 'Base', color: 0x111111, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ name: 'Window_Material', color: 0x111820, transparent: true, opacity: 0.5, roughness: 0.05 });
  const red = new THREE.MeshStandardMaterial({ name: 'red_glass', color: 0x550000, transparent: true, opacity: 0.8 });
  const lower = new THREE.BoxGeometry(1.8, 0.6, 4.5); lower.translate(0, 0.55, 0.05);
  const cabin = new THREE.BoxGeometry(1.5, 0.5, 2.2); cabin.translate(0, 1.1, -0.25);
  const tl = new THREE.BoxGeometry(1.4, 0.12, 0.05); tl.translate(0, 0.75, -2.21);
  const wheelG = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 24); wheelG.rotateZ(Math.PI / 2);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
  const mk = (left, front) => ({ key: (front ? 'Front' : 'Rear') + (left ? 'L' : 'R'), front, left, center: new THREE.Vector3(left ? 0.74 : -0.74, 0.33, front ? 1.33 : -1.33), parts: [{ geometry: wheelG, material: tyre }], caliper: [] });
  const body = [{ geometry: lower, material: paint }, { geometry: cabin, material: glass }, { geometry: tl, material: red }];
  body.forEach(b => b.geometry.computeBoundingBox());
  const bounds = new THREE.Box3(); body.forEach(b => bounds.union(b.geometry.boundingBox));
  return { body, bodyLod: body, wheels: [mk(true, true), mk(false, true), mk(true, false), mk(false, false)], wheelBase: 2.66, wheelRadius: 0.33, bounds, trackWidth: 1.48, placeholder: true };
}

// ---------------------------------------------------------------------
//  Instance
// ---------------------------------------------------------------------
export class CarVisual {
  constructor(tpl, { color = '#d01c1c', finish = 'metallic', rimColor = null, lod = false, headlights = true, castShadow = true } = {}) {
    this.tpl = tpl;
    this.root = new THREE.Group();          // world transform (position/heading)
    this.body = new THREE.Group();          // pitch/roll (suspension)
    this.root.add(this.body);
    this.wheels = [];
    this.lod = lod;
    this.paintMats = [];
    this.brakeMats = [];
    this.rimMats = [];
    const parts = lod ? tpl.bodyLod : tpl.body;
    const matCache = new Map();
    const instMat = (m) => {
      if (matCache.has(m)) return matCache.get(m);
      let out = m;
      const n = m.name || '';
      const T = this.tpl;
      if (T.paintRe ? T.paintRe.test(n) : /Paint_Material|^Paint$|^Paint[._]/i.test(n)) {
        out = new THREE.MeshPhysicalMaterial({
          name: n, map: m.map || null, color: new THREE.Color(color), metalness: 0.55, roughness: 0.32,
          clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.2,
        });
        this.paintMats.push(out);
      } else if (T.brakeRe ? T.brakeRe.test(n) : /red_glass|GlassRed/i.test(n)) {
        out = m.clone(); out.emissive = new THREE.Color(0xff1a10); out.emissiveIntensity = 0.0; this.brakeMats.push(out);
      } else if ((T.rimRe ? T.rimRe.test(n) : /Wheel\dA/i.test(n)) && rimColor) {
        out = m.clone(); out.color = new THREE.Color(rimColor); this.rimMats.push(out);
      } else if (T.rimRe ? T.rimRe.test(n) : /Wheel\dA/i.test(n)) {
        out = m.clone(); this.rimMats.push(out);
      }
      matCache.set(m, out);
      return out;
    };
    for (const p of parts) {
      const mesh = new THREE.Mesh(p.geometry, instMat(p.material));
      // only the main shell casts shadows (interior/engine/lamps add cost without visible benefit)
      mesh.castShadow = castShadow && !(mesh.material.transparent) && !/Interior|SeatBelt|Engine|Light|Badge|Grille|Plate|Window|Textured|Carbon/i.test(p.material.name || '');
      mesh.receiveShadow = !lod;
      this.body.add(mesh);
    }
    for (const w of tpl.wheels) {
      const pivot = new THREE.Group(); pivot.position.copy(w.center);
      const spinner = new THREE.Group(); pivot.add(spinner);
      for (const p of w.parts) { const m = new THREE.Mesh(p.geometry, instMat(p.material)); m.castShadow = castShadow; spinner.add(m); }
      if (!lod) for (const p of w.caliper) { const m = new THREE.Mesh(p.geometry, instMat(p.material)); pivot.add(m); }
      this.root.add(pivot);  // wheels attached to root (not body) so body can roll independently
      this.wheels.push({ pivot, spinner, front: w.front, left: w.left, base: w.center.clone(), axle: (w.axle || new THREE.Vector3(1, 0, 0)).clone() });
    }
    // order wheels FL, FR, RL, RR to match physics
    const order = (w) => (w.front ? 0 : 2) + (w.left ? 0 : 1);
    this.wheels.sort((a, b) => order(a) - order(b));

    const bb = tpl.bounds;
    this.length = bb.max.z - bb.min.z; this.width = bb.max.x - bb.min.x;
    this.frontZ = bb.max.z; this.rearZ = bb.min.z;
    this._buildLights(headlights);
    this.setFinish(finish);
  }

  _buildLights(withSpots) {
    const bb = this.tpl.bounds;
    const fz = bb.max.z - 0.2, rz = bb.min.z + 0.12, hx = bb.max.x - 0.33;
    const glowTex = CarVisual.glowTexture();
    // headlight / taillight glows: forward/backward facing quads (invisible from the side)
    const headMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xdfe9ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
    const tailMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xff2010, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 });
    this.headMat = headMat; this.tailMat = tailMat;
    this.headSprites = []; this.tailSprites = [];
    const q = new THREE.PlaneGeometry(1, 1);
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(q, headMat); h.position.set(sx * hx, 0.68, fz); h.scale.set(0.5, 0.36, 1); h.renderOrder = 6; this.body.add(h); this.headSprites.push(h);
      for (const off of [0.1, 0.42]) {
        const t = new THREE.Mesh(q, tailMat); t.position.set(sx * (hx - off + 0.05), 0.82, rz - 0.08); t.rotation.y = Math.PI; t.scale.set(0.5, 0.5, 1); t.renderOrder = 6; this.body.add(t); this.tailSprites.push(t);
      }
    }
    // reverse lights
    this.revMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
    for (const sx of [-1, 1]) { const r = new THREE.Mesh(q, this.revMat); r.position.set(sx * 0.42, 0.74, rz - 0.1); r.rotation.y = Math.PI; r.scale.set(0.2, 0.14, 1); r.renderOrder = 6; this.body.add(r); }
    this.spots = [];
    if (withSpots) {
      for (const sx of [-1, 1]) {
        const s = new THREE.SpotLight(0xe8f0ff, 0, 70, 0.48, 0.55, 1.6);
        s.position.set(sx * hx, 0.66, fz);
        s.target.position.set(sx * 1.2, -0.6, fz + 22);
        s.castShadow = false;
        this.body.add(s); this.body.add(s.target);
        this.spots.push(s);
      }
    }
  }

  static glowTexture() {
    if (CarVisual._glow) return CarVisual._glow;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    CarVisual._glow = new THREE.CanvasTexture(c); CarVisual._glow.colorSpace = THREE.SRGBColorSpace;
    return CarVisual._glow;
  }

  setColor(hex) { this.paintMats.forEach(m => m.color.set(hex)); }
  setRimColor(hex) { this.rimMats.forEach(m => m.color.set(hex)); }
  setFinish(f) {
    this.finish = f;
    for (const m of this.paintMats) {
      if (f === 'matte') { m.metalness = 0.1; m.roughness = 0.75; m.clearcoat = 0.0; m.sheen = 0; }
      else if (f === 'pearl') { m.metalness = 0.35; m.roughness = 0.25; m.clearcoat = 1; m.iridescence = 0.6; m.iridescenceIOR = 1.6; }
      else if (f === 'chrome') { m.metalness = 1.0; m.roughness = 0.08; m.clearcoat = 1; m.iridescence = 0; }
      else { m.metalness = 0.55; m.roughness = 0.32; m.clearcoat = 1; m.iridescence = 0; }
      m.needsUpdate = true;
    }
  }

  setLights({ head = true, brake = 0, night = true, reverse = false }) {
    if (this.revMat) this.revMat.opacity = reverse ? 0.45 : 0;
    const hOn = head ? 1 : 0;
    this.headMat.opacity = hOn * (night ? 0.75 : 0.3);
    this.spots.forEach(s => { s.intensity = head && night ? 60 : 0; }); // keep visible: avoids shader recompiles
    const tail = (head ? 0.18 : 0.04) + brake * 0.5;
    this.tailMat.opacity = tail * (night ? 1 : 0.6);
    this.tailSprites.forEach(s => s.scale.setScalar(0.28 + brake * 0.18));
    this.brakeMats.forEach(m => { m.emissiveIntensity = (head ? 0.35 : 0) + brake * 1.6; });
  }

  // sync from physics vehicle
  update(veh, dt, rideHeight = 0) {
    this.root.position.set(veh.x, 0, veh.z);
    this.root.rotation.y = veh.heading;
    // body pitch/roll from accelerations (spring-damper smoothing)
    const targetPitch = THREE.MathUtils.clamp(-veh.ax * 0.006, -0.05, 0.05);
    const targetRoll = THREE.MathUtils.clamp(veh.ay * 0.0065, -0.06, 0.06);
    this._pv = (this._pv || 0) + ((targetPitch - (this._p || 0)) * 90 - (this._pv || 0) * 11) * dt;
    this._p = (this._p || 0) + this._pv * dt;
    this._rv = (this._rv || 0) + ((targetRoll - (this._r || 0)) * 90 - (this._rv || 0) * 11) * dt;
    this._r = (this._r || 0) + this._rv * dt;
    this.body.rotation.set(this._p, 0, this._r);
    this.body.position.y = rideHeight + Math.sin(veh.time * 23) * 0.002 * Math.min(1, veh.speed / 20) * (veh.offroad > 0 ? 6 : 1);
    // wheels
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i]; if (!w) continue;
      if (w.front) w.pivot.rotation.y = veh.steer;
      w.spinner.quaternion.setFromAxisAngle(w.axle, veh.wheelAngle[i]);
      // visual suspension compression from load
      const comp = (veh.wheelLoad[i] - veh.spec.mass * 9.81 / 4) / 40000;
      w.pivot.position.y = w.base.y + rideHeight - THREE.MathUtils.clamp(comp, -0.04, 0.05);
    }
  }

  dispose() { this.root.removeFromParent(); }
}
