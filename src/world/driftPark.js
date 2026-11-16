// =====================================================================
//  Drift Park — the "drift_race_track_free.glb" map placed as a second
//  region of the open world (east of the Hakone Bay paddock, linked by an
//  access road). Driving data are derived from the model itself:
//   • surface: the Asphalt mesh is rasterised into a 0.4 m grid
//   • walls:   the Metal mesh (guard rails, tyre stacks) between 0.15 and
//              1.3 m high is rasterised, contoured (marching edges) and
//              simplified into collision segments.
// =====================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// map origin in world space and the access road from the paddock
export const PARK = { ox: 600, oz: 0, url: './assets/maps/drift_track.glb', name: 'Drift Park' };
export const PARK_ROAD = { x0: 130, x1: 704, z0: 243, z1: 257 };          // world space, asphalt strip
export const PARK_BOUNDS = { x0: PARK.ox - 175, x1: PARK.ox + 175, z0: PARK.oz - 150, z1: PARK.oz + 265 };
// spawn points (world): start of the pit straight, facing into the park (-z)
export const PARK_SPAWNS = [
  { x: PARK.ox + 96, z: 200, h: Math.PI, name: 'Entrada' },
  { x: PARK.ox + 60, z: 40, h: -Math.PI * 0.75, name: 'Pátio' },
  { x: PARK.ox + 20, z: -40, h: Math.PI / 2, name: 'Oval' },
];

const CELL = 0.4;

export class DriftPark {
  constructor(world) {
    this.world = world;
    this.loaded = false;
    this.group = new THREE.Group(); this.group.name = 'driftPark';
    this.group.position.set(PARK.ox, 0, PARK.oz);
  }

  contains(x, z) { const b = PARK_BOUNDS; return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; }
  onRoad(x, z) { const r = PARK_ROAD; return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1; }

