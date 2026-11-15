// =====================================================================
//  World builder: circuit, paddock, scenery, collision & surfaces
// =====================================================================
import * as THREE from 'three';
import { PARK, PARK_ROAD, DriftPark } from './driftPark.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TrackData, computeRacingLine, speedProfile } from './trackData.js';
import { getTextures, textTexture } from './textures.js';

export const PLAZA = { x0: -130, x1: 130, z0: 176, z1: 322 };
export const DONUT = { x: 62, z: 250, r: 30 };
export const START_S = 40;  // arc length of the start line

const RUNOFF = 11;

export class World {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.quality = quality;
    this.track = new TrackData();
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.T = getTextures(quality);
    this.segments = [];      // collision segments {ax,az,bx,bz,nx,nz}
    this.props = [];         // dynamic props (cones)
    this.lampPositions = []; // for light pools / night lighting
    this.emissiveMats = [];  // materials to toggle at night
    this.clipZones = [];     // drift scoring clipping points
    this.checkpoints = [];
    this.blockers = [];      // {x,z,r} areas where vegetation must not spawn
    this._computeOffsets();
    this.racingLine = this._racingLine();
    this.build();
  }

  // ------------------------------------------------------------------
  _computeOffsets() {
    const t = this.track, N = t.N;
    this.offL = new Float32Array(N); this.offR = new Float32Array(N);
    this.curbL = new Uint8Array(N); this.curbR = new Uint8Array(N);
    this.gravelL = new Uint8Array(N); this.gravelR = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const base = t.hw[i] + RUNOFF;
      const k = t.curv[i];
      let l = base, r = base;
      if (k > 0) l = Math.min(base, 0.75 / k); // left is inner
      if (k < 0) r = Math.min(base, 0.75 / -k);
      this.offL[i] = Math.max(t.hw[i] + 3, l);
      this.offR[i] = Math.max(t.hw[i] + 3, r);
    }
    // smooth offsets
    for (let pass = 0; pass < 6; pass++) {
      const a = this.offL.slice(), b = this.offR.slice();
      for (let i = 0; i < N; i++) {
        let sa = 0, sb = 0;
        for (let k = -3; k <= 3; k++) { sa += a[(i + k + N) % N]; sb += b[(i + k + N) % N]; }
        this.offL[i] = Math.min(a[i], sa / 7 + 0.5); this.offR[i] = Math.min(b[i], sb / 7 + 0.5);
      }
    }
    // curbs in corners (dilated) and gravel traps on outside of tight corners
    const dil = (src, rad) => { const out = new Uint8Array(N); for (let i = 0; i < N; i++) if (src[i]) for (let k = -rad; k <= rad; k++) out[(i + k + N) % N] = 1; return out; };
    const cl = new Uint8Array(N), cr = new Uint8Array(N), gl = new Uint8Array(N), gr = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const k = t.curv[i];
      if (Math.abs(k) > 1 / 110) { cl[i] = 1; cr[i] = 1; }
      if (k < -1 / 70) gl[i] = 1; // right turn -> left side outer
      if (k > 1 / 70) gr[i] = 1;
    }
    this.curbL = dil(cl, 6); this.curbR = dil(cr, 6);
    this.gravelL = dil(gl, 10); this.gravelR = dil(gr, 10);
    // no gravel/curb on start straight next to the paddock
    for (let i = 0; i < N; i++) if (this._besidePlaza(i)) { this.gravelR[i] = 0; this.curbR[i] = 0; }
  }

  _besidePlaza(i) {
    const t = this.track;
    return t.z[i] > 150 && t.x[i] > PLAZA.x0 - 4 && t.x[i] < PLAZA.x1 + 4;
  }

  _racingLine() { return computeRacingLine(this.track); }
  speedProfile(gripG, accel = 6, decel = 9, vcap = 78) { return speedProfile(this.track, this.racingLine, gripG, accel, decel, vcap); }

  // ------------------------------------------------------------------
  build() {
    const T = this.T;
    this._buildGround();
    this._buildRoad();
    this._buildWalls();
    this._buildPlaza();
    this._buildStartGantry();
    this._buildGrandstands();
    this._buildLights();
    this._buildScenery();
    this._buildSigns();
    this._buildCones();
    this._buildZones();
    this._buildCheckpoints();
    this._buildSegmentGrid();
  }

  _mat(opts) { return new THREE.MeshStandardMaterial(opts); }

  _buildGround() {
    const T = this.T;
    const grass = T.grass.clone(); grass.repeat.set(220, 220); grass.needsUpdate = true;
    const g = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), this._mat({ map: grass, roughness: 0.95, color: 0x9aa58a }));
    g.rotation.x = -Math.PI / 2; g.position.y = -0.02; g.receiveShadow = true; g.name = 'ground';
    this.group.add(g);
  }

  // build a ribbon along the track between lateral offsets (functions of i)
  _ribbon(fromFn, toFn, y, include, vScale, uRange = [0, 1], yInner = null) {
    const t = this.track, N = t.N;
    const pos = [], uv = [], idx = [];
    let run = [];
    const flush = () => {
      if (run.length < 2) { run = []; return; }
      const base = pos.length / 3;
      for (const i of run) {
        const [lx, lz] = t.left(i);
        const a = fromFn(i), b = toFn(i);
        pos.push(t.x[i] + lx * a, yInner !== null ? yInner : y, t.z[i] + lz * a);
        pos.push(t.x[i] + lx * b, y, t.z[i] + lz * b);
        const v = t.s[i] / vScale;
        uv.push(uRange[0], v, uRange[1], v);
      }
      for (let k = 0; k < run.length - 1; k++) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      run = [];
    };
    for (let i = 0; i <= N; i++) {
      const ii = i % N;
      if (include(ii)) run.push(ii);
      else flush();
      if (i === N) flush();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // ensure counter-clockwise winding seen from above (front faces up)
    if (idx.length >= 3) {
      const p = pos;
      const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
      const ux = p[b] - p[a], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vz = p[c + 2] - p[a + 2];
      const ny = uz * vx - ux * vz; // y of (u x v)
      if (ny < 0) for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  _buildRoad() {
    const T = this.T, t = this.track;
    // road: from right edge (-hw) to left edge (+hw)
    const roadTex = T.road.clone(); roadTex.needsUpdate = true;
    const rough = T.asphaltRough.clone(); rough.repeat.set(7, 7); rough.needsUpdate = true;
    const roadGeo = this._ribbon(i => -t.hw[i], i => t.hw[i], 0.02, () => true, 16);
    this.roadMat = this._mat({ map: roadTex, roughnessMap: rough, roughness: 0.82, metalness: 0.0, color: 0xffffff, envMapIntensity: 0.6 });
    const road = new THREE.Mesh(roadGeo, this.roadMat);
    road.receiveShadow = true; road.name = 'road';
    this.group.add(road);
    this.roadMesh = road;

    // curbs (slightly raised outer edge)
    const curbMat = this._mat({ map: T.curb, roughness: 0.6 });
    const cL = this._ribbon(i => t.hw[i] - 0.05, i => t.hw[i] + 1.4, 0.07, i => this.curbL[i], 4, [0, 1], 0.03);
    const cR = this._ribbon(i => -t.hw[i] + 0.05, i => -t.hw[i] - 1.4, 0.07, i => this.curbR[i], 4, [0, 1], 0.03);
    for (const g of [cL, cR]) { const m = new THREE.Mesh(g, curbMat); m.receiveShadow = true; this.group.add(m); }

    // gravel traps
    const gravel = T.gravel.clone(); gravel.repeat.set(6, 1); gravel.needsUpdate = true;
    const gMat = this._mat({ map: gravel, roughness: 1, color: 0xb8a890 });
    const gL = this._ribbon(i => t.hw[i] + 1.4, i => this.offL[i] - 0.6, 0.01, i => this.gravelL[i], 10);
    const gR = this._ribbon(i => -t.hw[i] - 1.4, i => -this.offR[i] + 0.6, 0.01, i => this.gravelR[i], 10);
    for (const g of [gL, gR]) { const m = new THREE.Mesh(g, gMat); m.receiveShadow = true; this.group.add(m); }

    // asphalt run-off verge (dark strip just outside the white line, both sides)
    const vMat = this._mat({ map: T.asphalt, roughness: 0.9, color: 0x6a6a6a });
    const vL = this._ribbon(i => t.hw[i], i => t.hw[i] + 2.2, 0.012, i => !this.curbL[i] && !this.gravelL[i], 8);
    const vR = this._ribbon(i => -t.hw[i], i => -t.hw[i] - 2.2, 0.012, i => !this.curbR[i] && !this.gravelR[i] && !this._besidePlaza(i), 8);
    for (const g of [vL, vR]) { const m = new THREE.Mesh(g, vMat); m.receiveShadow = true; this.group.add(m); }

    // start / finish line
    const p = t.pointAt(START_S);
    const fin = new THREE.Mesh(new THREE.PlaneGeometry(t.hw[p.i] * 2, 2.2), this._mat({ map: T.checker, roughness: 0.7 }));
    fin.geometry.rotateX(-Math.PI / 2);
    fin.position.set(p.x, 0.035, p.z);
    fin.rotation.y = Math.atan2(p.tx, p.tz);
    fin.receiveShadow = true;
    this.group.add(fin);
    // grid boxes
    const boxMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.8 });
    for (let k = 0; k < 6; k++) {
      const q = t.pointAt(START_S - 12 - k * 9, k % 2 ? -3.2 : 3.2);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), boxMat);
      g.geometry.rotateX(-Math.PI / 2); g.rotation.y = Math.atan2(q.tx, q.tz);
      g.position.set(q.x, 0.034, q.z);
      this.group.add(g);
    }
  }

  _wallInclude(side, i) {
    if (side === 'R' && this._besidePlaza(i)) {
      const x = this.track.x[i];
      return !(x > PLAZA.x0 && x < PLAZA.x1);
    }
    return true;
  }

  _buildWalls() {
    const t = this.track, N = t.N, T = this.T;
    const H = 1.05;
    const wallTex = T.wall.clone(); wallTex.needsUpdate = true;
    const wallMat = this._mat({ map: wallTex, roughness: 0.7, metalness: 0.1 });
    const tyreMat = this._mat({ map: T.tyres, roughness: 0.9 });
    const geos = [], tyreGeos = [];
    const sides = [['L', 1], ['R', -1]];
    this.wallLines = { L: [], R: [] };
    for (const [side, sgn] of sides) {
      const off = side === 'L' ? this.offL : this.offR;
      let run = [];
      const flush = () => {
        if (run.length < 2) { run = []; return; }
        const pts = run.map(i => { const [lx, lz] = t.left(i); return [t.x[i] + lx * off[i] * sgn, t.z[i] + lz * off[i] * sgn, i]; });
        this.wallLines[side].push(pts);
        // geometry: two-sided vertical strip + top
        const pos = [], uv = [], idx = [];
        let acc = 0;
        for (let k = 0; k < pts.length; k++) {
          if (k > 0) acc += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
          pos.push(pts[k][0], 0, pts[k][1], pts[k][0], H, pts[k][1]);
          uv.push(acc / 6, 0, acc / 6, 1);
        }
        for (let k = 0; k < pts.length - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals();
        geos.push(g);
        // tyre wall in front of barrier on outside of tight corners
        for (let k = 0; k < pts.length - 1; k++) {
          const i = pts[k][2];
          const outer = (side === 'L' && t.curv[i] < -1 / 65) || (side === 'R' && t.curv[i] > 1 / 65);
          if (!outer) continue;
          const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
          const len = Math.hypot(bx - ax, bz - az);
          const bg = new THREE.BoxGeometry(0.9, 0.9, len + 0.05);
          const [lx, lz] = t.left(i);
          const inward = -sgn * 0.55;
          bg.rotateY(Math.atan2(bx - ax, bz - az));
          bg.translate((ax + bx) / 2 + lx * inward, 0.45, (az + bz) / 2 + lz * inward);
          tyreGeos.push(bg);
        }
        // collision segments (normal toward track centre)
        for (let k = 0; k < pts.length - 1; k++) {
          const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
          const i = pts[k][2];
          const [lx, lz] = t.left(i);
          const outer = (side === 'L' && t.curv[i] < -1 / 65) || (side === 'R' && t.curv[i] > 1 / 65);
          const shift = outer ? 1.0 : 0;
          this.segments.push({ ax: ax - lx * sgn * shift, az: az - lz * sgn * shift, bx: bx - lx * sgn * shift, bz: bz - lz * sgn * shift, nx: -lx * sgn, nz: -lz * sgn, type: outer ? 'tyre' : 'wall' });
        }
        run = [];
      };
      for (let i = 0; i <= N; i++) {
        const ii = i % N;
        if (this._wallInclude(side, ii)) run.push(ii); else flush();
        if (i === N) flush();
      }
    }
    // join wrap-around runs: handled by including index N (=0)
    const wall = new THREE.Mesh(mergeGeometries(geos), wallMat);
    wallMat.side = THREE.DoubleSide;
    wall.castShadow = true; wall.receiveShadow = true; wall.name = 'walls';
    this.group.add(wall);
    if (tyreGeos.length) {
      const tw = new THREE.Mesh(mergeGeometries(tyreGeos), tyreMat);
      tw.castShadow = this.quality !== 'low'; tw.receiveShadow = true; this.group.add(tw);
    }
  }

  _addSegment(ax, az, bx, bz, nx, nz, type = 'wall') { this.segments.push({ ax, az, bx, bz, nx, nz, type }); }

  _buildPlaza() {
    const T = this.T, P = PLAZA;
    const W = P.x1 - P.x0, D = P.z1 - P.z0;
    const ptex = T.plaza.clone(); ptex.repeat.set(W / 16, D / 16); ptex.needsUpdate = true;
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(W, D), this._mat({ map: ptex, roughness: 0.85, color: 0xd8d8d8 }));
    plaza.rotation.x = -Math.PI / 2; plaza.position.set((P.x0 + P.x1) / 2, 0.015, (P.z0 + P.z1) / 2);
    plaza.receiveShadow = true; this.group.add(plaza);

    // painted lines: parking bays & donut circle
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.75, depthWrite: false });
    const yellow = new THREE.MeshBasicMaterial({ color: 0xffc400, transparent: true, opacity: 0.85, depthWrite: false });
    const lines = [];
    for (let k = 0; k < 9; k++) {
      const g = new THREE.PlaneGeometry(0.18, 5.5); g.rotateX(-Math.PI / 2); g.translate(-120 + k * 3.2, 0.03, 214); lines.push(g);
      const g2 = new THREE.PlaneGeometry(0.18, 5.5); g2.rotateX(-Math.PI / 2); g2.translate(-120 + k * 3.2, 0.03, 236); lines.push(g2);
    }
    const lg = new THREE.Mesh(mergeGeometries(lines), lineMat); lg.renderOrder = 1; this.group.add(lg);
    const ring = new THREE.Mesh(new THREE.RingGeometry(DONUT.r - 0.3, DONUT.r, 96), yellow);
    ring.rotation.x = -Math.PI / 2; ring.position.set(DONUT.x, 0.03, DONUT.z); this.group.add(ring);
    const ring2 = new THREE.Mesh(new THREE.RingGeometry(7.7, 8, 64), yellow);
    ring2.rotation.x = -Math.PI / 2; ring2.position.set(DONUT.x, 0.03, DONUT.z); this.group.add(ring2);
    const dtxt = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshBasicMaterial({ map: textTexture('DONUT ZONE', { bg: 'rgba(0,0,0,0)', fg: '#ffc400' }), transparent: true, depthWrite: false }));
    dtxt.rotation.x = -Math.PI / 2; dtxt.position.set(DONUT.x, 0.035, DONUT.z - DONUT.r - 4); this.group.add(dtxt);
    // pit lane line along the straight edge
    const pl = new THREE.PlaneGeometry(P.x1 - P.x0, 0.25); pl.rotateX(-Math.PI / 2); pl.translate(0, 0.03, 192);
    this.group.add(new THREE.Mesh(pl, lineMat));

    // walls around plaza (north, east, west); join to track outer wall endpoints
    const conc = T.concrete.clone(); conc.repeat.set(30, 1); conc.needsUpdate = true;
    const wm = this._mat({ map: T.wall, roughness: 0.7 });
    const wallBox = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const g = new THREE.BoxGeometry(0.4, 1.05, len); g.rotateY(Math.atan2(x1 - x0, z1 - z0)); g.translate((x0 + x1) / 2, 0.52, (z0 + z1) / 2);
      return g;
    };
    // find nearest track wall endpoints near x0/x1
    const ends = this._plazaWallEnds();
    const g = [];
    g.push(wallBox(ends.w[0], ends.w[1], P.x0, P.z1));
    g.push(wallBox(P.x0, P.z1, P.x1, P.z1));
    // east wall has a gate to the Drift Park access road
    const gz1 = PARK_ROAD.z1 + 2, gz0 = PARK_ROAD.z0 - 2;
    g.push(wallBox(P.x1, P.z1, P.x1, gz1));
    g.push(wallBox(P.x1, gz0, ends.e[0], ends.e[1]));
    const pw = new THREE.Mesh(mergeGeometries(g), wm); pw.castShadow = true; pw.receiveShadow = true; this.group.add(pw);
    this._addSegment(ends.w[0], ends.w[1], P.x0, P.z1, 1, 0);
    this._addSegment(P.x0, P.z1, P.x1, P.z1, 0, -1);
    this._addSegment(P.x1, P.z1, P.x1, gz1, -1, 0);
    this._addSegment(P.x1, gz0, ends.e[0], ends.e[1], -1, 0);
    this._buildParkRoad();
    this._buildMeet();

    // pit garages building
    this._pitBuilding();
    // parked cars placeholders positions (filled by game with car clones)
    this.parkingSpots = [];
    for (let k = 0; k < 4; k++) this.parkingSpots.push({ x: -118.4 + k * 6.4, z: 236, heading: Math.PI });
    for (let k = 0; k < 3; k++) this.parkingSpots.push({ x: -111.8 + k * 9.6, z: 214, heading: 0 });
  }

  // car-meet spot (online meeting point): banner, string lights, tents — parking bays are already painted here
  _buildMeet() {
    const cx = -100, cz = 225, grp = new THREE.Group();
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(18, 3), new THREE.MeshBasicMaterial({ map: textTexture('KAIDO MEET', { bg: '#ff1aa0', fg: '#ffffff' }), side: THREE.DoubleSide }));
    banner.position.set(cx, 6.2, cz - 22); grp.add(banner);
    const postM = this._mat({ color: 0x333840, metalness: 0.6, roughness: 0.4 });
    for (const sx of [-9.2, 9.2]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7.6, 8), postM); p.position.set(cx + sx, 3.8, cz - 22); grp.add(p); }
    // string lights (emissive bulbs, toned down at night)
    const bulbM = new THREE.MeshStandardMaterial({ color: 0xffe2a8, emissive: 0xffc860, emissiveIntensity: 1.5 });
    this.emissiveMats.push({ mat: bulbM, night: 2.2, day: 0.2 });
    const bulbs = [];
    const corners = [[cx - 26, cz - 18], [cx + 26, cz - 18], [cx + 26, cz + 18], [cx - 26, cz + 18]];
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 6), postM); pole.position.set(ax, 2.5, az); grp.add(pole);
      for (let i = 0; i < 14; i++) { const t = i / 14, sag = Math.sin(t * Math.PI) * 0.8; const g = new THREE.SphereGeometry(0.09, 6, 4); g.translate(ax + (bx - ax) * t, 4.9 - sag, az + (bz - az) * t); bulbs.push(g); }
    }
    grp.add(new THREE.Mesh(mergeGeometries(bulbs), bulbM));
    // two pop-up tents
    const tentM = this._mat({ color: 0x16c5b8, roughness: 0.8, side: THREE.DoubleSide });
    for (const [tx, tz] of [[cx + 18, cz + 12], [cx + 18, cz - 4]]) {
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.4, 4, 1, true), tentM); roof.position.set(tx, 3.3, tz); roof.rotation.y = Math.PI / 4; grp.add(roof);
      const e = 2.4; this._addSegment(tx - e, tz - e, tx + e, tz - e, 0, -1); this._addSegment(tx + e, tz - e, tx + e, tz + e, 1, 0); this._addSegment(tx + e, tz + e, tx - e, tz + e, 0, 1); this._addSegment(tx - e, tz + e, tx - e, tz - e, -1, 0);
      for (const [dx, dz] of [[-2.3, -2.3], [2.3, -2.3], [2.3, 2.3], [-2.3, 2.3]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 5), postM); l.position.set(tx + dx, 1.3, tz + dz); grp.add(l); }
    }
    this.group.add(grp);
  }

  // access road paddock → Drift Park (the park model itself loads asynchronously)
  _buildParkRoad() {
    const R = PARK_ROAD, L = R.x1 - R.x0, W = R.z1 - R.z0;
    const tex = this.T.plaza.clone(); tex.repeat.set(L / 16, W / 16); tex.needsUpdate = true;
    const mat = this._mat({ map: tex, roughness: 0.85, color: 0xb8b8b8, envMapIntensity: 0.6 });
    const g = new THREE.PlaneGeometry(L, W); g.rotateX(-Math.PI / 2);
    // texture runs along the road: swap uv so u follows x
    const road = new THREE.Mesh(g, mat); road.position.set((R.x0 + R.x1) / 2, 0.012, (R.z0 + R.z1) / 2); road.receiveShadow = true;
    this.group.add(road);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.8, depthWrite: false });
    const lines = [];
    for (let x = R.x0 + 4; x < R.x1 - 4; x += 9) { const l = new THREE.PlaneGeometry(4.5, 0.2); l.rotateX(-Math.PI / 2); l.translate(x + 2.25, 0.025, (R.z0 + R.z1) / 2); lines.push(l); }
    for (const z of [R.z0 + 0.5, R.z1 - 0.5]) { const l = new THREE.PlaneGeometry(L, 0.18); l.rotateX(-Math.PI / 2); l.translate((R.x0 + R.x1) / 2, 0.025, z); lines.push(l); }
    const lm = new THREE.Mesh(mergeGeometries(lines), lineMat); lm.renderOrder = 1; this.group.add(lm);
    // sign + end barrier
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshBasicMaterial({ map: textTexture('DRIFT PARK  →', { bg: '#0b6b66', fg: '#ffffff' }) }));
    sign.position.set(R.x0 + 30, 5.5, R.z0 - 3); this.group.add(sign);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5.5, 0.3), this._mat({ color: 0x777777 })); post.position.set(R.x0 + 30, 2.75, R.z0 - 3.1); this.group.add(post);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, W), this._mat({ map: this.T.wall, roughness: 0.7 })); cap.position.set(R.x1 + 0.25, 0.5, (R.z0 + R.z1) / 2); this.group.add(cap);
    this._addSegment(R.x1, R.z0, R.x1, R.z1, -1, 0);
    // vegetation must not grow on the road or in the park
    for (let x = R.x0; x <= R.x1; x += 16) this.blockers.push({ x, z: (R.z0 + R.z1) / 2, r: 16 });
    this.blockers.push({ x: PARK.ox, z: PARK.oz + 60, r: 300 });
    this.park = new DriftPark(this);
    this.group.add(this.park.group);
  }

  _plazaWallEnds() {
    const L = this.wallLines.R;
    let w = [PLAZA.x0, PLAZA.z0 + 10], e = [PLAZA.x1, PLAZA.z0 + 10], bw = 1e9, be = 1e9;
    for (const run of L) for (const end of [run[0], run[run.length - 1]]) {
      const dw = Math.hypot(end[0] - PLAZA.x0, end[1] - (PLAZA.z0 + 12));
      const de = Math.hypot(end[0] - PLAZA.x1, end[1] - (PLAZA.z0 + 12));
      if (dw < bw) { bw = dw; w = [end[0], end[1]]; }
      if (de < be) { be = de; e = [end[0], end[1]]; }
    }
    return { w, e };
  }

  _pitBuilding() {
    const T = this.T;
    const grp = new THREE.Group();
    const wallMat = this._mat({ color: 0xd9dde3, roughness: 0.6, metalness: 0.2 });
    const darkMat = this._mat({ color: 0x1b1e24, roughness: 0.5, metalness: 0.4 });
    const glassMat = this._mat({ color: 0x223344, roughness: 0.1, metalness: 0.9, emissive: 0x88aacc, emissiveIntensity: 0.25 });
    this.emissiveMats.push({ mat: glassMat, night: 0.9, day: 0.1 });
    const interior = this._mat({ color: 0x5a5852, emissive: 0xffe9cc, emissiveIntensity: 0.8, roughness: 1 });
    this.emissiveMats.push({ mat: interior, night: 1.6, day: 0.3 });
    // main block: 14 garages from x=-40 to 120
    const x0 = -36, x1 = 124, zf = 300, depth = 16;
    const body = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 9, depth), wallMat);
    body.position.set((x0 + x1) / 2, 4.5, zf + depth / 2); body.castShadow = true; body.receiveShadow = true; grp.add(body);
    const n = 12, bw = (x1 - x0) / n;
    const doorG = [], frameG = [];
    for (let k = 0; k < n; k++) {
      const cx = x0 + bw * (k + 0.5);
      const d = new THREE.BoxGeometry(bw - 2.2, 4.8, 0.3); d.translate(cx, 2.4, zf - 0.05); doorG.push(d);
      const f = new THREE.BoxGeometry(0.6, 9, 1.2); f.translate(x0 + bw * k, 4.5, zf); frameG.push(f);
    }
    const doors = new THREE.Mesh(mergeGeometries(doorG), interior); grp.add(doors);
    const frames = new THREE.Mesh(mergeGeometries(frameG), darkMat); frames.castShadow = true; grp.add(frames);
    // upper glass hospitality level
    const glass = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 2, 2.6, 0.4), glassMat);
    glass.position.set((x0 + x1) / 2, 7, zf - 0.1); grp.add(glass);
    // roof overhang
    const roof = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 4, 0.5, depth + 6), darkMat);
    roof.position.set((x0 + x1) / 2, 9.25, zf + depth / 2 - 3); roof.castShadow = true; grp.add(roof);
    // banner on roof
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(60, 6), new THREE.MeshStandardMaterial({ map: T.sponsor[0], emissive: 0xffffff, emissiveMap: T.sponsor[0], emissiveIntensity: 0.6 }));
    banner.position.set((x0 + x1) / 2, 13, zf + 2); banner.rotation.y = Math.PI; grp.add(banner);
    this.emissiveMats.push({ mat: banner.material, night: 1.2, day: 0.2 });
    const bpole = new THREE.Mesh(new THREE.BoxGeometry(62, 0.6, 0.6), darkMat); bpole.position.set((x0 + x1) / 2, 9.9, zf + 2.2); grp.add(bpole);

    // control tower (west of garages)
    const tower = new THREE.Mesh(new THREE.BoxGeometry(14, 22, 14), wallMat);
    tower.position.set(-56, 11, zf + 8); tower.castShadow = true; grp.add(tower);
    const tglass = new THREE.Mesh(new THREE.BoxGeometry(16, 4, 16), glassMat);
    tglass.position.set(-56, 24, zf + 8); grp.add(tglass);
    const tcap = new THREE.Mesh(new THREE.BoxGeometry(17, 1, 17), darkMat); tcap.position.set(-56, 26.5, zf + 8); grp.add(tcap);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(13, 3), new THREE.MeshStandardMaterial({ map: textTexture('HAKONE BAY', { bg: '#0b0b12', fg: '#ff2d55' }), emissive: 0xffffff, emissiveIntensity: 0.7 }));
    logo.material.emissiveMap = logo.material.map;
    logo.position.set(-56, 18, zf + 0.9); logo.rotation.y = Math.PI; grp.add(logo);
    this.emissiveMats.push({ mat: logo.material, night: 1.4, day: 0.2 });
    this.group.add(grp);
  }

  _buildStartGantry() {
    const t = this.track, T = this.T;
    const p = t.pointAt(START_S);
    const hw = p.hw + 2.5;
    const grp = new THREE.Group();
    const steel = this._mat({ color: 0x23262d, roughness: 0.4, metalness: 0.7 });
    const legG = new THREE.BoxGeometry(0.8, 9, 0.8);
    const l1 = new THREE.Mesh(legG, steel); l1.position.set(-hw, 4.5, 0);
    const l2 = new THREE.Mesh(legG, steel); l2.position.set(hw, 4.5, 0);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.8, 1.6, 1.2), steel); beam.position.set(0, 8.2, 0);
    for (const m of [l1, l2, beam]) { m.castShadow = true; grp.add(m); }
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.6, 1.4), new THREE.MeshStandardMaterial({ map: T.sponsor[0], emissive: 0xffffff, emissiveMap: T.sponsor[0], emissiveIntensity: 0.8 }));
    sign.position.set(0, 8.2, -0.62); sign.rotation.y = Math.PI; grp.add(sign);
    const sign2 = sign.clone(); sign2.position.z = 0.62; sign2.rotation.y = 0; grp.add(sign2);
    this.emissiveMats.push({ mat: sign.material, night: 1.4, day: 0.3 });
    // countdown lights (5 pairs)
    this.startLights = [];
    for (let k = 0; k < 5; k++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), m);
      lamp.position.set(-2.4 + k * 1.2, 6.9, -0.4);
      grp.add(lamp); this.startLights.push(m);
    }
    grp.position.set(p.x, 0, p.z);
    // beam spans across track (local x along left normal, local z forward)
    grp.rotation.y = Math.atan2(p.tx, p.tz);
    this.group.add(grp);
    this.gantry = grp;
  }

  setStartLights(n, green = false) {
    if (!this.startLights) return;
    this.startLights.forEach((m, k) => {
      if (green) { m.emissive.setHex(0x10ff40); m.emissiveIntensity = 4; }
      else { m.emissive.setHex(0xff1010); m.emissiveIntensity = k < n ? 5 : 0; }
    });
  }

  _buildGrandstands() {
    const t = this.track;
    const mk = (s0, s1, side, dist, rows = 12) => {
      const geos = [], crowd = [];
      const sgn = side === 'L' ? 1 : -1;
      for (let s = s0; s < s1; s += 4) {
        const p = t.pointAt(s), q = t.pointAt(s + 4);
        const [lx, lz] = [p.tz, -p.tx];
        for (let r = 0; r < rows; r++) {
          const d = dist + r * 1.1;
          const ax = p.x + lx * sgn * d, az = p.z + lz * sgn * d;
          const bx = q.x + q.tz * sgn * d, bz = q.z - q.tx * sgn * d;
          const len = Math.hypot(bx - ax, bz - az) + 0.05;
          const g = new THREE.BoxGeometry(1.1, 0.55, len);
          g.rotateY(Math.atan2(bx - ax, bz - az));
          g.translate((ax + bx) / 2, 0.6 + r * 0.55, (az + bz) / 2);
          geos.push(g);
          if (r % 1 === 0) {
            const c = new THREE.BoxGeometry(0.45, 0.7, len * 0.92);
            c.rotateY(Math.atan2(bx - ax, bz - az));
            c.translate((ax + bx) / 2, 1.2 + r * 0.55, (az + bz) / 2);
            crowd.push(c);
          }
        }
        // back wall
      }
      for (let s = s0; s <= s1; s += 6) { const p = t.pointAt(s); const d = dist + rows * 0.55; this.blockers.push({ x: p.x + p.tz * sgn * d, z: p.z - p.tx * sgn * d, r: rows * 0.6 + 6 }); }
      const stand = new THREE.Mesh(mergeGeometries(geos), this._mat({ color: 0x8d939c, roughness: 0.8 }));
      stand.castShadow = true; stand.receiveShadow = true; this.group.add(stand);
      // crowd with procedural colours via vertex colors
      const cg = mergeGeometries(crowd);
      const col = new Float32Array(cg.attributes.position.count * 3);
      const palette = [[0.9, 0.2, 0.25], [0.2, 0.3, 0.8], [0.95, 0.95, 0.95], [0.1, 0.1, 0.12], [0.95, 0.75, 0.1], [0.3, 0.7, 0.4]];
      for (let i = 0; i < cg.attributes.position.count; i += 24) {
        const c = palette[(i * 7919) % palette.length];
        for (let k = 0; k < 24 && i + k < cg.attributes.position.count; k++) { col[(i + k) * 3] = c[0]; col[(i + k) * 3 + 1] = c[1]; col[(i + k) * 3 + 2] = c[2]; }
      }
      cg.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const cm = new THREE.Mesh(cg, this._mat({ vertexColors: true, roughness: 0.9 }));
      this.group.add(cm);
      // roof
      const pm = t.pointAt((s0 + s1) / 2);
      const len = s1 - s0;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(rows * 1.1 + 3, 0.4, len), this._mat({ color: 0xe8e8ea, roughness: 0.5, metalness: 0.3 }));
      const d = dist + rows * 0.55;
      roof.position.set(pm.x + pm.tz * sgn * d, 2 + rows * 0.55 + 4, pm.z - pm.tx * sgn * d);
      roof.rotation.y = Math.atan2(pm.tx, pm.tz);
      roof.castShadow = true; this.group.add(roof);
      const colG = [];
      for (let s = s0; s <= s1; s += 20) {
        const p = t.pointAt(s); const dd = dist + rows * 1.1 + 0.6;
        const g = new THREE.CylinderGeometry(0.25, 0.25, 2 + rows * 0.55 + 4, 8);
        g.translate(p.x + p.tz * sgn * dd, (2 + rows * 0.55 + 4) / 2, p.z - p.tx * sgn * dd); colG.push(g);
      }
      this.group.add(new THREE.Mesh(mergeGeometries(colG), this._mat({ color: 0x30343b, metalness: 0.6, roughness: 0.4 })));
    };
    // main straight, infield side (left)
    mk(-40, 200, 'L', 22, 14);
    // hairpin T7 outside
    const tt = this._sAtPoint(262, -245);
    mk(tt - 70, tt + 30, 'R', 26, 10);
    // T1 outside
    const t1 = this._sAtPoint(300, 60);
    mk(t1 - 40, t1 + 50, 'L', 24, 9);
  }

  _sAtPoint(x, z) { return this.track.project(x, z).s; }

  _buildLights() {
    // floodlight poles along the circuit (instanced) + light pools
    const t = this.track;
    const poleH = this.quality === 'low' ? 12 : 14;
    const positions = [];
    for (let s = 0; s < t.length; s += 55) {
      const p = t.pointAt(s);
      const i = p.i;
      const side = t.curv[i] >= 0 ? -1 : 1; // outside of corner
      const off = (side > 0 ? this.offL[i] : this.offR[i]) + 2.5;
      const sx = p.x + p.tz * side * off, sz = p.z - p.tx * side * off;
      // skip in plaza
      if (sx > PLAZA.x0 - 3 && sx < PLAZA.x1 + 3 && sz > PLAZA.z0 - 5 && sz < PLAZA.z1 + 3) continue;
      positions.push({ x: sx, z: sz, dirx: -p.tz * side, dirz: p.tx * side });
    }
    // paddock poles
    for (const [x, z] of [[-100, 200], [-20, 205], [60, 205], [110, 270], [10, 275], [-90, 275], [100, 205]]) positions.push({ x, z, dirx: 0, dirz: -1 });
    this.lampPositions = positions;
    const poleGeo = new THREE.CylinderGeometry(0.18, 0.28, poleH, 8); poleGeo.translate(0, poleH / 2, 0);
    const armGeo = new THREE.BoxGeometry(0.2, 0.2, 2.8); armGeo.translate(0, poleH, 1.3);
    const headGeo = new THREE.BoxGeometry(1.4, 0.35, 0.8); headGeo.translate(0, poleH - 0.2, 2.6);
    const steel = this._mat({ color: 0x3a3f47, roughness: 0.5, metalness: 0.6 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 3 });
    this.emissiveMats.push({ mat: this.lampMat, night: 6, day: 0.4 });
    const pole = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]), steel, positions.length);
    const head = new THREE.InstancedMesh(headGeo, this.lampMat, positions.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    positions.forEach((p, k) => {
      e.set(0, Math.atan2(p.dirx, p.dirz), 0); q.setFromEuler(e);
      m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(1, 1, 1));
      pole.setMatrixAt(k, m); head.setMatrixAt(k, m);
      p.hx = p.x + p.dirx * 2.6; p.hz = p.z + p.dirz * 2.6; p.hy = poleH - 0.3;
    });
    pole.castShadow = true;
    this.group.add(pole, head);
    // light pools (additive decals, night only)
    const poolMat = new THREE.MeshBasicMaterial({ map: this.T.pool, color: 0xffe2b8, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
    this.poolMat = poolMat;
    const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, positions.length);
    positions.forEach((p, k) => {
      m.compose(new THREE.Vector3(p.x + p.dirx * 9, 0.05, p.z + p.dirz * 9), new THREE.Quaternion(), new THREE.Vector3(30, 1, 30));
      pools.setMatrixAt(k, m);
    });
    pools.renderOrder = 2; pools.frustumCulled = false;
    this.pools = pools;
    this.group.add(pools);
    // flare sprites at lamp heads
    const flareMat = new THREE.SpriteMaterial({ map: this.T.glow, color: 0xffe9c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 });
    this.flareMat = flareMat;
    this.flares = new THREE.Group();
    positions.forEach(p => { const s = new THREE.Sprite(flareMat); s.position.set(p.hx, p.hy - 0.3, p.hz); s.scale.set(4, 4, 1); this.flares.add(s); });
    this.group.add(this.flares);
  }

  _buildScenery() {
    const t = this.track;
    const rnd = (() => { let s = 1234567; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const nearTrack = (x, z, margin) => { const p = t.project(x, z); return p.dist < Math.max(this.offL[p.i], this.offR[p.i]) + margin; };
    const inPlaza = (x, z, m = 8) => x > PLAZA.x0 - m && x < PLAZA.x1 + m && z > PLAZA.z0 - m && z < PLAZA.z1 + m;

    // ---------- procedural low-poly trees (replaced near the circuit by the nature pack when it loads)
    const treeCount = this.quality === 'low' ? 450 : this.quality === 'ultra' ? 1600 : 1000;
    this.buildProcTrees(treeCount, 0);

    // ---------- industrial buildings around the circuit
    const bMat = this._mat({ color: 0x9aa0a8, roughness: 0.8, metalness: 0.2 });
    const roofMat = this._mat({ color: 0x5a6068, roughness: 0.6, metalness: 0.5 });
    const bGeos = [], rGeos = [];
    const spots = [[380, 150, 60, 40, 14], [390, -60, 50, 70, 18], [360, -260, 70, 45, 12], [-380, 200, 55, 60, 16], [-390, -40, 45, 80, 20], [-330, -300, 80, 40, 14], [150, 390, 90, 40, 18], [-200, 380, 70, 45, 13], [40, -380, 100, 40, 15]];
    for (const [x, z, w, d, h] of spots) {
      this.blockers.push({ x, z, r: Math.max(w, d) * 0.6 + 6 });
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, h / 2, z); bGeos.push(g);
      const r = new THREE.BoxGeometry(w + 1, 1, d + 1); r.translate(x, h + 0.5, z); rGeos.push(r);
      // chimney / tanks
      const c = new THREE.CylinderGeometry(2, 2, h * 1.8, 12); c.translate(x + w / 2 - 5, h * 0.9, z - d / 2 + 5); rGeos.push(c);
    }
    const bm = new THREE.Mesh(mergeGeometries(bGeos), bMat); bm.castShadow = true; bm.receiveShadow = true; this.group.add(bm);
    this.group.add(new THREE.Mesh(mergeGeometries(rGeos), roofMat));

    // ---------- distant city skyline with lit windows (ring)
    const winTex = this.T.windows;
    const skyMat = new THREE.MeshStandardMaterial({ color: 0x1a1d26, map: winTex, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 1.2, roughness: 0.8 });
    this.emissiveMats.push({ mat: skyMat, night: 1.4, day: 0.0 });
    const cityG = [];
    for (let k = 0; k < 140; k++) {
      const a = rnd() * Math.PI * 2;
      if (Math.sin(a) > 0.6 && rnd() < 0.7) continue; // bay side mostly open (south)
      const r = 820 + rnd() * 380;
      const w = 20 + rnd() * 40, h = 30 + Math.pow(rnd(), 2) * 160, d = 20 + rnd() * 40;
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 40, uv.getY(i) * h / 60);
      g.translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      cityG.push(g);
    }
    const city = new THREE.Mesh(mergeGeometries(cityG), skyMat);
    this.group.add(city);
    this._buildMountains();
    // sea plane (south bay)
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 900), new THREE.MeshStandardMaterial({ color: 0x0c1f2e, roughness: 0.15, metalness: 0.6 }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.0, 950);
    this.group.add(sea);

    // ---------- footbridge over the back straight
    const bs = this._sAtPoint(-20, -248);
    const p = t.pointAt(bs);
    const span = 2 * (p.hw + RUNOFF) + 4;
    const br = new THREE.Group();
    const steel = this._mat({ color: 0x2a2e36, metalness: 0.7, roughness: 0.4 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(span, 1.2, 3.5), steel); deck.position.y = 6.5; deck.castShadow = true; br.add(deck);
    for (const sx of [-span / 2, span / 2]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 6.5, 3), steel); leg.position.set(sx, 3.25, 0); leg.castShadow = true; br.add(leg); }
    const bannerMat = new THREE.MeshStandardMaterial({ map: this.T.sponsor[3], emissive: 0xffffff, emissiveMap: this.T.sponsor[3], emissiveIntensity: 0.8, side: THREE.DoubleSide });
    this.emissiveMats.push({ mat: bannerMat, night: 1.3, day: 0.2 });
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.8, 2.2), bannerMat); bb.position.set(0, 8.3, 0); br.add(bb);
    br.position.set(p.x, 0, p.z); br.rotation.y = Math.atan2(p.tx, p.tz);
    this.group.add(br);

    // ---------- fences behind walls (simple mesh fence along outer track sections)
    // (kept light: instanced posts)
  }

  // realistic mountain range: fractal (ridged) heightfield ring around the circuit,
  // height/slope based colouring (forest, rock, snow) and distance haze
  _buildMountains() {
    const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
    const noise = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
      return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
    };
    const ridged = (x, y) => {
      let sum = 0, amp = 0.55, f = 1, w = 1;
      for (let o = 0; o < 6; o++) {
        let n = 1 - Math.abs(noise(x * f, y * f)); n *= n; n *= w; w = Math.min(1, n * 1.8);
        sum += n * amp; amp *= 0.5; f *= 2.03;
      }
      return sum;
    };
    const fbm = (x, y) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += noise(x * f, y * f) * a; a *= 0.5; f *= 2; } return s; };
    const RS = this.quality === 'low' ? 36 : 64, AS = this.quality === 'low' ? 220 : 420;
    const r0 = 1050, r1 = 3300;
    const pos = new Float32Array((RS + 1) * (AS + 1) * 3), col = new Float32Array((RS + 1) * (AS + 1) * 3);
    const idx = [];
    const cForest = new THREE.Color(0x1f3a22), cForest2 = new THREE.Color(0x2f4a28), cRock = new THREE.Color(0x6a655d), cRock2 = new THREE.Color(0x8a8378), cSnow = new THREE.Color(0xeef2f5), tmp = new THREE.Color();
    const H = new Float32Array((RS + 1) * (AS + 1));
    for (let i = 0; i <= RS; i++) {
      const t = i / RS; const r = r0 + (r1 - r0) * Math.pow(t, 1.35);
      for (let j = 0; j <= AS; j++) {
        const th = j / AS * Math.PI * 2;
        const x = Math.cos(th) * r + 10, z = Math.sin(th) * r - 40;
        // envelope: rises behind the skyline, peaks mid-ring, lower toward the far edge
        let env = Math.min(1, Math.max(0, (r - 1150) / 650)) * (1 - Math.max(0, (r - 2700) / 900) * 0.6);
        // open bay to the south (sea side)
        const south = Math.max(0, Math.sin(th)); env *= 1 - Math.pow(south, 3) * 0.85;
        const k = 1 / 900;
        let h = ridged(x * k + 13.1, z * k - 7.4) * 760 + fbm(x * k * 3, z * k * 3) * 70;
        h = h * env + fbm(x * k * 0.7 + 50, z * k * 0.7) * 30 * env - 6;
        // a few big hero peaks
        h += Math.max(0, fbm(x / 2600 + 3, z / 2600 - 1)) * 520 * env;
        H[i * (AS + 1) + j] = h;
        const o = (i * (AS + 1) + j) * 3;
        pos[o] = x; pos[o + 1] = h; pos[o + 2] = z;
      }
    }
    for (let i = 0; i < RS; i++) for (let j = 0; j < AS; j++) {
      const a = i * (AS + 1) + j, b = a + 1, c = a + AS + 1, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    for (let v = 0; v < nrm.count; v++) {
      const h = pos[v * 3 + 1], up = nrm.getY(v);
      const n = (hash(Math.floor(pos[v * 3] / 37), Math.floor(pos[v * 3 + 2] / 37)) - 0.5) * 0.15;
      const snowLine = 430 + n * 300;
      const steep = 1 - up; // 0 flat .. 1 vertical
      tmp.copy(cForest).lerp(cForest2, Math.min(1, Math.max(0, h / 250 + n)));
      const rock = Math.min(1, Math.max(0, (steep - 0.28) * 4 + (h - 330) / 220));
      tmp.lerp(rock > 0.5 ? cRock2 : cRock, rock);
      const snow = Math.min(1, Math.max(0, (h - snowLine) / 80)) * Math.min(1, Math.max(0, (up - 0.55) * 4));
      tmp.lerp(cSnow, snow);
      col[v * 3] = tmp.r; col[v * 3 + 1] = tmp.g; col[v * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, fog: false, envMapIntensity: 0.2 });
    this.hazeU = { color: { value: new THREE.Color(0x9fb6cc) }, amount: { value: 0.6 } };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.hazeColor = this.hazeU.color; sh.uniforms.hazeAmount = this.hazeU.amount;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vDist;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDist = length(mvPosition.xyz);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDist; uniform vec3 hazeColor; uniform float hazeAmount;')
        .replace('#include <dithering_fragment>', 'float hz = clamp(pow(max(0.0, vDist - 700.0) / 2600.0, 0.75), 0.0, 1.0) * hazeAmount;\ngl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor, hz);\n#include <dithering_fragment>');
    };
    this.mountains = new THREE.Mesh(g, mat);
    this.mountains.name = 'mountains';
    this.mountains.receiveShadow = false;
    this.group.add(this.mountains);
  }

  setHaze(color, amount) { if (this.hazeU) { this.hazeU.color.value.copy(color); this.hazeU.amount.value = amount; } }

  // free spot for decoration? (away from walls, paddock, stands, buildings, boards)
  isFree(x, z, margin = 8) {
    if (x > PLAZA.x0 - margin && x < PLAZA.x1 + margin && z > PLAZA.z0 - margin && z < PLAZA.z1 + margin) return false;
    const p = this.track.project(x, z);
    if (p.dist < Math.max(this.offL[p.i], this.offR[p.i]) + margin) return false;
    for (const b of this.blockers) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.r * b.r) return false;
    if (z > 560) return false; // sea side
    return true;
  }

  // low-poly instanced trees; minRadius > 0 keeps them only in the far background ring
  buildProcTrees(treeCount, minRadius = 0) {
    if (this.procTrees) { this.procTrees.forEach(m => { m.removeFromParent(); m.geometry.dispose(); }); this.procTrees = null; }
    const rnd = (() => { let s = 1234567; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
    const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 3, 6); trunkG.translate(0, 1.5, 0);
    const pineG = mergeGeometries([new THREE.ConeGeometry(2.6, 5, 7).translate(0, 5, 0), new THREE.ConeGeometry(2.0, 4, 7).translate(0, 7.5, 0), new THREE.ConeGeometry(1.3, 3, 7).translate(0, 9.6, 0)]);
    const trunks = new THREE.InstancedMesh(trunkG, this._mat({ color: 0x4a3626, roughness: 1 }), treeCount);
    const leaves = new THREE.InstancedMesh(pineG, this._mat({ color: 0x2f5a2c, roughness: 0.95, flatShading: true }), treeCount);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    let n = 0, tries = 0;
    const span = minRadius > 0 ? 1500 : 1100;
    while (n < treeCount && tries < treeCount * 30) {
      tries++;
      const x = (rnd() - 0.5) * span + 10, z = (rnd() - 0.5) * (minRadius > 0 ? 1300 : 950) - 40;
      if (minRadius > 0 && Math.hypot(x - 10, z + 40) < minRadius) continue;
      if (!this.isFree(x, z, 8)) continue;
      const sc = 0.7 + rnd() * 0.9;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(sc, sc * (0.8 + rnd() * 0.5), sc));
      trunks.setMatrixAt(n, m); leaves.setMatrixAt(n, m);
      col.setHSL(0.27 + rnd() * 0.08, 0.35 + rnd() * 0.2, 0.18 + rnd() * 0.12); leaves.setColorAt(n, col);
      n++;
    }
    trunks.count = leaves.count = n;
    leaves.castShadow = this.quality !== 'low' && minRadius === 0; trunks.castShadow = false;
    leaves.receiveShadow = true;
    this.group.add(trunks, leaves);
    this.procTrees = [trunks, leaves];
  }

  _buildSigns() {
    const t = this.track, T = this.T;
    // sponsor billboards along straights (outside walls)
    const boards = [];
    let k = 0;
    for (let s = 60; s < t.length; s += 140) {
      const p = t.pointAt(s); const i = p.i;
      if (Math.abs(t.curv[i]) > 1 / 200) continue;
      const side = (k % 2) ? 1 : -1; k++;
      const off = (side > 0 ? this.offL[i] : this.offR[i]) + 1.5;
      const x = p.x + p.tz * side * off, z = p.z - p.tx * side * off;
      if (x > PLAZA.x0 - 5 && x < PLAZA.x1 + 5 && z > PLAZA.z0 - 8) continue;
      this.blockers.push({ x, z, r: 10 });
      boards.push({ x, z, rot: Math.atan2(-p.tz * side, p.tx * side), tex: T.sponsor[k % T.sponsor.length] });
    }
    const legMat = this._mat({ color: 0x2b2f36, metalness: 0.6, roughness: 0.5 });
    for (const b of boards) {
      const mat = new THREE.MeshStandardMaterial({ map: b.tex, emissive: 0xffffff, emissiveMap: b.tex, emissiveIntensity: 0.5, roughness: 0.6 });
      this.emissiveMats.push({ mat, night: 0.9, day: 0.05 });
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), mat); panel.position.y = 4.5; g.add(panel);
      const back = new THREE.Mesh(new THREE.BoxGeometry(16.2, 3.2, 0.2), legMat); back.position.set(0, 4.5, -0.12); g.add(back);
      for (const lx of [-6, 6]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3, 0.3), legMat); l.position.set(lx, 1.5, -0.1); g.add(l); }
      g.position.set(b.x, 0, b.z); g.rotation.y = b.rot;
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      this.group.add(g);
    }
    // corner numbers & braking boards before tight corners
    let corner = 0, lastS = -999;
    for (let i = 0; i < t.N; i++) {
      if (Math.abs(t.curv[i]) > 1 / 45 && t.s[i] - lastS > 120) {
        corner++; lastS = t.s[i];
        for (const dist of [100, 50]) {
          const p = t.pointAt(t.s[i] - dist - 30);
          const side = t.curv[i] > 0 ? -1 : 1;
          const off = p.hw + 3.5;
          const x = p.x + p.tz * side * off, z = p.z - p.tx * side * off;
          const mat = new THREE.MeshStandardMaterial({ map: textTexture(String(dist), { w: 256, h: 256, bg: '#f4f4f4', fg: '#111', font: '900 150px "Arial Black", Impact, sans-serif' }), emissive: 0xffffff, emissiveIntensity: 0.15 });
          mat.emissiveMap = mat.map;
          const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), mat);
          board.position.set(x, 1.2, z); board.rotation.y = Math.atan2(-p.tx, -p.tz);
          this.group.add(board);
        }
        const p = t.pointAt(t.s[i] - 10);
        const side = t.curv[i] > 0 ? -1 : 1;
        const off = (side > 0 ? this.offL[p.i] : this.offR[p.i]) - 0.6;
        const mat = new THREE.MeshStandardMaterial({ map: textTexture('T' + corner, { w: 256, h: 256, bg: '#c4161c', fg: '#fff' }), emissive: 0xffffff, emissiveIntensity: 0.3 });
        mat.emissiveMap = mat.map;
        this.emissiveMats.push({ mat, night: 0.6, day: 0.1 });
        const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), mat);
        b.position.set(p.x + p.tz * side * off, 2.6, p.z - p.tx * side * off); b.rotation.y = Math.atan2(-p.tx, -p.tz);
        this.group.add(b);
      }
    }
    this.cornerCount = corner;
  }

  _buildCones() {
    // dynamic cones: donut zone ring + chicane markers
    const coneGeo = mergeGeometries([new THREE.ConeGeometry(0.22, 0.7, 12).translate(0, 0.39, 0), new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0)]);
    const coneMat = this._mat({ color: 0xff5a00, roughness: 0.5, emissive: 0x220800 });
    const spots = [];
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; spots.push([DONUT.x + Math.cos(a) * 8, DONUT.z + Math.sin(a) * 8]); }
    // slalom in paddock
    for (let k = 0; k < 8; k++) spots.push([-30 + k * 12, 262]);
    // apex cones at a few corners
    for (const s of [this._sAtPoint(225, -40), this._sAtPoint(262, -245), this._sAtPoint(-265, 75), this._sAtPoint(15, -50)]) {
      const p = this.track.pointAt(s); const k = p.curv; const side = k > 0 ? 1 : -1;
      for (const d of [-6, 0, 6]) { const q = this.track.pointAt(s + d, side * (p.hw + 0.9)); spots.push([q.x, q.z]); }
    }
    this.coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, spots.length);
    this.coneMesh.castShadow = true;
    this.coneMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    spots.forEach(([x, z], i) => this.props.push({ x, z, x0: x, z0: z, vx: 0, vz: 0, y: 0, vy: 0, rx: 0, rz: 0, wx: 0, wz: 0, r: 0.3, hit: false, idx: i }));
    this.group.add(this.coneMesh);
    this.updateProps(0);
  }

  resetProps() { for (const p of this.props) { p.x = p.x0; p.z = p.z0; p.vx = p.vz = p.vy = p.y = p.rx = p.rz = p.wx = p.wz = 0; p.hit = false; } this.updateProps(0); }

  updateProps(dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    let any = false;
    for (const p of this.props) {
      if (dt > 0 && (p.vx || p.vz || p.vy || p.y > 0)) {
        p.vy -= 9.81 * dt; p.y += p.vy * dt;
        if (p.y < 0) { p.y = 0; p.vy = -p.vy * 0.3; if (Math.abs(p.vy) < 0.5) p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; p.wx *= 0.7; p.wz *= 0.7; }
        p.x += p.vx * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.rz += p.wz * dt;
        const f = p.y > 0 ? 0.998 : Math.max(0, 1 - 3 * dt);
        p.vx *= f; p.vz *= f;
        if (Math.abs(p.vx) < 0.02 && Math.abs(p.vz) < 0.02 && p.y === 0) { p.vx = p.vz = 0; p.wx = p.wz = 0; }
        any = true;
      }
      if (dt === 0 || any) {
        // lying cones stay tipped
        e.set(p.rx, 0, p.rz); q.setFromEuler(e);
        m.compose(v.set(p.x, p.y, p.z), q, s);
        this.coneMesh.setMatrixAt(p.idx, m);
      }
    }
    this.coneMesh.instanceMatrix.needsUpdate = true;
  }

  _buildZones() {
    // clipping zones: outer points of major corners (score bonus when passing close while drifting)
    const t = this.track;
    const zMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 2, transparent: true, opacity: 0.85 });
    this.zoneMat = zMat;
    const posts = [];
    let last = -999;
    for (let i = 0; i < t.N; i++) {
      const k = t.curv[i];
      if (Math.abs(k) > 1 / 70 && t.s[i] - last > 90) {
        // find local max curvature
        let best = i; for (let j = i; j < i + 25; j++) if (Math.abs(t.curv[j % t.N]) > Math.abs(t.curv[best % t.N])) best = j;
        best %= t.N; last = t.s[best];
        const side = t.curv[best] > 0 ? -1 : 1; // outside
        const p = t.pointAt(t.s[best], side * (t.hw[best] + 0.5));
        const pin = t.pointAt(t.s[best], -side * (t.hw[best] - 0.2));
        this.clipZones.push({ x: p.x, z: p.z, s: t.s[best], kind: 'OUTER', r: 4.5 });
        this.clipZones.push({ x: pin.x, z: pin.z, s: t.s[best], kind: 'INNER', r: 3.2 });
        const g1 = new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8); g1.translate(p.x, 1.1, p.z); posts.push(g1);
        const g2 = new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8); g2.translate(pin.x + (pin.x - p.x) * 0.06, 0.6, pin.z + (pin.z - p.z) * 0.06); posts.push(g2);
      }
    }
    if (posts.length) { this.zonePosts = new THREE.Mesh(mergeGeometries(posts), zMat); this.group.add(this.zonePosts); }
  }

  _buildCheckpoints() {
    const t = this.track;
    const n = 12;
    for (let k = 0; k < n; k++) this.checkpoints.push({ s: (START_S + k * t.length / n) % t.length });
  }

  _buildSegmentGrid() {
    this.segCell = 16;
    this.segGrid = new Map();
    const key = (a, b) => a * 92837111 ^ b * 689287499;
    this._segKey = key;
    this.segments.forEach((s, idx) => {
      const minx = Math.floor((Math.min(s.ax, s.bx) - 1) / this.segCell), maxx = Math.floor((Math.max(s.ax, s.bx) + 1) / this.segCell);
      const minz = Math.floor((Math.min(s.az, s.bz) - 1) / this.segCell), maxz = Math.floor((Math.max(s.az, s.bz) + 1) / this.segCell);
      for (let a = minx; a <= maxx; a++) for (let b = minz; b <= maxz; b++) {
        const k = key(a, b); let arr = this.segGrid.get(k); if (!arr) { arr = []; this.segGrid.set(k, arr); } arr.push(idx);
      }
    });
  }

  segmentsNear(x, z) {
    const a = Math.floor(x / this.segCell), b = Math.floor(z / this.segCell);
    const out = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const arr = this.segGrid.get(this._segKey(a + i, b + j)); if (arr) for (const s of arr) out.add(s); }
    return out;
  }

  // ------------------------------------------------------------------
  surfaceAt(x, z, hint) {
    const P = PLAZA;
    if (this.park && (this.park.onRoad(x, z) || this.park.contains(x, z))) return this.park.isAsphalt(x, z) ? SURF.asphalt : SURF.grass;
    if (x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1) return SURF.asphalt;
    const p = this.track.project(x, z, hint);
    const a = p.dist;
    if (a < p.hw) return SURF.asphalt;
    const left = p.lat > 0;
    const i = p.i;
    if (a < p.hw + 1.4 && (left ? this.curbL[i] : this.curbR[i])) return SURF.curb;
    if (a < p.hw + 2.2 && !(left ? this.gravelL[i] : this.gravelR[i])) return SURF.verge;
    if (left ? this.gravelL[i] : this.gravelR[i]) return SURF.gravel;
    return SURF.grass;
  }

  isNight(night) {
    for (const e of this.emissiveMats) e.mat.emissiveIntensity = night ? e.night * 0.4 : e.day; // toned down: avoids bloom blow-out
    this.poolMat.visible = night; this.pools.visible = night;
    this.flares.visible = night;
  }
}

export const SURF = {
  asphalt: { mu: 1.0, type: 'asphalt' },
  verge: { mu: 0.95, type: 'asphalt' },
  curb: { mu: 0.92, type: 'curb' },
  grass: { mu: 0.55, type: 'grass' },
  gravel: { mu: 0.5, type: 'gravel' },
};
