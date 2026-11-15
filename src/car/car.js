// =====================================================================
//  Car entity: physics + visual + audio + effects + collisions
// =====================================================================
import * as THREE from 'three';
import { Vehicle, DEFAULT_SPEC } from './physics.js';
import { CarVisual } from './carModel.js';

export const DEFAULT_TUNE = {
  power: 1.0,       // 0.7..1.4
  grip: 1.0,        // 0.85..1.15
  balance: 0.0,     // -0.1 (looser rear) .. +0.1 (more rear grip)
  steerLock: 45,    // degrees 30..62
  handbrake: 1.0,   // 0.6..1.5
  suspension: 0.5,  // 0 soft .. 1 stiff
  rideHeight: 0.0,  // -0.05 .. +0.04 m
  finalDrive: 4.1,  // 3.5 .. 4.6
};

export function specFromTune(t = DEFAULT_TUNE, base = {}) {
  const b = { ...DEFAULT_SPEC, ...base };
  const s = { ...b };
  s.maxTorque = b.maxTorque * t.power;
  s.muFront = b.muFront * t.grip;
  s.muRear = b.muRear * t.grip * (1 + t.balance);
  s.maxSteer = THREE.MathUtils.degToRad(t.steerLock);
  s.handbrake = b.handbrake * t.handbrake;
  s.cgHeight = 0.54 - t.suspension * 0.12 + t.rideHeight * 0.8;
  s.finalDrive = (b.finalDrive || 4.1) * (t.finalDrive / 4.1);
  return s;
}

// physical dimensions taken from the imported model
export function dimsFromTemplate(tpl) {
  if (!tpl || !tpl.wheels || tpl.wheels.length !== 4) return {};
  const wb = tpl.wheelBase || 2.66;
  const r = tpl.wheels[0].center.y;
  return { cgToFront: wb * 0.492, cgToRear: wb * 0.508, trackWidth: tpl.trackWidth || 1.5, wheelRadius: Math.max(0.28, Math.min(0.4, r)) };
}

const _v = new THREE.Vector3();

export class Car {
  constructor(game, tpl, opts = {}) {
    this.game = game;
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || 'Player';
    this.tune = { ...DEFAULT_TUNE, ...(opts.tune || {}) };
    this.baseSpec = { ...(opts.baseSpec || {}), ...dimsFromTemplate(tpl) };
    this.veh = new Vehicle(specFromTune(this.tune, this.baseSpec));
    this.veh.tcs = !!opts.tcs; this.veh.abs = opts.abs !== false;
    this.veh.steerAssist = opts.steerAssist ?? 0.5;
    this.veh.driftAssist = opts.driftAssist ?? 0.5;
    this.veh.autoGear = opts.autoGear !== false;
    this.hint = -1;
    this.veh.surfaceFn = (x, z) => game.world.surfaceAt(x, z, this.hint);
    this.visual = new CarVisual(tpl, { color: opts.color || '#c8102e', finish: opts.finish || 'metallic', rimColor: opts.rimColor, lod: !!opts.lod, headlights: opts.headlights ?? this.isPlayer, castShadow: true });
    game.scene.add(this.visual.root);
    this.engine = game.audio.createEngine({ spatial: !this.isPlayer, volume: this.isPlayer ? 1 : 0.8 });
    this.veh.onShift = () => { this.engine && this.engine.shift(); };
    this.lightsOn = true;
    this.smokeColor = opts.smokeColor || [0.92, 0.92, 0.95];
    this.impactCooldown = 0;
    this.lastImpact = 0;
    this.collisionEvents = [];
    this.trackInfo = null;
    this.ghost = !!opts.ghost;
    this.frozen = false;
    this.emitAcc = [0, 0, 0, 0];
  }

  applyTune(t) {
    this.tune = { ...DEFAULT_TUNE, ...t };
    const keep = { x: this.veh.x, z: this.veh.z, h: this.veh.heading };
    this.veh.setSpec(specFromTune(this.tune, this.baseSpec));
  }

  place(x, z, heading) {
    this.veh.reset(x, z, heading);
    this.hint = -1;
    this.game.effects.skid.break(this);
    for (let i = 0; i < 4; i++) this.game.effects.skid.break(this.name + i);
    this.visual.update(this.veh, 0.016, this.tune.rideHeight);
  }

  get x() { return this.veh.x; } get z() { return this.veh.z; }

