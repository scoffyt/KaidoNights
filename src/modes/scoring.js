// =====================================================================
//  Drift scoring: angle × speed × duration, combo multiplier,
//  transitions, clipping zones, wall proximity, fail states and
//  anti-farming (no infinite points spinning on the spot).
// =====================================================================
import { DONUT, PLAZA } from '../world/world.js';

export class DriftScorer {
  constructor(opts = {}) {
    this.opts = { minAngle: 10, minSpeed: 30, angleGate: 0, speedGate: 0, donutOnly: false, ...opts };
    this.reset();
  }

  reset() {
    this.total = 0;
    this.chain = 0;            // raw points in current chain
    this.mult = 1;
    this.chainTime = 0;
    this.grace = 0;
    this.active = false;
    this.bestChain = 0;
    this.maxAngle = 0;
    this.drifts = 0;
    this.lastSide = 0;
    this.sideTime = 0;
    this.transitions = 0;
    this.events = [];
    this.hist = [];
    this.histT = 0;
    this.zoneHit = new Set();
    this.offTime = 0;
    this.angle = 0;
    this.quality = '';
    this.donut = false;
    this.history = [];
    this.timeDrifting = 0;
    this.distanceDrifting = 0;
  }

  emit(e) { this.events.push(e); }

  fail(reason) {
    if (this.chain > 0) this.emit({ type: 'fail', reason, lost: Math.round(this.chain * this.mult) });
    this.chain = 0; this.mult = 1; this.chainTime = 0; this.active = false; this.grace = 0; this.zoneHit.clear(); this.transitions = 0;
  }

  bank() {
    if (this.chain <= 0) { this.active = false; return; }
    const pts = Math.round(this.chain * this.mult);
    this.total += pts;
    this.bestChain = Math.max(this.bestChain, pts);
    this.drifts++;
    this.emit({ type: 'bank', points: pts, mult: this.mult });
    this.chain = 0; this.mult = 1; this.chainTime = 0; this.active = false; this.zoneHit.clear(); this.transitions = 0;
  }

  onImpact(strength) {
    if (strength > 3.0 && this.active) this.fail('BATIDA');
  }

