// Camera rig: chase (drift-aware), far chase, hood, bumper, cinematic trackside, orbit (garage/replay)
import * as THREE from 'three';

export const CAM_MODES = ['chase', 'far', 'free', 'hood', 'bumper', 'cinematic'];
export const CAM_LABELS = { chase: 'Perseguição', far: 'Perseguição distante', free: 'Livre (mouse)', hood: 'Capô', bumper: 'Para-choque', cinematic: 'Cinemática' };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3(0, 5, -10);
    this.look = new THREE.Vector3();
    this.yaw = 0;
    this.shake = 0;
    this.baseFov = 62;
    this.cine = null;
    this.cineTimer = 0;
    // mouse control: free camera (orbit around the car) + temporary look-around in chase modes
    this.free = { yaw: Math.PI, pitch: 0.28, dist: 6, followHeading: true, worldYaw: 0 };
    this.look2 = { yaw: 0, pitch: 0, idle: 99 };   // chase-mode mouse offset (springs back)
    this.sens = 1;
    this.enabled = false;
  }

  /** mouse input on the game canvas. Free mode: click locks the pointer (move = rotate), wheel = zoom,
   *  right button / middle click toggles "follow car heading". Chase modes: drag to look around. */
  attach(dom) {
    if (this._dom) return;
    this._dom = dom;
    let drag = false, lx = 0, ly = 0;
    const rotate = (dx, dy) => {
      const k = 0.0032 * this.sens;
      if (this.mode === 'free') {
        this.free.yaw -= dx * k;
        this.free.pitch = THREE.MathUtils.clamp(this.free.pitch + dy * k * 0.8, -0.12, 1.45);
      } else if (this.mode === 'chase' || this.mode === 'far') {
        this.look2.yaw -= dx * k; this.look2.pitch = THREE.MathUtils.clamp(this.look2.pitch + dy * k * 0.8, -0.25, 1.0);
        this.look2.idle = 0;
      }
    };
    this._onDown = e => {
      if (!this.enabled) return;
      if (e.button === 2 || e.button === 1) { if (this.mode === 'free') { this.toggleFollow(); e.preventDefault(); } return; }
      if (e.button !== 0) return;
      if (this.mode === 'free' && dom.requestPointerLock && document.pointerLockElement !== dom) { try { const r = dom.requestPointerLock(); r && r.catch && r.catch(() => { }); } catch { } }
      drag = true; lx = e.clientX; ly = e.clientY;
    };
    this._onMove = e => {
      if (!this.enabled) return;
      if (document.pointerLockElement === dom) { rotate(e.movementX, e.movementY); return; }
      if (!drag) return;
      rotate(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY;
    };
    this._onUp = () => { drag = false; };
    this._onWheel = e => {
      if (!this.enabled || this.mode !== 'free') return;
      this.free.dist = THREE.MathUtils.clamp(this.free.dist * (1 + Math.sign(e.deltaY) * 0.12), 2.2, 40);
    };
    this._onCtx = e => { if (this.enabled) e.preventDefault(); };
    dom.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: true });
    dom.addEventListener('contextmenu', this._onCtx);
  }
  /** called when gameplay starts/stops so menus keep their own mouse behaviour */
  setEnabled(on) { this.enabled = on; if (!on) this.releasePointer(); }
  releasePointer() { if (document.pointerLockElement && document.pointerLockElement === this._dom) document.exitPointerLock(); }
  toggleFollow() {
    const f = this.free;
    // keep the same view when switching between car-relative and world-fixed orbit
    if (f.followHeading) f.yaw += this._lastHeading || 0; else f.yaw -= this._lastHeading || 0;
    f.followHeading = !f.followHeading;
    return f.followHeading;
  }

  cycle() {
    const i = CAM_MODES.indexOf(this.mode); this.mode = CAM_MODES[(i + 1) % CAM_MODES.length]; this.cine = null;
    if (this.mode !== 'free') this.releasePointer();
    else { this.free.yaw = Math.PI; this.free.pitch = 0.28; this.free.followHeading = true; this._freePos = null; }
    return this.mode;
  }

  snap(car) { this.yaw = car.veh.heading; this._update(car, 1, true); }

  addShake(v) { this.shake = Math.min(1.2, this.shake + v); }

  update(car, dt, lookBack = false, world = null) { this._update(car, dt, false, lookBack, world); }

  _update(car, dt, snap, lookBack, world) {
    const v = car.veh, cam = this.camera;
    const sp = v.speed;
    const h = v.heading;
    const fwd = new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const carPos = new THREE.Vector3(v.x, 0, v.z);
    let fov = this.baseFov;
    if (this.mode === 'chase' || this.mode === 'far') {
      // follow direction blends heading with velocity direction while drifting
      const velYaw = sp > 3 ? Math.atan2(v.vx, v.vz) : h;
      let dYaw = velYaw - h; while (dYaw > Math.PI) dYaw -= 2 * Math.PI; while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
      const blend = Math.min(1, sp / 12) * 0.55;
      let target = h + dYaw * blend;
      if (v.gear === -1 && sp > 1) target = h;
      let d = target - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.yaw += d * Math.min(1, dt * (snap ? 100 : 4.5));
      const dist = this.mode === 'far' ? 6.8 : 4.4, height = this.mode === 'far' ? 2.3 : 1.45;
      // mouse look-around springs back to the default view after ~1.2 s without movement
      const L = this.look2; L.idle += dt;
      if (L.idle > 1.2) { const k = Math.min(1, dt * 3); L.yaw *= 1 - k; L.pitch *= 1 - k; }
      const yaw = this.yaw + (lookBack ? Math.PI : 0) + L.yaw;
      const back = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
      const pd = dist + Math.min(1.0, sp * 0.015);
      const targetPos = carPos.clone().addScaledVector(back, pd * Math.cos(L.pitch)).add(new THREE.Vector3(0, height + pd * Math.sin(L.pitch), 0));
      const looking = Math.abs(L.yaw) > 0.02 || Math.abs(L.pitch) > 0.02;
      if (snap || looking) this.pos.lerp(targetPos, snap ? 1 : Math.min(1, dt * 18)); else this.pos.lerp(targetPos, Math.min(1, dt * 10));
      this.look.copy(carPos).add(new THREE.Vector3(0, 0.95, 0)).addScaledVector(back, looking ? -0.6 : -2.4);
      fov = this.baseFov + Math.min(14, sp * 0.18);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
    } else if (this.mode === 'free') {
      const F = this.free;
      this._lastHeading = h;
      const yaw = F.yaw + (F.followHeading ? h : 0);
      const target = carPos.clone(); target.y = 0.8 + car.visual.body.position.y;
      const cp = Math.cos(F.pitch), dir = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(F.pitch), Math.cos(yaw) * cp);
      const want = target.clone().addScaledVector(dir, F.dist);
      if (want.y < 0.25) want.y = 0.25;
      // smooth only the orbit (the target follows rigidly so the car never drifts out of frame)
      if (!this._freePos || snap) this._freePos = want.clone(); else this._freePos.lerp(want, Math.min(1, dt * 14));
      cam.position.copy(this._freePos);
      cam.lookAt(target);
      fov = this.baseFov;
    } else if (this.mode === 'hood' || this.mode === 'bumper') {
      const yaw = h + (lookBack ? Math.PI : 0);
      const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const off = this.mode === 'hood' ? new THREE.Vector3(0, 1.12, 1.15) : new THREE.Vector3(0, 0.55, 2.35);
      const o = off.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), h);
      cam.position.copy(carPos).add(o);
      cam.position.y += car.visual.body.position.y;
      cam.lookAt(cam.position.clone().addScaledVector(f, 10).add(new THREE.Vector3(0, this.mode === 'hood' ? -0.6 : -0.2, 0)));
      cam.rotateZ(-car.visual.body.rotation.z * 0.7);
      fov = this.baseFov + 6 + Math.min(16, sp * 0.2);
    } else if (this.mode === 'cinematic') {
      this.cineTimer -= dt;
      const dd = this.cine ? this.cine.distanceTo(carPos) : 1e9;
      if (!this.cine || this.cineTimer <= 0 || dd > 75) {
        // place camera ahead of car beside the road
        const ahead = carPos.clone().addScaledVector(fwd, 30 + sp * 1.2);
        let side = new THREE.Vector3(fwd.z, 0, -fwd.x).multiplyScalar((Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 6));
        if (world) { const p = world.track.project(ahead.x, ahead.z); const tp = world.track.pointAt(p.s, (Math.random() < 0.5 ? 1 : -1) * (p.hw + 6)); ahead.set(tp.x, 0, tp.z); side.set(0, 0, 0); }
        this.cine = ahead.add(side); this.cine.y = 1.5 + Math.random() * 3;
        this.cineTimer = 6;
      }
      cam.position.copy(this.cine);
      cam.lookAt(carPos.x, 0.8, carPos.z);
      fov = THREE.MathUtils.clamp(900 / Math.max(10, dd), 18, 60);
    }
    if (this.shake > 0) {
      const s = this.shake * 0.08;
      cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s; cam.position.z += (Math.random() - 0.5) * s;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    // subtle speed vibration
    if (sp > 30 && this.mode !== 'cinematic') cam.position.y += (Math.random() - 0.5) * 0.004 * (sp - 30) * 0.2;
    if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
  }
}