  async load(onProgress) {
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(PARK.url, res, e => onProgress && e.total && onProgress(e.loaded / e.total), rej));
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const asphalt = [], metal = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const n = o.material?.name || '';
      if (n === 'Ground') { o.visible = false; return; }  // world grass is used instead
      o.castShadow = false; o.receiveShadow = n !== 'Leafs_Mat';
      if (o.material.map) o.material.map.anisotropy = 8;
      if (n === 'Asphalt') { asphalt.push(o); o.material.polygonOffset = true; o.material.polygonOffsetFactor = -1; }
      if (n === 'Metal') metal.push(o);
      if (n === 'Decals') { o.material.polygonOffset = true; o.material.polygonOffsetFactor = -2; o.material.depthWrite = false; o.renderOrder = 1; }
      if (n === 'Leafs_Mat') { o.material.alphaTest = Math.max(o.material.alphaTest || 0, 0.4); o.material.side = THREE.DoubleSide; }
    });
    this.group.add(root);
    // grid covering the park (local coordinates)
    const b = PARK_BOUNDS;
    this.gx0 = b.x0 - PARK.ox; this.gz0 = b.z0 - PARK.oz;
    this.gw = Math.ceil((b.x1 - b.x0) / CELL); this.gh = Math.ceil((b.z1 - b.z0) / CELL);
    this.surf = new Uint8Array(this.gw * this.gh);
    const wall = new Uint8Array(this.gw * this.gh);
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const eachTri = (mesh, fn) => {
      const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(pos, idx ? idx.getX(i + k) : i + k).applyMatrix4(mesh.matrixWorld);
        fn(v[0], v[1], v[2]);
      }
    };
    for (const m of asphalt) eachTri(m, (a, c, d) => this._fillTri(this.surf, a, c, d));
    for (const m of metal) eachTri(m, (a, c, d) => {
      const y0 = Math.min(a.y, c.y, d.y), y1 = Math.max(a.y, c.y, d.y);
      if (y1 < 0.15 || y0 > 1.3) return;
      this._fillTri(wall, a, c, d);
      this._line(wall, a, c); this._line(wall, c, d); this._line(wall, d, a);
    });
    this.wall = wall;
    const segs = this._contours(wall);
    for (const s of segs) this.world.segments.push(s);
    this.world._buildSegmentGrid();
    this.segCount = segs.length;
    this.loaded = true;
    return this;
  }

  // ---- rasterisation helpers (local coordinates → grid)
  _cell(x, z) { return [Math.floor((x - this.gx0) / CELL), Math.floor((z - this.gz0) / CELL)]; }
  _set(g, i, j) { if (i >= 0 && j >= 0 && i < this.gw && j < this.gh) g[j * this.gw + i] = 1; }
  _line(g, a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5)) + 1;
    for (let k = 0; k <= n; k++) { const t = k / n; const [i, j] = this._cell(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t); this._set(g, i, j); }
  }
  _fillTri(g, a, b, c) {
    const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x), minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
    const [i0, j0] = this._cell(minX, minZ), [i1, j1] = this._cell(maxX, maxZ);
    const area = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(area) < 1e-6) return;
    for (let j = Math.max(0, j0); j <= Math.min(this.gh - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(this.gw - 1, i1); i++) {
      const px = this.gx0 + (i + 0.5) * CELL, pz = this.gz0 + (j + 0.5) * CELL;
      const w0 = (b.x - px) * (c.z - pz) - (b.z - pz) * (c.x - px);
      const w1 = (c.x - px) * (a.z - pz) - (c.z - pz) * (a.x - px);
      const w2 = (a.x - px) * (b.z - pz) - (a.z - pz) * (b.x - px);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) g[j * this.gw + i] = 1;
    }
  }

  // boundary edges of occupied cells → closed loops → Douglas-Peucker → world segments
  _contours(g) {
    const W = this.gw, H = this.gh, occ = (i, j) => i >= 0 && j >= 0 && i < W && j < H && g[j * W + i] === 1;
    // directed edges with the occupied cell on the right of travel (grid corners as keys)
    const next = new Map();
    const key = (i, j) => j * (W + 1) + i;
    const add = (a, b) => { const k = key(a[0], a[1]); let l = next.get(k); if (!l) next.set(k, l = []); l.push(key(b[0], b[1])); };
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!occ(i, j)) continue;
      if (!occ(i, j - 1)) add([i + 1, j], [i, j]);       // top edge, travel -x
      if (!occ(i, j + 1)) add([i, j + 1], [i + 1, j + 1]); // bottom edge, travel +x
      if (!occ(i - 1, j)) add([i, j], [i, j + 1]);       // left edge, travel +z
      if (!occ(i + 1, j)) add([i + 1, j + 1], [i + 1, j]); // right edge, travel -z
    }
    const segs = [];
    for (const [k0, l0] of next) {
      while (l0.length) {
        const loop = []; let k = k0, guard = 0;
        while (guard++ < 1e6) {
          const l = next.get(k); if (!l || !l.length) break;
          const i = k % (W + 1), j = (k - i) / (W + 1);
          loop.push([this.gx0 + i * CELL + PARK.ox, this.gz0 + j * CELL + PARK.oz]);
          k = l.pop();
          if (k === k0) break;
        }
      if (loop.length < 4) continue;
      const pts = simplifyClosed(loop, 0.3);
      for (let a = 0; a < pts.length; a++) {
        const p = pts[a], q = pts[(a + 1) % pts.length];
        const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez); if (L < 1e-3) continue;
        // occupied cell is on the right of travel; free side (normal) on the left: (-ez, ex)... in x/z with z down → left = (ez, -ex)
        // edges run with the occupied cell on the +z/-x side of travel → free side normal = (-ez, ex)
        let nx = -ez / L, nz = ex / L;
        const cx = (p[0] + q[0]) / 2, cz = (p[1] + q[1]) / 2, o = CELL * 0.6;
        if (this.isWall(cx + nx * o, cz + nz * o) && !this.isWall(cx - nx * o, cz - nz * o)) { nx = -nx; nz = -nz; }
        segs.push({ ax: p[0], az: p[1], bx: q[0], bz: q[1], nx, nz, type: 'wall', depth: 0.45 });
      }
      }
    }
    return segs;
  }

  isWall(x, z) { if (!this.wall) return false; const [i, j] = this._cell(x - PARK.ox, z - PARK.oz); return i >= 0 && j >= 0 && i < this.gw && j < this.gh && this.wall[j * this.gw + i] === 1; }
  isAsphalt(x, z) {
    if (this.onRoad(x, z)) return true;
    if (!this.surf) return false;
    const [i, j] = this._cell(x - PARK.ox, z - PARK.oz);
    return i >= 0 && j >= 0 && i < this.gw && j < this.gh && this.surf[j * this.gw + i] === 1;
  }
  // nearest drivable spawn (used by respawn)
  nearestSpawn(x, z) {
    let best = PARK_SPAWNS[0], bd = 1e18;
    for (const s of PARK_SPAWNS) { const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    return best;
  }
}

function simplifyClosed(pts, eps) {
  // split the loop at the farthest pair and simplify both halves
  if (pts.length < 8) return pts;
  let far = 0, fd = 0; for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = dp(pts.slice(0, far + 1), eps), b = dp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const ax = pts[s][0], az = pts[s][1], ex = pts[e][0] - ax, ez = pts[e][1] - az, L = Math.hypot(ex, ez) || 1e-9;
    let md = 0, mi = -1;
    for (let i = s + 1; i < e; i++) { const d = Math.abs((pts[i][0] - ax) * ez - (pts[i][1] - az) * ex) / L; if (d > md) { md = d; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  return pts.filter((_, i) => keep[i]);
}
