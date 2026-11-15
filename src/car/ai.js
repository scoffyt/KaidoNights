// =====================================================================
//  AI driver (pure JS): racing-line pursuit with speed profile, and a
//  drift controller for tandem battles. Drives the same physics model
//  as the player through the same inputs.
// =====================================================================
import { speedProfile } from '../world/trackData.js';

export const AI_LEVELS = {
  easy:   { label: 'Fácil',   grip: 0.80, accel: 4.5, decel: 7.0, react: 0.65, err: 1.6 },
  normal: { label: 'Normal',  grip: 0.97, accel: 5.5, decel: 8.5, react: 0.85, err: 0.9 },
  hard:   { label: 'Difícil', grip: 1.2, accel: 7.5, decel: 11,  react: 1.0,  err: 0.4 },
};

export class AIDriver {
  constructor(track, line, level = 'normal', style = 'race') {
    this.track = track; this.line = line;
    this.level = AI_LEVELS[level] || AI_LEVELS.normal;
    this.style = style;
    this.profile = speedProfile(track, line, style === 'drift' ? 0.78 : this.level.grip, this.level.accel, this.level.decel, style === 'drift' ? 36 : 80);
    this.driftTarget = 0;
    this.laneOffset = 0; this.laneTarget = 0;
    this.stuck = 0; this.reverseT = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0, analog: true };
    this.noiseT = Math.random() * 100;
    this.lastS = 0;
    this.driftPhase = 0;
    this.speedScale = 1;
    this.lineBias = (Math.random() - 0.5) * this.level.err;
  }

  // car: object with veh + trackInfo ; others: other cars for avoidance
  update(dt, car, others = []) {
    const v = car.veh, t = this.track, L = this.line, inp = this.input;
    const info = car.trackInfo || t.project(v.x, v.z);
    const s = info.s;
    const sp = v.speed;
    const sh = Math.sin(v.heading), ch = Math.cos(v.heading);
    const [u, lv] = v.localVel();

    // ---- recovery when stuck or facing the wrong way
    const fwdDot = sh * t.tx[info.i] + ch * t.tz[info.i];
    if ((sp < 1.5 && this.reverseT <= 0) || fwdDot < -0.3) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 1.6 && this.reverseT <= 0) { this.reverseT = 1.4; this.stuck = 0; }
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      inp.throttle = 0; inp.brake = 1; inp.handbrake = 0;
      // steer opposite to get nose back to track direction
      const err = Math.atan2(t.tx[info.i], t.tz[info.i]) - v.heading;
      inp.steer = -Math.sign(Math.sin(err));
      this.respawnTimer = (this.respawnTimer || 0) + dt;
      return inp;
    }
    this.respawnTimer = 0;

    // ---- lane offset for avoidance
    this.laneTarget = this.lineBias;
    for (const o of others) {
      if (o === car) continue;
      const dx = o.veh.x - v.x, dz = o.veh.z - v.z;
      const lf = dx * sh + dz * ch, ll = dx * ch - dz * sh;
      if (lf > 0 && lf < 16 && Math.abs(ll) < 2.6) { this.laneTarget = ll > 0 ? -3.2 : 3.2; }
    }
    this.laneOffset += (this.laneTarget - this.laneOffset) * Math.min(1, dt * 1.5);

    // ---- target point (pure pursuit on racing line)
    const Ld = 7 + sp * 0.42;
    const i2 = t.indexAt(s + Ld);
    const lim = t.hw[i2] - 1.6;
    const off = Math.max(-lim, Math.min(lim, L.off[i2] + this.laneOffset));
    const [lx, lz] = t.left(i2);
    const tx = t.x[i2] + lx * off, tz = t.z[i2] + lz * off;
    const dx = tx - v.x, dz = tz - v.z;
    const lf = dx * sh + dz * ch, ll = dx * ch - dz * sh;
    const dist2 = lf * lf + ll * ll;
    const kappa = 2 * ll / Math.max(1, dist2);
    let steer = Math.atan(kappa * 2.68) / v.spec.maxSteer;

    // ---- speed target (min over braking horizon)
    let vt = 1e9;
    const horizon = 10 + sp * sp / (2 * this.level.decel) + sp * 0.3;
    for (let d = 0; d < horizon; d += 4) vt = Math.min(vt, this.profile[t.indexAt(s + d)] * this.speedScale);
    const err = vt - sp;

    if (this.style === 'drift') return this._driftControl(dt, car, steer, vt, info);

    // yaw stability: countersteer when the rear steps out
    const beta = Math.atan2(lv, Math.max(1, u));
    steer += beta / v.spec.maxSteer * 0.9;
    inp.steer = Math.max(-1, Math.min(1, steer));
    inp.handbrake = 0;
    if (err > 0) { inp.throttle = Math.min(1, 0.35 + err * 0.25) * (Math.abs(beta) > 0.25 ? 0.4 : 1); inp.brake = 0; }
    else { inp.throttle = err > -1.5 ? 0.2 : 0; inp.brake = err < -1.5 ? Math.min(1, -err * 0.18) : 0; }
    inp.nitro = 0;
    return inp;
  }

  // Drift style: drives the racing line with a lower speed profile (stable,
  // reliable lead car) and outputs a body-angle target that the Car applies
  // as a drift pose (rear stepped out, countersteer, smoke).
  _driftControl(dt, car, pursuitSteer, vt, info) {
    const v = car.veh, t = this.track, inp = this.input;
    const sp = v.speed, s = info.s;
    const [u, lv] = v.localVel();
    let curvAhead = 0;
    for (let d = 0; d < 30; d += 5) curvAhead += t.curv[t.indexAt(s + d)];
    curvAhead /= 6;
    const strength = Math.min(1, Math.abs(curvAhead) * 50);
    const target = strength > 0.22 && sp > 9 ? Math.sign(curvAhead) * (0.42 + 0.3 * strength) : 0;
    this.driftTarget = target;
    const beta = Math.atan2(lv, Math.max(1, u));
    inp.steer = Math.max(-1, Math.min(1, pursuitSteer + beta / v.spec.maxSteer * 0.9));
    const err = vt - sp;
    inp.handbrake = 0;
    if (err > 0) { inp.throttle = Math.min(1, 0.35 + err * 0.25); inp.brake = 0; }
    else { inp.throttle = err > -1.5 ? 0.25 : 0; inp.brake = err < -1.5 ? Math.min(1, -err * 0.2) : 0; }
    inp.nitro = 0;
    return inp;
  }
}
