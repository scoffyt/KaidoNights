// =====================================================================
//  KAIDO NIGHTS — Vehicle dynamics
//  Planar (x,z) rigid body with 4 independent tires, combined-slip tire
//  model (friction ellipse + post-peak falloff), dynamic load transfer,
//  engine torque curve, clutch slip, 6-speed gearbox, locked rear diff,
//  handbrake, TCS/ABS and surface handling. Pure JS (no three.js) so it
//  can be unit tested in Node.
//  Body frame: forward = (sin h, cos h), left = (cos h, -sin h).
//  Positive yaw / steering = turn LEFT.
// =====================================================================

export const G = 9.81;

export const DEFAULT_SPEC = {
  mass: 1480,
  inertiaScale: 1.0,
  cgToFront: 1.31,
  cgToRear: 1.355,
  cgHeight: 0.48,
  trackWidth: 1.48,
  wheelRadius: 0.332,
  wheelInertia: 1.3,
  // engine
  idleRpm: 950,
  redline: 8000,
  limiter: 8200,
  maxTorque: 480,          // Nm (tuned RB26-ish)
  engineBrake: 55,
  gears: [3.21, 2.13, 1.52, 1.16, 0.94, 0.79],
  reverseGear: 3.3,
  finalDrive: 4.1,
  drivelineEff: 0.88,
  shiftTime: 0.16,
  // brakes (Nm per wheel)
  brakeFront: 2600,
  brakeRear: 1500,
  handbrake: 4200,
  // tires
  muFront: 1.16,
  muRear: 1.20,
  peakSlipRatio: 0.10,
  peakSlipAngleFront: 0.13,   // rad
  peakSlipAngleRear: 0.15,
  slideFront: 0.85,           // fraction of peak grip once fully sliding
  slideRear: 0.85,
  // misc
  maxSteer: 0.72,             // rad (~41 deg)
  dragCoef: 0.38,             // 0.5*rho*Cd*A
  rollResist: 12,             // N per m/s
  nitroBoost: 0.45,           // extra torque fraction
  nitroCapacity: 6.0,         // seconds
  nitroRegen: 0.12,           // per second
};

// smooth tire curve: normalised slip s -> normalised force
function tireCurve(s, slide) {
  if (s <= 1) return s * (2 - s);
  return slide + (1 - slide) * Math.exp(-(s - 1) * 1.6);
}

function torqueCurve(rpm, spec) {
  const r = rpm / spec.redline;
  // rises to plateau ~0.55..0.82 then falls
  let k;
  if (r < 0.15) k = 0.45;
  else if (r < 0.56) k = 0.45 + (r - 0.15) / 0.41 * 0.55;
  else if (r < 0.84) k = 1.0;
  else k = 1.0 - (r - 0.84) * 1.1;
  return spec.maxTorque * Math.max(0.2, k);
}

