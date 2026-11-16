// =====================================================================
//  Track centre-line, sampling and spatial queries (pure JS)
//  "Hakone Bay International Drift Circuit"
// =====================================================================

// Control points [x, z, halfWidth]. Driven in this order (closed loop).
export const CONTROL_POINTS = [
  [-170, 170, 8], [-40, 172, 8], [90, 170, 8], [190, 165, 8],     // main straight (start/finish)
  [262, 140, 8.5], [300, 85, 9], [302, 20, 9],                     // T1 long right sweeper
  [275, -25, 9], [225, -40, 9],                                    // T2 tightening
  [170, -25, 9], [135, 15, 9.5], [85, 30, 9.5],                    // T3/T4 S transition
  [35, 5, 9.5], [15, -50, 9],                                      // T5
  [45, -110, 9], [115, -140, 9], [205, -150, 9],                   // T6 long sweeper
  [262, -180, 9.5], [262, -245, 10], [205, -272, 10], [140, -262, 9.5], // T7 hairpin
  [40, -250, 8.5], [-80, -245, 8.5],                               // back straight
  [-185, -225, 9], [-250, -165, 9],                                // T8 sweeper
  [-250, -95, 9], [-200, -55, 9.5], [-165, -5, 9.5],               // T9/T10 chicane
  [-200, 50, 9.5], [-265, 75, 10], [-292, 125, 10], [-262, 168, 9], // T11 hairpin
];

function catmull(p0, p1, p2, p3, t) {
  // centripetal Catmull-Rom
  const alpha = 0.5;
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-4;
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => {
    const k = (tt - ta) / (tb - ta);
    return a.map((v, i) => v + (b[i] - v) * k);
  };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
  const B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}

export class TrackData {
  constructor(points = CONTROL_POINTS, step = 2.0) {
    this.build(points, step);
  }

  build(points, step) {
    const n = points.length;
    // dense sampling
    const dense = [];
    for (let i = 0; i < n; i++) {
      const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
      for (let k = 0; k < 40; k++) dense.push(catmull(p0, p1, p2, p3, k / 40));
    }
    // arc-length resample
    const cum = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1], b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    const N = Math.round(total / step);
    this.length = total;
    this.N = N;
    this.x = new Float32Array(N); this.z = new Float32Array(N); this.hw = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.curv = new Float32Array(N); this.s = new Float32Array(N);
    let j = 0;
    for (let i = 0; i < N; i++) {
      const target = i * total / N;
      while (cum[j + 1] < target) j++;
      const k = (target - cum[j]) / (cum[j + 1] - cum[j]);
      const a = dense[j], b = dense[(j + 1) % dense.length];
      this.x[i] = a[0] + (b[0] - a[0]) * k;
      this.z[i] = a[1] + (b[1] - a[1]) * k;
      this.hw[i] = a[2] + (b[2] - a[2]) * k;
      this.s[i] = target;
    }
    this.ds = total / N;
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz); this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      // signed curvature (positive = turning left)
      const cross = this.tx[a] * this.tz[b] - this.tz[a] * this.tx[b];
      this.curv[i] = -cross / (2 * this.ds); // left = +x when facing +z -> sign flip
    }
    // smooth curvature
    const c2 = new Float32Array(N);
    for (let i = 0; i < N; i++) { let acc = 0; for (let k = -4; k <= 4; k++) acc += this.curv[(i + k + N) % N]; c2[i] = acc / 9; }
    this.curv = c2;
    this._buildGrid();
  }

  // left normal of tangent (tx,tz): left = (tz, -tx)? For heading forward (sin h, cos h), left = (cos h, -sin h)
  // forward (tx,tz) = (sin h, cos h) -> left = (tz, -tx)
  left(i) { return [this.tz[i], -this.tx[i]]; }

  _buildGrid() {
    this.cell = 24;
    this.grid = new Map();
    for (let i = 0; i < this.N; i++) {
      const key = this._key(Math.floor(this.x[i] / this.cell), Math.floor(this.z[i] / this.cell));
      let arr = this.grid.get(key); if (!arr) { arr = []; this.grid.set(key, arr); } arr.push(i);
    }
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  // nearest point on centreline. hint: previous index for speed.
  project(x, z, hint = -1) {
    let best = -1, bestD = Infinity;
    const scan = (i) => { const dx = x - this.x[i], dz = z - this.z[i]; const d = dx * dx + dz * dz; if (d < bestD) { bestD = d; best = i; } };
    if (hint >= 0) {
      for (let k = -12; k <= 12; k++) scan((hint + k + this.N) % this.N);
      if (bestD > 30 * 30) best = -1;
    }
    if (best < 0) {
      bestD = Infinity;
      const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
      for (let r = 1; r <= 4 && best < 0; r++) {
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
          const arr = this.grid.get(this._key(cx + a, cz + b)); if (arr) for (const i of arr) scan(i);
        }
      }
      if (best < 0) for (let i = 0; i < this.N; i += 2) scan(i);
    }
    // refine on segment best..best+1 / best-1..best
    const i = best;
    const n = (i + 1) % this.N, p = (i - 1 + this.N) % this.N;
    let t = (x - this.x[i]) * this.tx[i] + (z - this.z[i]) * this.tz[i];
    const [lx, lz] = this.left(i);
    const lat = (x - this.x[i]) * lx + (z - this.z[i]) * lz;
    let s = this.s[i] + t;
    if (s < 0) s += this.length; if (s >= this.length) s -= this.length;
    return { i, s, lat, dist: Math.abs(lat), hw: this.hw[i], next: n, prev: p };
  }

  // sample at arc length s with lateral offset
  pointAt(s, lat = 0) {
    s = ((s % this.length) + this.length) % this.length;
    const f = s / this.ds; const i = Math.floor(f) % this.N; const k = f - Math.floor(f); const j = (i + 1) % this.N;
    const x = this.x[i] + (this.x[j] - this.x[i]) * k;
    const z = this.z[i] + (this.z[j] - this.z[i]) * k;
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * k, tz = this.tz[i] + (this.tz[j] - this.tz[i]) * k;
    const l = Math.hypot(tx, tz);
    return { x: x + (tz / l) * lat, z: z + (-tx / l) * lat, tx: tx / l, tz: tz / l, i, hw: this.hw[i] + (this.hw[j] - this.hw[i]) * k, curv: this.curv[i] };
  }

  indexAt(s) { s = ((s % this.length) + this.length) % this.length; return Math.floor(s / this.ds) % this.N; }
}

