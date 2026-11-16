// =====================================================================
//  Remote players: snapshot interpolation (rendered ~110 ms in the past,
//  Hermite between snapshots using their velocities, short extrapolation
//  when packets are late), visual-only car, smoke/skids when drifting,
//  engine sound, horn/flash, floating name plate.
// =====================================================================
import * as THREE from 'three';
import { CarVisual } from '../car/carModel.js';

const DELAY = 110;          // ms interpolation delay
const MAX_EXTRAP = 350;     // ms

export class RemoteCar {
  constructor(game, info, layer) {
    this.game = game; this.id = info.id;
    this.info = info;
    this.buf = [];
    this.visual = null; this.loadingCar = null;
    this.veh = { x: 0, z: 0, heading: 0, ax: 0, ay: 0, steer: 0, speed: 0, time: 0, offroad: 0, wheelAngle: [0, 0, 0, 0], wheelLoad: [3500, 3500, 3500, 3500], spec: { mass: 1400 } };
    this.flags = 0; this.online = true; this.flashT = 0;
    this.emitAcc = [0, 0];
    if (info.s) this.push({ ts: game.net.serverNow() - DELAY, x: info.s[0], z: info.s[1], h: info.s[2], vx: 0, vz: 0, steer: 0, rpm: 900, gear: 1, flags: 0 });
    // name plate
    this.tag = document.createElement('div'); this.tag.className = 'np';
    layer.appendChild(this.tag);
    this.setInfo(info);
  }
  setInfo(info) {
    Object.assign(this.info, info);
    const i = this.info;
    this.tag.innerHTML = `<b style="background:${i.avatar || '#16c5b8'}">${i.level || 1}</b><span>${esc(i.name)}</span>${i.crew ? `<i>[${esc(i.crew)}]</i>` : ''}<em></em>`;
    this.tagDist = this.tag.querySelector('em');
    this.loadCar();
  }
  async loadCar() {
    const carId = this.info.car || 'r34';
    const key = carId + JSON.stringify(this.info.look || {});
    if (this._carKey === key) return;
    this._carKey = key;
    try {
      const tpl = await this.game.getTpl(carId);
      if (this._carKey !== key || this.disposed) return;
      const lk = this.info.look || {};
      const def = (await import('../car/cars.js')).carById(carId);
      if (this.visual) this.visual.dispose();
      this.visual = new CarVisual(tpl, { color: lk.color || def.color, finish: lk.finish || 'metallic', rimColor: lk.rim || def.rim, lod: false, headlights: false, castShadow: true });
      this.game.scene.add(this.visual.root);
      this.smokeColor = hex3(lk.smoke || '#eeeeee');
      this.rideHeight = lk.rideHeight || 0;
    } catch (e) { console.warn('remote car load failed', carId, e); }
  }
  push(s) {
    const b = this.buf;
    if (b.length && s.ts <= b[b.length - 1].ts) return;
    b.push(s); if (b.length > 30) b.shift();
  }
  // sample state at render time
  sample(t) {
    const b = this.buf; if (!b.length) return null;
    if (t <= b[0].ts) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].ts <= t) {
        const a = b[i], c = b[i + 1];
        if (!c) { // extrapolate
          const dt = Math.min(MAX_EXTRAP, t - a.ts) / 1000;
          return { ...a, x: a.x + a.vx * dt, z: a.z + a.vz * dt };
        }
        const span = (c.ts - a.ts) / 1000, u = Math.min(1, (t - a.ts) / (c.ts - a.ts));
        // Hermite position (velocity-aware) – avoids corner cutting
        const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
        const x = h00 * a.x + h10 * span * a.vx + h01 * c.x + h11 * span * c.vx;
        const z = h00 * a.z + h10 * span * a.vz + h01 * c.z + h11 * span * c.vz;
        let dh = c.h - a.h; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        return { ts: t, x, z, h: a.h + dh * u, vx: a.vx + (c.vx - a.vx) * u, vz: a.vz + (c.vz - a.vz) * u, steer: a.steer + (c.steer - a.steer) * u, rpm: a.rpm + (c.rpm - a.rpm) * u, gear: c.gear, flags: c.flags };
      }
    }
    return b[b.length - 1];
  }
  update(dt, camera, night) {
    const s = this.sample(this.game.net.serverNow() - DELAY);
    if (!s) return;
    const v = this.veh;
    const pvx = v.vx || 0, pvz = v.vz || 0;
    v.x = s.x; v.z = s.z; v.heading = s.h; v.steer = s.steer * 0.6; v.vx = s.vx; v.vz = s.vz;
    v.speed = Math.hypot(s.vx, s.vz); v.time += dt;
    // body motion from accelerations (local frame)
    const axw = (s.vx - pvx) / Math.max(dt, 1e-3), azw = (s.vz - pvz) / Math.max(dt, 1e-3);
    const sh = Math.sin(s.h), ch = Math.cos(s.h);
    v.ax += ((axw * sh + azw * ch) - v.ax) * Math.min(1, dt * 6); v.ay += ((axw * ch - azw * sh) - v.ay) * Math.min(1, dt * 6);
    const fwd = s.vx * sh + s.vz * ch;
    for (let i = 0; i < 4; i++) v.wheelAngle[i] += (fwd / 0.33) * dt * (i >= 2 && (s.flags & 2) ? 1.25 : 1);
    this.flags = s.flags;
    this.online = !(s.flags & 128);
    if (this.visual) {
      this.visual.update(v, dt, this.rideHeight || 0);
      this.flashT = Math.max(0, this.flashT - dt);
      const head = !!(s.flags & 1) || this.flashT > 0;
      this.visual.setLights({ head, brake: (s.flags & 4) ? 1 : 0, night, reverse: s.gear === -1 });
      if (this.flashT > 0) this.visual.headMat.opacity = 1;
      this.visual.root.visible = true;
      this.emitDrift(dt, s);
    }
    // engine sound
    if (this.engine) { this.engine.update({ rpm: s.rpm, throttle: (s.flags & 8) ? 1 : 0.3, skid: (s.flags & 2) ? 0.6 : 0, slipSpeed: (s.flags & 2) ? 8 : 0 }, dt); this.engine.setPosition(v.x, 0.5, v.z); }
    // name plate
    const p = new THREE.Vector3(v.x, 2.1, v.z);
    const dist = camera.position.distanceTo(p);
    p.project(camera);
    const visible = p.z < 1 && dist < 320 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    this.tag.style.display = visible ? '' : 'none';
    if (visible) {
      this.tag.style.transform = `translate(${((p.x + 1) / 2 * innerWidth).toFixed(0)}px, ${((1 - p.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%, -100%) scale(${Math.max(0.6, Math.min(1, 40 / dist)).toFixed(2)})`;
      this.tag.style.opacity = this.online ? 1 : 0.45;
      if ((this._dT = (this._dT || 0) - dt) < 0) { this._dT = 0.25; this.tagDist.textContent = `${dist.toFixed(0)} m`; }
    }
    this.dist = dist;
  }
  emitDrift(dt, s) {
    if (!(s.flags & 2) || this.veh.speed < 6) return;
    const fx = this.game.effects, v = this.veh;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    for (let k = 0; k < 2; k++) {
      const lx = k ? -0.75 : 0.75, lf = -1.3;
      const wx = v.x + lx * ch + lf * sh, wz = v.z - lx * sh + lf * ch;
      fx.skid.add('r' + this.id + k, wx, wz, ch, -sh, 0.24, 0.6);
      this.emitAcc[k] += 18 * dt * (fx.smokeScale || 1);
      while (this.emitAcc[k] >= 1) {
        this.emitAcc[k]--;
        const c = this.smokeColor || [0.9, 0.9, 0.9];
        fx.smoke.emit({ x: wx, y: 0.25, z: wz, vx: v.vx * 0.25 + (Math.random() - 0.5) * 1.5, vy: 0.6 + Math.random() * 0.8, vz: v.vz * 0.25 + (Math.random() - 0.5) * 1.5, life: 1.4, size: 0.6, size1: 2.8, alpha: 0.12, color: c, drag: 1.4, grav: -0.25, spin: 0.6 });
      }
    }
  }
  horn() { this.game.audio.horn({ x: this.veh.x, z: this.veh.z }); this.honkT = 1; }
  flash() { this.flashT = 0.35; }
  dispose() {
    this.disposed = true;
    if (this.visual) this.visual.dispose();
    this.tag.remove();
    if (this.engine) { this.game.audio.removeEngine(this.engine); this.engine = null; }
  }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hex3(h) { const n = parseInt(String(h).slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
export { esc };