export class Vehicle {
  constructor(spec = {}) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    this.reset(0, 0, 0);
    this.surfaceFn = null;   // (x,z) => {mu, drag, type}
    this.tcs = false;
    this.abs = true;
    this.autoGear = true;
    this.steerAssist = 0.5;  // countersteer assist 0..1
    this.driftAssist = 0.5;  // yaw stabilisation while sliding 0..1
    this.maxDriftAngle = 1.05; // rad, assist starts pushing back beyond this
  }

  setSpec(spec) {
    this.spec = { ...DEFAULT_SPEC, ...spec };
    this._derive();
  }

  _derive() {
    const s = this.spec;
    this.L = s.cgToFront + s.cgToRear;
    this.inertia = s.mass * s.cgToFront * s.cgToRear * 1.05 * s.inertiaScale;
    const hw = s.trackWidth / 2;
    // wheel positions (left, forward): FL, FR, RL, RR
    this.wpos = [
      [hw, s.cgToFront], [-hw, s.cgToFront],
      [hw, -s.cgToRear], [-hw, -s.cgToRear],
    ];
  }

  reset(x, z, heading) {
    this._derive && this._derive();
    if (!this.wpos) this._derive();
    this.x = x; this.z = z; this.heading = heading;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.wheelOmega = [0, 0, 0, 0];
    this.wheelAngle = [0, 0, 0, 0];   // accumulated spin angle for render
    this.slipRatio = [0, 0, 0, 0];
    this.slipAngle = [0, 0, 0, 0];
    this.wheelLoad = [0, 0, 0, 0];
    this.wheelSkid = [0, 0, 0, 0];    // 0..1 skid intensity
    this.wheelSurface = ['asphalt', 'asphalt', 'asphalt', 'asphalt'];
    this.ax = 0; this.ay = 0;           // filtered body accelerations
    this.gear = 1;                      // -1 reverse, 0 neutral, 1..6
    this.rpm = this.spec.idleRpm;
    this.shiftTimer = 0;
    this.steer = 0;                     // actual steer angle (rad)
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0, clutch: 0 };
    this.nitro = this.spec.nitroCapacity;
    this.nitroActive = false;
    this.limiterHit = false;
    this.revLimit = 0;
    this.lastShift = 0;
    this.time = 0;
    this.reverseTimer = 0;
    this.offroad = 0;
    this.speedKmh = 0;
    this.driftAngle = 0;
    this.throttleCut = 0;
  }

  get speed() { return Math.hypot(this.vx, this.vz); }

  // body-frame velocity
  localVel() {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const u = this.vx * sh + this.vz * ch;      // forward
    const v = this.vx * ch - this.vz * sh;      // left
    return [u, v];
  }

  shiftUp() {
    if (this.gear < this.spec.gears.length && this.shiftTimer <= 0) {
      if (this.gear === -1) this.gear = 1; else this.gear++;
      this.shiftTimer = this.spec.shiftTime; this.lastShift = this.time;
      this.onShift && this.onShift(this.gear);
    }
  }
  shiftDown() {
    if (this.shiftTimer > 0) return;
    if (this.gear > 1) { this.gear--; this.shiftTimer = this.spec.shiftTime; this.lastShift = this.time; this.onShift && this.onShift(this.gear); }
    else if (this.gear === 1 && this.speed < 2) { this.gear = -1; this.onShift && this.onShift(this.gear); }
  }

  ratio() {
    const s = this.spec;
    if (this.gear === -1) return -s.reverseGear * s.finalDrive;
    if (this.gear === 0) return 0;
    return s.gears[this.gear - 1] * s.finalDrive;
  }

  // ------------------------------------------------------------------
  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 480)));
    const h = dt / steps;
    this._controls(dt);
    for (let i = 0; i < steps; i++) this._step(h);
    const [u, v] = this.localVel();
    this.speedKmh = Math.abs(u) * 3.6;
    const sp = this.speed;
    this.driftAngle = sp > 2 ? Math.atan2(-v, Math.abs(u)) * Math.sign(u || 1) : 0;
  }

  _controls(dt) {
    const s = this.spec, inp = this.input;
    this.time += dt;
    const [u, v] = this.localVel();
    const sp = this.speed;

    // --- automatic gearbox & reverse logic
    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    if (this.autoGear) {
      if (this.gear >= 1) {
        const ratioUp = this.gear < s.gears.length ? s.gears[this.gear] * s.finalDrive : 0;
        const wheelRpm = Math.abs(this.wheelOmega[2] + this.wheelOmega[3]) * 0.5 * 60 / (2 * Math.PI);
        const groundRpm = Math.abs(u) / s.wheelRadius * 60 / (2 * Math.PI);
        const refRpm = Math.min(wheelRpm, groundRpm * 1.12 + 15);
        if (this.rpm > s.redline - 350 && ratioUp && this.time - this.lastShift > 0.5 && inp.throttle > 0.3 && refRpm * this.ratio() > s.redline * 0.9) this.shiftUp();
        else if (this.gear > 1 && this.time - this.lastShift > 1.2) {
          const ratioDown = s.gears[this.gear - 2] * s.finalDrive;
          const rpmDown = groundRpm * ratioDown;
          if (rpmDown < s.redline - 1200 && this.rpm < s.redline * 0.52) this.shiftDown();
        }
      }
      // reverse: hold brake while (almost) stopped
      if (this.gear >= 1 && inp.brake > 0.5 && inp.throttle < 0.1 && sp < 1.0) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.35) { this.gear = -1; this.reverseTimer = 0; this.onShift && this.onShift(-1); }
      } else if (this.gear === -1 && inp.throttle > 0.5 && u > -1.0) {
        this.reverseTimer += dt;
        if (this.reverseTimer > 0.2) { this.gear = 1; this.reverseTimer = 0; this.onShift && this.onShift(1); }
      } else this.reverseTimer = 0;
    }

    // --- steering with assists
    const maxSteer = s.maxSteer;
    let target = inp.steer * maxSteer;
    if (!inp.analog) {
      // keyboard: reduce lock at speed when gripping
      const speedFactor = 1 / (1 + Math.max(0, sp - 8) * 0.075);
      const slip = Math.abs(this.driftAngle);
      const lockFactor = slip > 0.2 ? 1 : speedFactor;
      target *= Math.max(lockFactor, 0.35);
    }
    // countersteer assist (aligns front wheels with velocity when sliding)
    if (this.steerAssist > 0 && sp > 4 && u > 0) {
      const beta = Math.atan2(v, u); // velocity angle relative to heading (left positive)
      const assist = Math.max(-maxSteer, Math.min(maxSteer, beta)) * this.steerAssist * Math.min(1, (sp - 4) / 6);
      target = Math.max(-maxSteer, Math.min(maxSteer, target + assist * (1 - Math.abs(inp.steer) * 0.5)));
    }
    const rate = inp.analog ? 8 : 4.2;
    const d = target - this.steer;
    this.steer += Math.sign(d) * Math.min(Math.abs(d), rate * dt);

    // --- nitro
    if (inp.nitro && this.nitro > 0 && inp.throttle > 0.1 && this.gear > 0) {
      this.nitroActive = true; this.nitro = Math.max(0, this.nitro - dt);
    } else {
      this.nitroActive = false;
      this.nitro = Math.min(s.nitroCapacity, this.nitro + s.nitroRegen * dt);
    }
  }

  _step(h) {
    const s = this.spec, inp = this.input;
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const u = this.vx * sh + this.vz * ch;
    const v = this.vx * ch - this.vz * sh;
    const r = this.yawRate;
    const m = s.mass;
    const R = s.wheelRadius;

    // ---- loads with filtered load transfer
    const L = this.L;
    const fzF = m * G * s.cgToRear / L - m * this.ax * s.cgHeight / L;
    const fzR = m * G * s.cgToFront / L + m * this.ax * s.cgHeight / L;
    const latT = m * this.ay * s.cgHeight / s.trackWidth; // positive ay = accel to the left -> load on right
    const load = [
      Math.max(80, fzF / 2 - latT * 0.52), Math.max(80, fzF / 2 + latT * 0.52),
      Math.max(80, fzR / 2 - latT * 0.48), Math.max(80, fzR / 2 + latT * 0.48),
    ];
    this.wheelLoad = load;

    // ---- engine & drivetrain
    let throttle = inp.throttle;
    let brake = inp.brake;
    if (this.gear === -1) { const t = throttle; throttle = brake; brake = t; }
    const ratio = this.ratio();
    const rearOmega = (this.wheelOmega[2] + this.wheelOmega[3]) * 0.5;
    const wheelRpm = rearOmega * ratio * 60 / (2 * Math.PI);
    // TCS
    if (this.tcs && Math.abs(u) > 2) {
      const sr = Math.max(this.slipRatio[2], this.slipRatio[3]);
      if (sr > 0.14) this.throttleCut = Math.min(1, this.throttleCut + h * 8);
      else this.throttleCut = Math.max(0, this.throttleCut - h * 4);
      throttle *= 1 - this.throttleCut * 0.9;
    }
    let driveTorque = 0;
    const shifting = this.shiftTimer > 0;
    if (ratio !== 0) {
      // clutch slip at low wheel rpm lets the engine stay in its power band
      const clutchRpm = s.idleRpm + throttle * 3800 * (inp.clutch ? 1.4 : 1);
      let engRpm = Math.abs(wheelRpm);
      let slipping = false;
      const launch = Math.abs(u) < 6 && Math.abs(this.gear) <= 2;
      if (engRpm < s.idleRpm) { engRpm = s.idleRpm; slipping = true; }
      if (launch && engRpm < clutchRpm && throttle > 0.05) { engRpm = Math.max(engRpm, Math.min(clutchRpm, s.idleRpm + throttle * 4200)); slipping = true; }
      if (inp.clutch) { engRpm = s.idleRpm + throttle * (s.limiter - s.idleRpm); slipping = true; }
      // rpm inertia smoothing
      const targetRpm = Math.min(engRpm, s.limiter + 50);
      this.rpm += (targetRpm - this.rpm) * Math.min(1, h * (slipping ? 10 : 40));
      let tq;
      if (this.rpm >= s.limiter) { this.revLimit = 0.06; }
      if (this.revLimit > 0) { this.revLimit -= h; tq = -s.engineBrake; this.limiterHit = true; }
      else {
        this.limiterHit = false;
        tq = throttle > 0.02 ? torqueCurve(this.rpm, s) * throttle : 0;
        tq -= (1 - throttle) * (s.engineBrake * (this.rpm / s.redline) + 10);
        if (this.nitroActive) tq += torqueCurve(this.rpm, s) * s.nitroBoost * throttle;
      }
      if (shifting) tq = Math.min(tq, 0) * 0.3;
      if (inp.clutch && !shifting) tq = 0;
      // engine braking only when clutch engaged & moving
      if (tq < 0 && Math.abs(wheelRpm) < s.idleRpm * 1.1) tq = 0;
      driveTorque = tq * ratio * s.drivelineEff;
      if (this.gear === -1) driveTorque *= 1; // ratio already negative
    } else {
      const targetRpm = s.idleRpm + throttle * (s.limiter - s.idleRpm);
      this.rpm += (targetRpm - this.rpm) * Math.min(1, h * 6);
    }
    if (this.rpm < s.idleRpm) this.rpm = s.idleRpm;

    // ---- per-wheel tire forces
    let Fu = 0, Fv = 0, Tz = 0;
    const steer = this.steer;
    const csd = Math.cos(steer), snd = Math.sin(steer);
    const brakeT = [
      brake * s.brakeFront, brake * s.brakeFront,
      brake * s.brakeRear + inp.handbrake * s.handbrake,
      brake * s.brakeRear + inp.handbrake * s.handbrake,
    ];
    const rearFx = [0, 0];
    for (let i = 0; i < 4; i++) {
      const [px, pf] = this.wpos[i];
      const front = i < 2;
      const uw = u - r * px;
      const vw = v + r * pf;
      let cl = 1, sl = 0;
      if (front) { cl = csd; sl = snd; }
      const lon = uw * cl + vw * sl;
      const lat = -uw * sl + vw * cl;

      // surface
      let mu = front ? s.muFront : s.muRear;
      let surf = this.surfaceFn ? this.surfaceFn(this.x + (px * ch + pf * sh), this.z + (-px * sh + pf * ch)) : null;
      if (surf) { mu *= surf.mu; this.wheelSurface[i] = surf.type; }

      const omega = this.wheelOmega[i];
      const denom = Math.max(Math.abs(lon), 3.0);
      const kappa = (omega * R - lon) / denom;
      const tanA = lat / Math.max(Math.abs(lon), 1.5);
      const pa = front ? s.peakSlipAngleFront : s.peakSlipAngleRear;
      const sx = kappa / s.peakSlipRatio;
      const sy = tanA / Math.tan(pa);
      const sn = Math.hypot(sx, sy);
      const Fz = load[i];
      let Fx = 0, Fy = 0;
      if (sn > 1e-6) {
        const f = tireCurve(sn, front ? s.slideFront : s.slideRear) * mu * Fz;
        Fx = f * sx / sn;
        Fy = -f * sy / sn;
      }
      // stability clamps (do not overshoot zero relative motion in one step)
      const mShare = Fz / G;
      const maxFy = mShare * Math.abs(lat) / h * 0.9;
      if (Math.abs(Fy) > maxFy) Fy = Math.sign(Fy) * maxFy;
      const Iw = front ? s.wheelInertia : s.wheelInertia * 2.2;
      const maxFx = Iw * Math.abs(omega * R - lon) / (R * R * h) * 0.9;
      if (Math.abs(Fx) > maxFx) Fx = Math.sign(Fx) * maxFx;

      this.slipRatio[i] = kappa;
      this.slipAngle[i] = Math.atan(tanA);
      // skid intensity (for smoke/marks/audio)
      const skid = Math.max(0, sn - 1.3);
      this.wheelSkid[i] = Math.min(1, skid * 0.55) * Math.min(1, Math.max(Math.abs(lon), Math.abs(omega * R)) / 4);

      // body forces
      const fu = Fx * cl - Fy * sl;
      const fv = Fx * sl + Fy * cl;
      Fu += fu; Fv += fv;
      Tz += pf * fv - px * fu;

      // wheel spin dynamics
      if (front) {
        let w = omega - Fx * R / Iw * h;
        // brakes
        const bt = brakeT[i] * h / Iw;
        if (this.abs && brake > 0 && Math.abs(lon) > 3 && kappa < -0.12) { /* ABS release */ }
        else if (Math.abs(w) <= bt) w = 0; else w -= Math.sign(w) * bt;
        this.wheelOmega[i] = w;
      } else {
        rearFx[i - 2] = Fx;
      }
    }
    // rear axle (locked differential)
    {
      const Iax = s.wheelInertia * 2.2 * 2;
      let w = rearOmega + (driveTorque - (rearFx[0] + rearFx[1]) * R) / Iax * h;
      const bt = (brakeT[2] + brakeT[3]) * h / Iax;
      const absRel = this.abs && brake > 0 && inp.handbrake < 0.1 && Math.abs(u) > 3 && Math.min(this.slipRatio[2], this.slipRatio[3]) < -0.12;
      if (!absRel) { if (Math.abs(w) <= bt) w = 0; else w -= Math.sign(w) * bt; }
      this.wheelOmega[2] = this.wheelOmega[3] = w;
    }

    // ---- drift assist: yaw stabilisation relative to course rate
    const spd = Math.hypot(u, v);
    if (this.driftAssist > 0 && spd > 4 && u > 0) {
      const beta = Math.atan2(v, u);
      // course (velocity direction) rate from last lateral accel
      const courseRate = (this.ay * Math.cos(beta) - this.ax * Math.sin(beta)) / spd;
      const sliding = Math.min(1, Math.max(0, (Math.abs(beta) - 0.08) / 0.2));
      const k = this.driftAssist * sliding * this.inertia;
      Tz += -(r - courseRate) * 2.2 * k;
      const lim = this.maxDriftAngle;
      const over = beta - Math.max(-lim, Math.min(lim, beta));
      Tz += over * 18 * this.driftAssist * this.inertia;
    }

    // ---- resistances
    const sp = Math.hypot(u, v);
    let drag = s.dragCoef * sp * sp + s.rollResist * sp;
    let surfDrag = 0;
    if (this.surfaceFn) {
      for (let i = 0; i < 4; i++) { const t = this.wheelSurface[i]; if (t === 'grass') surfDrag += 0.25; else if (t === 'gravel') surfDrag += 0.4; }
    }
    this.offroad = surfDrag;
    drag += surfDrag * m * 0.6 * Math.min(1, sp / 3);
    if (sp > 0.01) { Fu -= drag * u / sp; Fv -= drag * v / sp; }

    // ---- integrate
    const au = Fu / m, av = Fv / m;
    // world acceleration
    const awx = au * sh + av * ch;
    const awz = au * ch - av * sh;
    this.vx += awx * h; this.vz += awz * h;
    this.yawRate += Tz / this.inertia * h;
    // low speed yaw damping (prevents creep spin when parked)
    if (sp < 0.5 && Math.abs(this.input.throttle) < 0.05) { this.yawRate *= 1 - Math.min(1, h * 6); this.vx *= 1 - h * 2; this.vz *= 1 - h * 2; }
    this.heading += this.yawRate * h;
    this.x += this.vx * h; this.z += this.vz * h;

    // filtered accel (body frame, excluding centripetal convention: ay = lateral accel)
    const k = Math.min(1, h / 0.09);
    this.ax += (au - this.ax) * k;
    this.ay += (av - this.ay) * k;
    // NB: centripetal acceleration included via au/av being force-based accelerations

    for (let i = 0; i < 4; i++) this.wheelAngle[i] += this.wheelOmega[i] * h;
  }

  // Apply impulse at world point (collisions). jx,jz world impulse (N*s)
  applyImpulse(px, pz, jx, jz) {
    const m = this.spec.mass;
    this.vx += jx / m; this.vz += jz / m;
    const rx = px - this.x, rz = pz - this.z;
    // torque about y: positive = left turn. cross in (x,z) with y-up: ty = rz*jx - rx*jz
    const ty = rz * jx - rx * jz;
    this.yawRate += ty / this.inertia;
  }

  // world-space corners of the body box
  corners(halfW = 0.9, front = 2.3, rear = 2.25) {
    const sh = Math.sin(this.heading), ch = Math.cos(this.heading);
    const pts = [[halfW, front], [-halfW, front], [-halfW, -rear], [halfW, -rear], [0, front + 0.05], [0, -rear - 0.05], [halfW, 0], [-halfW, 0]];
    return pts.map(([l, f]) => [this.x + l * ch + f * sh, this.z - l * sh + f * ch]);
  }

  // velocity of a world point on the body
  pointVel(px, pz) {
    const rx = px - this.x, rz = pz - this.z;
    // w = (0, r, 0); w x r = (r*rz, 0, -r*rx)
    return [this.vx + this.yawRate * rz, this.vz - this.yawRate * rx];
  }
}