  update(dt, input) {
    const v = this.veh;
    if (input) Object.assign(v.input, input);
    if (this.frozen) { v.input.throttle = 0; v.input.brake = 1; v.input.handbrake = 1; }
    this.collisionEvents.length = 0;
    // substeps with collision resolution
    const sub = 3;
    for (let k = 0; k < sub; k++) {
      v.update(dt / sub);
      if (!this.ghost) this.collideWorld();
    }
    this.trackInfo = this.game.world.track.project(v.x, v.z, this.hint);
    this.hint = this.trackInfo.i;
    if (this.impactCooldown > 0) this.impactCooldown -= dt;
    this.visual.update(v, dt, this.tune.rideHeight);
    // scripted drift pose (AI tandem lead car)
    if (this.poseTarget !== undefined) {
      this.pose = (this.pose || 0) + (this.poseTarget - (this.pose || 0)) * Math.min(1, dt * 2.2);
      this.visual.root.rotation.y = v.heading + this.pose;
      for (let i = 0; i < 2; i++) this.visual.wheels[i].pivot.rotation.y = THREE.MathUtils.clamp(v.steer - this.pose * 0.9, -0.7, 0.7);
      if (Math.abs(this.pose) > 0.15) for (const i of [2, 3]) { const w = this.visual.wheels[i]; w.spinner.quaternion.setFromAxisAngle(w.axle, v.wheelAngle[i] + v.time * 60); }
    }
    const night = this.game.env.preset?.night;
    this.visual.setLights({ head: this.lightsOn, brake: (v.gear === -1 ? 0 : v.input.brake) || v.input.handbrake * 0.5, night, reverse: v.gear === -1 });
    if (!this.ghost) this.emitEffects(dt);
    if (this.engine) {
      let skid = 0, slipSp = 0;
      for (let i = 0; i < 4; i++) { skid = Math.max(skid, v.wheelSkid[i] * (v.wheelSurface[i] === 'asphalt' || v.wheelSurface[i] === 'curb' ? 1 : 0.25)); }
      if (this.pose !== undefined && Math.abs(this.pose) > 0.2) skid = Math.max(skid, 0.7);
      const [u, lv] = v.localVel();
      slipSp = Math.hypot(lv, (v.wheelOmega[2] * v.spec.wheelRadius - u));
      this.engine.update({ rpm: v.rpm, throttle: v.input.throttle * (v.shiftTimer > 0 ? 0.2 : 1), skid, slipSpeed: slipSp, offroad: (v.offroad + v.wheelSurface.filter(w => w === 'curb').length * 0.12) * Math.min(1, v.speed / 8), limiter: v.limiterHit }, dt);
      if (this.engine.panner) this.engine.setPosition(v.x, 0.5, v.z);
    }
  }

  // ---------------------------------------------------------------- collisions
  collideWorld() {
    const v = this.veh, W = this.game.world;
    const corners = v.corners(0.88, 2.25, 2.2);
    const segs = W.segmentsNear(v.x, v.z);
    const R = 0.35;
    for (const [px, pz] of corners) {
      for (const si of segs) {
        const s = W.segments[si];
        const ex = s.bx - s.ax, ez = s.bz - s.az;
        const L2 = ex * ex + ez * ez;
        let t = ((px - s.ax) * ex + (pz - s.az) * ez) / L2;
        if (t < -0.05 || t > 1.05) continue;
        t = Math.max(0, Math.min(1, t));
        const cx = s.ax + ex * t, cz = s.az + ez * t;
        const side = (px - cx) * s.nx + (pz - cz) * s.nz; // >0 = on track side
        if (side > R || side < -(s.depth || 2.5)) continue;
        const pen = R - side;
        // push out along wall normal
        v.x += s.nx * pen; v.z += s.nz * pen;
        // impulse
        const [pvx, pvz] = v.pointVel(px, pz);
        const vn = pvx * s.nx + pvz * s.nz;
        if (vn < 0) {
          const e = s.type === 'tyre' ? 0.15 : 0.3;
          const rx = px - v.x, rz = pz - v.z;
          const rn = rz * s.nx - rx * s.nz;
          const m = v.spec.mass, I = v.inertia;
          const jn = -(1 + e) * vn / (1 / m + rn * rn / I);
          // friction along wall
          const tx = -s.nz, tz = s.nx;
          const vt = pvx * tx + pvz * tz;
          const mu = s.type === 'tyre' ? 0.6 : 0.35;
          const rt = rz * tx - rx * tz;
          let jt = -vt / (1 / m + rt * rt / I);
          jt = Math.max(-mu * jn, Math.min(mu * jn, jt));
          v.applyImpulse(px, pz, s.nx * jn + tx * jt, s.nz * jn + tz * jt);
          const strength = -vn;
          if (strength > 1.2) this.collisionEvents.push({ type: s.type, strength, x: px, z: pz });
        }
      }
    }
    this._reportImpacts();
  }