// orbit camera for garage / menu backdrop
export class OrbitCam {
  constructor(camera, target = new THREE.Vector3(0, 0.7, 0)) {
    this.camera = camera; this.target = target;
    this.theta = 0.7; this.phi = 1.25; this.radius = 6.5;
    this.auto = true; this.dragging = false;
    this.vel = 0;
  }
  attach(dom) {
    let lx = 0, ly = 0;
    this._down = e => { if (e.button !== 0) return; this.dragging = true; lx = e.clientX; ly = e.clientY; this.auto = false; };
    this._move = e => { if (!this.dragging) return; this.theta -= (e.clientX - lx) * 0.006; this.phi = THREE.MathUtils.clamp(this.phi - (e.clientY - ly) * 0.004, 0.6, 1.5); lx = e.clientX; ly = e.clientY; };
    this._up = () => { this.dragging = false; };
    this._wheel = e => { this.radius = THREE.MathUtils.clamp(this.radius + e.deltaY * 0.004, 4.2, 10); };
    dom.addEventListener('pointerdown', this._down); window.addEventListener('pointermove', this._move); window.addEventListener('pointerup', this._up); dom.addEventListener('wheel', this._wheel, { passive: true });
    this.dom = dom;
  }
  detach() { if (!this.dom) return; this.dom.removeEventListener('pointerdown', this._down); window.removeEventListener('pointermove', this._move); window.removeEventListener('pointerup', this._up); this.dom.removeEventListener('wheel', this._wheel); this.dom = null; }
  update(dt) {
    if (this.auto) this.theta += dt * 0.18;
    const c = this.camera;
    c.position.set(this.target.x + this.radius * Math.sin(this.phi) * Math.sin(this.theta), this.target.y + this.radius * Math.cos(this.phi), this.target.z + this.radius * Math.sin(this.phi) * Math.cos(this.theta));
    c.lookAt(this.target);
  }
}