// minimum-curvature racing line by constrained relaxation
export function computeRacingLine(t) {
    const N = t.N;
    const off = new Float32Array(N);
    const px = new Float32Array(N), pz = new Float32Array(N);
    for (let it = 0; it < 400; it++) {
      for (let i = 0; i < N; i++) {
        const [lx, lz] = t.left(i);
        px[i] = t.x[i] + lx * off[i]; pz[i] = t.z[i] + lz * off[i];
      }
      for (let i = 0; i < N; i++) {
        const a = (i - 3 + N) % N, b = (i + 3) % N;
        const mx = (px[a] + px[b]) / 2, mz = (pz[a] + pz[b]) / 2;
        const [lx, lz] = t.left(i);
        const target = (mx - t.x[i]) * lx + (mz - t.z[i]) * lz;
        const lim = t.hw[i] - 2.0;
        off[i] = Math.max(-lim, Math.min(lim, off[i] + (target - off[i]) * 0.6));
      }
    }
    // curvature of racing line and speed profile
    const line = { off, x: new Float32Array(N), z: new Float32Array(N), curv: new Float32Array(N), vmax: new Float32Array(N) };
    for (let i = 0; i < N; i++) { const [lx, lz] = t.left(i); line.x[i] = t.x[i] + lx * off[i]; line.z[i] = t.z[i] + lz * off[i]; }
    for (let i = 0; i < N; i++) {
      const a = (i - 4 + N) % N, b = (i + 4) % N;
      const ax = line.x[i] - line.x[a], az = line.z[i] - line.z[a], bx = line.x[b] - line.x[i], bz = line.z[b] - line.z[i];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      const cross = (ax * bz - az * bx) / (la * lb);
      line.curv[i] = -Math.asin(Math.max(-1, Math.min(1, cross))) / ((la + lb) / 2);
    }
    return line;
  }

// speed profile for a given grip level (AI difficulty)
export function speedProfile(t, L, gripG, accel = 6, decel = 9, vcap = 78) {
    const N = t.N;
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = Math.min(vcap, Math.sqrt(gripG * 9.81 / Math.max(1e-4, Math.abs(L.curv[i]))));
    const ds = t.ds;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = N - 1; i >= 0; i--) { const j = (i + 1) % N; v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * decel * ds)); }
      for (let i = 0; i < N; i++) { const j = (i - 1 + N) % N; v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * accel * ds)); }
    }
    return v;
  }