  _reportImpacts() {
    if (!this.collisionEvents.length || this.impactCooldown > 0) return;
    const e = this.collisionEvents.reduce((a, b) => a.strength > b.strength ? a : b);
    this.impactCooldown = 0.25;
    this.lastImpact = this.veh.time;
    const st = Math.min(1.5, e.strength / 10);
    if (this.isPlayer || this._dist2ToCamera() < 3600) this.game.audio.impact(st, 'wall');
    this.game.onImpact && this.game.onImpact(this, e);
    // sparks
    for (let k = 0; k < Math.min(40, e.strength * 3); k++) {
      this.game.effects.sparks.emit({ x: e.x, y: 0.4 + Math.random() * 0.4, z: e.z, vx: (Math.random() - 0.5) * 8 + this.veh.vx * 0.5, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 8 + this.veh.vz * 0.5, life: 0.4 + Math.random() * 0.4, size: 0.12, size1: 0.04, alpha: 1, color: [1, 0.7, 0.3], drag: 1, grav: 9.8 });
    }
  }

  _dist2ToCamera() { const c = this.game.camera.position; return (c.x - this.veh.x) ** 2 + (c.z - this.veh.z) ** 2; }

  // car vs car (called by game for each pair)
  static collidePair(a, b) {
    const A = a.veh, B = b.veh;
    const dx = B.x - A.x, dz = B.z - A.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 36) return null;
    // approximate each car with 3 circles along its length
    const circles = (v) => { const sh = Math.sin(v.heading), ch = Math.cos(v.heading); return [-1.45, 0, 1.45].map(f => [v.x + sh * f, v.z + ch * f]); };
    const ca = circles(A), cb = circles(B), r = 0.95;
    let hit = null;
    for (const p of ca) for (const q of cb) {
      const ex = q[0] - p[0], ez = q[1] - p[1]; const d = Math.hypot(ex, ez);
      if (d < 2 * r && d > 1e-4) {
        const nx = ex / d, nz = ez / d, pen = 2 * r - d;
        A.x -= nx * pen * 0.5; A.z -= nz * pen * 0.5; B.x += nx * pen * 0.5; B.z += nz * pen * 0.5;
        const cx = (p[0] + q[0]) / 2, cz = (p[1] + q[1]) / 2;
        const [avx, avz] = A.pointVel(cx, cz), [bvx, bvz] = B.pointVel(cx, cz);
        const vn = (bvx - avx) * nx + (bvz - avz) * nz;
        if (vn < 0) {
          const j = -(1.3) * vn / (1 / A.spec.mass + 1 / B.spec.mass) * 0.9;
          A.applyImpulse(cx, cz, -nx * j, -nz * j);
          B.applyImpulse(cx, cz, nx * j, nz * j);
          if (!hit || -vn > hit.strength) hit = { strength: -vn, x: cx, z: cz };
        }
      }
    }
    return hit;
  }

  // ---------------------------------------------------------------- effects
  emitEffects(dt) {
    const v = this.veh, fx = this.game.effects;
    const hd = v.heading + (this.pose || 0);
    const sh = Math.sin(hd), ch = Math.cos(hd);
    const night = this.game.env.preset?.night;
    for (let i = 0; i < 4; i++) {
      const [lx, lf] = v.wpos[i];
      const wx = v.x + lx * ch + lf * sh, wz = v.z - lx * sh + lf * ch;
      let skid = v.wheelSkid[i];
      if (this.pose !== undefined && Math.abs(this.pose) > 0.2 && i >= 2) skid = Math.max(skid, 0.75);
      const surf = v.wheelSurface[i];
      const key = this.name + i;
      const onPaved = surf === 'asphalt' || surf === 'curb';
      // skid marks (lateral dir = left vector)
      if (onPaved) fx.skid.add(key, wx, wz, ch, -sh, 0.24, skid > 0.08 ? Math.min(0.85, skid * 1.1) : 0);
      else fx.skid.add(key, wx, wz, ch, -sh, 0.3, v.speed > 3 ? 0.35 : 0, surf === 'grass' ? [0.12, 0.1, 0.05] : [0.25, 0.2, 0.15]);
      // smoke / dust
      const rate = onPaved ? (skid > 0.25 ? skid * 26 : 0) : (v.speed > 4 ? 10 + v.speed * 0.5 : 0);
      this.emitAcc[i] += rate * dt * (fx.smokeScale || 1);
      while (this.emitAcc[i] >= 1) {
        this.emitAcc[i] -= 1;
        if (onPaved) {
          const c = this.smokeColor;
          const shade = night ? 0.55 : 0.9;
          fx.smoke.emit({ x: wx + (Math.random() - 0.5) * 0.3, y: 0.25, z: wz + (Math.random() - 0.5) * 0.3, vx: v.vx * 0.25 + (Math.random() - 0.5) * 1.5, vy: 0.6 + Math.random() * 0.8, vz: v.vz * 0.25 + (Math.random() - 0.5) * 1.5, life: 1.1 + Math.random() * 0.9 * skid, size: 0.6, size1: 2.2 + skid * 1.6, alpha: 0.08 + skid * 0.08, color: [c[0] * shade, c[1] * shade, c[2] * shade], drag: 1.4, grav: -0.25, spin: 0.6 });
        } else {
          const col = surf === 'grass' ? [0.35, 0.32, 0.22] : [0.62, 0.55, 0.45];
          fx.smoke.emit({ x: wx, y: 0.2, z: wz, vx: v.vx * 0.3 + (Math.random() - 0.5) * 2, vy: 0.8 + Math.random(), vz: v.vz * 0.3 + (Math.random() - 0.5) * 2, life: 1.0 + Math.random() * 0.6, size: 0.5, size1: 2.4, alpha: surf === 'grass' ? 0.14 : 0.25, color: col, drag: 1.6, grav: 0.4 });
        }
      }
    }
    // exhaust backfire flames on limiter / lift
    if (v.limiterHit && Math.random() < 0.25) {
      const ex = v.x - sh * 2.25 + ch * -0.45, ez = v.z - ch * 2.25 - sh * -0.45;
      fx.sparks.emit({ x: ex, y: 0.35, z: ez, vx: -sh * 4 + v.vx, vy: 0.2, vz: -ch * 4 + v.vz, life: 0.12, size: 0.35, size1: 0.6, alpha: 1, color: [1, 0.55, 0.15], drag: 4, grav: 0 });
    }
    // nitro flames
    if (v.nitroActive) {
      for (const side of [-0.45]) {
        const ex = v.x - sh * 2.3 + ch * side, ez = v.z - ch * 2.3 - sh * side;
        fx.sparks.emit({ x: ex, y: 0.33, z: ez, vx: -sh * 6 + v.vx, vy: 0, vz: -ch * 6 + v.vz, life: 0.1, size: 0.3, size1: 0.5, alpha: 1, color: [0.4, 0.6, 1], drag: 3, grav: 0 });
      }
    }
  }

  // props (cones)
  collideProps() {
    const v = this.veh, W = this.game.world;
    let hits = 0;
    for (const p of W.props) {
      const dx = p.x - v.x, dz = p.z - v.z;
      if (dx * dx + dz * dz > 12) continue;
      // transform to car local
      const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
      const lf = dx * sh + dz * ch, ll = dx * ch - dz * sh;
      if (Math.abs(lf) < 2.35 && Math.abs(ll) < 0.98) {
        const sp = Math.max(2, v.speed);
        const [pvx, pvz] = v.pointVel(p.x, p.z);
        p.vx = pvx * 1.1 + (Math.random() - 0.5) * 2; p.vz = pvz * 1.1 + (Math.random() - 0.5) * 2;
        p.vy = 1.5 + sp * 0.15; p.wx = (Math.random() - 0.5) * 14; p.wz = (Math.random() - 0.5) * 14;
        // push out
        const push = 1.0 - Math.abs(ll);
        p.x += (ll > 0 ? ch : -ch) * push * 0.5; p.z += (ll > 0 ? -sh : sh) * push * 0.5;
        if (!p.hit) { p.hit = true; hits++; this.game.audio.impact(0.2, 'cone'); }
        v.vx *= 0.995; v.vz *= 0.995;
      }
    }
    return hits;
  }

  dispose() {
    this.visual.dispose();
    this.game.audio.removeEngine(this.engine);
    this.engine = null;
  }
}
