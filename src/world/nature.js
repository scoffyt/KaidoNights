// =====================================================================
//  Stylized Nature MegaKit integration: loads the glTF models from
//  assets/nature, bakes each model into per-material geometries and
//  scatters them as chunked InstancedMeshes (trees, bushes, flowers,
//  grass tufts, rocks) around the circuit, with wind sway on foliage.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = './assets/nature/';

// [file, category, scale min, scale max, weight]
const MODELS = [
  ['CommonTree_3', 'tree', 1.0, 1.5, 3], ['CommonTree_4', 'tree', 1.0, 1.5, 3], ['CommonTree_5', 'tree', 1.0, 1.4, 3],
  ['Pine_1', 'tree', 1.1, 1.7, 3], ['Pine_2', 'tree', 1.1, 1.7, 3], ['Pine_4', 'tree', 1.0, 1.5, 2], ['Pine_5', 'tree', 1.1, 1.6, 4],
  ['TwistedTree_1', 'landmark', 1.0, 1.2, 1], ['TwistedTree_2', 'landmark', 1.0, 1.2, 1], ['DeadTree_1', 'landmark', 0.9, 1.2, 1],
  ['Bush_Common', 'bush', 1.0, 1.8, 4], ['Bush_Common_Flowers', 'bush', 1.0, 1.7, 3], ['Plant_1_Big', 'bush', 0.6, 1.0, 2], ['Fern_1', 'bush', 0.25, 0.4, 2],
  ['Flower_3_Group', 'flower', 0.8, 1.3, 2], ['Flower_4_Group', 'flower', 0.8, 1.3, 2],
  ['Grass_Common_Short', 'grass', 0.8, 1.4, 4], ['Grass_Common_Tall', 'grass', 0.8, 1.3, 3], ['Grass_Wispy_Tall', 'grass', 0.7, 1.2, 2],
  ['Rock_Medium_1', 'rock', 0.6, 1.6, 1], ['Rock_Medium_2', 'rock', 0.6, 1.6, 1], ['Rock_Medium_3', 'rock', 0.6, 1.6, 1],
];

const COUNTS = {
  low:   { tree: 110, landmark: 2, bush: 60,  flower: 30,  grass: 200,  rock: 30 },
  high:  { tree: 250, landmark: 5, bush: 170, flower: 110, grass: 700,  rock: 70 },
  ultra: { tree: 430, landmark: 8, bush: 300, flower: 200, grass: 1400, rock: 110 },
};
// how far from the walls each category is allowed (m) and the scatter radius around the circuit
const PLACE = {
  tree: { margin: 9, near: 0.55 }, landmark: { margin: 14, near: 0.3 }, bush: { margin: 3.5, near: 0.85 },
  flower: { margin: 3, near: 0.85 }, grass: { margin: 1.5, near: 0.9 }, rock: { margin: 2.5, near: 0.7 },
};

export const windUniform = { value: 0 };