  update(dt, car, world) {
    const v = car.veh, o = this.opts;
    const [u, lv] = v.localVel();
    const sp = v.speed, kmh = sp * 3.6;
    const ang = sp > 2 ? Math.atan2(Math.abs(lv), Math.max(0.01, Math.abs(u))) * 180 / Math.PI : 0;
    const side = Math.sign(lv);
    this.angle = u > 0 ? ang : 0;
    // movement history for anti-farming
    this.histT += dt;
    if (this.histT > 0.25) { this.histT = 0; this.hist.push([v.x, v.z]); if (this.hist.length > 16) this.hist.shift(); }
    const h0 = this.hist[0];
    const disp = h0 ? Math.hypot(v.x - h0[0], v.z - h0[1]) : 99;
    const inDonut = Math.hypot(v.x - DONUT.x, v.z - DONUT.z) < DONUT.r;
    this.donut = inDonut && disp < 25 && ang > 30;
    // surfaces
    let off = 0; for (let i = 0; i < 4; i++) if (v.wheelSurface[i] === 'grass' || v.wheelSurface[i] === 'gravel') off++;
    const onRoad = off <= 1;

    const inPlaza = v.x > PLAZA.x0 && v.x < PLAZA.x1 && v.z > PLAZA.z0 && v.z < PLAZA.z1;
    const drifting = u > 1 && ang >= o.minAngle && ang < 105 && kmh >= o.minSpeed && onRoad && (!o.donutOnly || inDonut) && (!o.plazaOnly || inPlaza);
    if (ang >= 105 && u > -2 && sp > 4 && this.active) { this.fail('RODOU'); return; }
    if (off >= 2 && this.active) { this.offTime += dt; if (this.offTime > 0.35) { this.fail('FORA DA PISTA'); return; } } else this.offTime = 0;

    if (drifting) {
      if (!this.active) { this.active = true; this.chainTime = 0; this.lastSide = side; this.sideTime = 0; }
      this.grace = 0;
      this.chainTime += dt;
      this.timeDrifting += dt;
      this.distanceDrifting += sp * dt;
      this.maxAngle = Math.max(this.maxAngle, ang);
      const angleF = Math.min(1.7, Math.max(0, (ang - 6) / 30));
      const speedF = Math.min(2.6, Math.pow(kmh / 60, 1.25));
      let farm = 1;
      if (disp < 12) farm = inDonut ? 1.0 : 0.08;      // spinning on the spot earns (almost) nothing
      let gate = 1;
      if (o.angleGate && ang < o.angleGate) gate = 0;  // challenge constraints
      if (o.speedGate && kmh < o.speedGate) gate = 0;
      // wall proximity bonus
      let prox = 1;
      const segs = world.segmentsNear(v.x, v.z);
      let minD = 99;
      for (const [px, pz] of v.corners(0.9, 2.3, 2.25).slice(0, 4)) for (const si of segs) {
        const s = world.segments[si]; const ex = s.bx - s.ax, ez = s.bz - s.az; const L2 = ex * ex + ez * ez;
        const t = Math.max(0, Math.min(1, ((px - s.ax) * ex + (pz - s.az) * ez) / L2));
        const d = Math.hypot(px - (s.ax + ex * t), pz - (s.az + ez * t)); if (d < minD) minD = d;
      }
      if (minD < 1.6) { prox = 1.6; if (!this._proxOn) { this._proxOn = true; this.emit({ type: 'zone', kind: 'PERTO DO MURO', points: 0 }); } } else this._proxOn = false;
      this.prox = minD < 1.6;
      // line accuracy: close to the ideal line through the corner
      let lineF = 1;
      const ti = car.trackInfo;
      if (ti && world.racingLine && Math.abs(world.track.curv[ti.i]) > 1 / 200) {
        const dl = Math.abs(ti.lat - world.racingLine.off[ti.i]);
        if (dl < 2.5) { lineF = 1.2; this.onLine = true; } else this.onLine = false;
      } else this.onLine = false;
      const pps = 950 * angleF * speedF * farm * gate * prox * lineF;
      this.chain += pps * dt;
      // multiplier growth with continuous chain
      const newMult = Math.min(10, 1 + Math.floor(this.chainTime / 2.5) + Math.floor(this.transitions / 1) * 0.5);
      if (Math.floor(newMult) > Math.floor(this.mult)) this.emit({ type: 'mult', value: Math.floor(newMult) });
      this.mult = Math.max(this.mult, newMult);
      // transitions (side switch while maintaining a slide)
      if (side !== this.lastSide && ang > 12) {
        if (this.sideTime > 0.35) { this.transitions++; this.chain += 400 * speedF; this.emit({ type: 'transition' }); }
        this.lastSide = side; this.sideTime = 0;
      } else this.sideTime += dt;
      // clipping zones
      for (let k = 0; k < world.clipZones.length; k++) {
        const z = world.clipZones[k];
        if (this.zoneHit.has(k)) continue;
        const dz = Math.hypot(v.x - z.x, v.z - z.z);
        if (dz < z.r) {
          // check any body corner (rear for outer, front for inner)
          this.zoneHit.add(k);
          const pts = (z.kind === 'OUTER' ? 600 : 400) * Math.max(1, speedF);
          this.chain += pts;
          this.emit({ type: 'zone', kind: z.kind === 'OUTER' ? 'ZONA EXTERNA' : 'ZONA INTERNA', points: Math.round(pts) });
        }
      }
      if (this.donut && Math.random() < dt * 0.5) this.emit({ type: 'zone', kind: 'DONUT', points: 0 });
    } else if (this.active) {
      this.grace += dt;
      // straightening up / slowing ends the chain
      if (this.grace > 1.1) this.bank();
    }
    // forget clip zones once far past
    const c = this.chain * this.mult;
    this.quality = c > 60000 ? 'LENDÁRIO' : c > 30000 ? 'INSANO' : c > 15000 ? 'INCRÍVEL' : c > 7000 ? 'ÓTIMO' : c > 2500 ? 'BOM' : c > 0 ? 'DRIFT' : '';
  }

  // finish (e.g. end of timed run): bank whatever is pending
  finish() { if (this.active || this.chain > 0) this.bank(); return this.total; }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