function addWind(material, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hgt = max(0.0, transformed.y);
        float ph = ip.x * 0.11 + ip.z * 0.07;
        float sway = (sin(uWindTime * 1.7 + ph) * 0.6 + sin(uWindTime * 3.1 + ph * 1.7) * 0.4) * ${strength.toFixed(4)} * hgt;
        transformed.x += sway; transformed.z += sway * 0.6;`);
  };
  material.customProgramCacheKey = () => 'wind' + strength;
}

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class Nature {
  constructor(world, scene, quality = 'high') {
    this.world = world; this.scene = scene; this.quality = quality;
    this.group = new THREE.Group(); this.group.name = 'nature';
    this.models = {};
    this.loaded = false;
  }

  async load(onProgress) {
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    let done = 0;
    const list = MODELS;
    await Promise.all(list.map(([name]) => new Promise((res) => {
      loader.load(BASE + name + '.gltf', (g) => { this.models[name] = this._bake(g.scene, name); done++; onProgress && onProgress(done / list.length); res(); },
        undefined, (e) => { console.warn('nature: falha ao carregar', name, e); done++; res(); });
    })));
    const ok = Object.keys(this.models).length;
    if (ok < 5) throw new Error('pacote de natureza não encontrado em assets/nature');
    this.loaded = true;
    return ok;
  }

  // bake a glTF scene into [{geometry, material}] (one per material), in model space
  _bake(root, name) {
    root.updateMatrixWorld(true);
    const byMat = new Map();
    root.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (g.index && !(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
      const mat = o.material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(g);
    });
    const parts = [];
    for (const [mat, geos] of byMat) {
      const geometry = geos.length > 1 ? mergeGeometries(geos) : geos[0];
      const m = mat.clone();
      m.vertexColors = false; // COLOR_0 is stripped (mostly white AO); keeping the flag would read black
      const leafy = /Leaves|Leaf|Grass|Flowers/i.test(mat.name || '');
      const isGrass = /Grass/i.test(mat.name || '');
      if (leafy) { m.alphaTest = 0.45; m.transparent = false; m.side = THREE.DoubleSide; m.roughness = 0.85; m.metalness = 0; if (!isGrass) m.color.multiplyScalar(1.3); }
      if (/Bark/i.test(mat.name || '')) { m.transparent = false; m.alphaTest = 0; m.roughness = 0.95; }
      if (/Rocks/i.test(mat.name || '')) { m.roughness = 0.9; }
      m.envMapIntensity = 0.35;
      if (m.map) m.map.anisotropy = 4;
      if (leafy) addWind(m, isGrass ? 0.06 : 0.018);
      geometry.computeBoundingSphere();
      parts.push({ geometry, material: m, leafy });
    }
    return parts;
  }

  // scatter instances around the circuit
  scatter() {
    const W = this.world, t = W.track;
    const C = COUNTS[this.quality] || COUNTS.high;
    const r = rng(20240711);
    const byCat = {};
    for (const [name, cat, s0, s1, w] of MODELS) if (this.models[name]) (byCat[cat] = byCat[cat] || []).push({ name, s0, s1, w });
    // instances per (model, chunk)
    const CH = 3, x0 = -460, x1 = 480, z0 = -420, z1 = 420;
    const chunkOf = (x, z) => Math.min(CH - 1, Math.max(0, Math.floor((x - x0) / (x1 - x0) * CH))) * CH + Math.min(CH - 1, Math.max(0, Math.floor((z - z0) / (z1 - z0) * CH)));
    const inst = {}; // name -> chunk -> [matrix]
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const placed = [];
    for (const cat of Object.keys(C)) {
      const models = byCat[cat]; if (!models) continue;
      const totalW = models.reduce((a, b) => a + b.w, 0);
      const P = PLACE[cat];
      let n = 0, tries = 0;
      while (n < C[cat] && tries < C[cat] * 40) {
        tries++;
        let x, z;
        if (r() < P.near) {
          // near the circuit: pick a track sample and push outward beyond the walls
          const s = r() * t.length; const side = r() < 0.5 ? 1 : -1;
          const pt = t.pointAt(s); const i = pt.i;
          const wall = side > 0 ? W.offL[i] : W.offR[i];
          const d = wall + P.margin + Math.pow(r(), 1.6) * (cat === 'tree' ? 60 : cat === 'grass' ? 16 : 30);
          x = pt.x + pt.tz * side * d; z = pt.z - pt.tx * side * d;
        } else { x = x0 + r() * (x1 - x0); z = z0 + r() * (z1 - z0); }
        if (!W.isFree(x, z, P.margin)) continue;
        // keep trees from overlapping each other
        if (cat === 'tree' || cat === 'landmark') {
          let clash = false; const rr = cat === 'landmark' ? 14 : 4.5;
          for (const p of placed) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < rr * rr) { clash = true; break; }
          if (clash) continue;
          placed.push([x, z]);
        }
        let pick = r() * totalW, mdl = models[0];
        for (const mm of models) { pick -= mm.w; if (pick <= 0) { mdl = mm; break; } }
        const sc = mdl.s0 + r() * (mdl.s1 - mdl.s0);
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        m4.compose(new THREE.Vector3(x, cat === 'rock' ? -0.25 * sc : 0, z), q, new THREE.Vector3(sc, sc * (0.9 + r() * 0.2), sc));
        const ch = chunkOf(x, z);
        ((inst[mdl.name] = inst[mdl.name] || {})[ch] = inst[mdl.name][ch] || []).push(m4.clone());
        n++;
      }
    }
    // a few flower/bush clusters inside the paddock lawn edges and around the control tower
    // build instanced meshes
    let draws = 0, tris = 0;
    const shadows = this.quality !== 'low';
    for (const [name, chunks] of Object.entries(inst)) {
      const cat = MODELS.find(m => m[0] === name)[1];
      for (const list of Object.values(chunks)) {
        for (const part of this.models[name]) {
          const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
          list.forEach((mm, k) => im.setMatrixAt(k, mm));
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          im.castShadow = shadows && (cat === 'tree' || cat === 'landmark' || cat === 'rock' || (cat === 'bush' && this.quality === 'ultra'));
          im.receiveShadow = cat !== 'grass';
          this.group.add(im);
          draws++; tris += (part.geometry.index ? part.geometry.index.count : part.geometry.attributes.position.count) / 3 * list.length;
        }
      }
    }
    this.scene.add(this.group);
    this.stats = { draws, tris: Math.round(tris) };
    return this.stats;
  }

  update(dt) { windUniform.value += dt; }
}
