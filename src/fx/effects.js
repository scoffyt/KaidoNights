// Tyre smoke / dust / sparks particles (instanced billboards) and skid marks
import * as THREE from 'three';

const PARTICLE_VS = `
  attribute vec3 iPos; attribute float iSize; attribute float iAlpha; attribute float iRot; attribute vec3 iColor;
  varying vec2 vUv; varying float vAlpha; varying vec3 vColor; varying float vFog;
  void main(){
    vUv = uv; vAlpha = iAlpha; vColor = iColor;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    float c = cos(iRot), s = sin(iRot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iSize;
    mv.xy += p;
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FS = `
  uniform sampler2D map; uniform vec3 tint; uniform vec3 fogColor; uniform float fogDensity;
  varying vec2 vUv; varying float vAlpha; varying vec3 vColor; varying float vFog;
  void main(){
    vec4 t = texture2D(map, vUv);
    vec3 col = vColor * tint;
    float f = 1.0 - exp(-fogDensity * fogDensity * vFog * vFog);
    col = mix(col, fogColor, clamp(f, 0.0, 1.0));
    float nearFade = smoothstep(1.5, 9.0, vFog); // particles close to the camera fade out
    gl_FragColor = vec4(col, t.a * vAlpha * nearFade);
    if (gl_FragColor.a < 0.004) discard;
    #include <colorspace_fragment>
  }`;

export class ParticleSystem {
  constructor(scene, texture, max = 800, additive = false) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.rot = new Float32Array(max); this.col = new Float32Array(max * 3);
    const mk = (arr, n) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    g.setAttribute('iPos', mk(this.pos, 3)); g.setAttribute('iSize', mk(this.size, 1)); g.setAttribute('iAlpha', mk(this.alpha, 1)); g.setAttribute('iRot', mk(this.rot, 1)); g.setAttribute('iColor', mk(this.col, 3));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, tint: { value: new THREE.Color(1, 1, 1) }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
      vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    this.p = []; // particle state objects
  }

  setMax(max) { this.limit = Math.min(max, this.max); }

  emit(o) {
    const q = { x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: 0, maxLife: o.life || 2, size0: o.size || 1, size1: o.size1 || (o.size || 1) * 4, a0: o.alpha ?? 0.5, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * (o.spin ?? 1), c: o.color || [1, 1, 1], drag: o.drag ?? 1.2, grav: o.grav ?? -0.3 };
    const lim = this.limit || this.max;
    if (this.p.length >= lim) { this._ri = ((this._ri || 0) + 1) % this.p.length; this.p[this._ri] = q; } // recycle (O(1))
    else this.p.push(q);
  }

  update(dt, fog) {
    const P = this.p;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.life += dt;
      if (q.life >= q.maxLife) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx *= k; q.vz *= k; q.vy = q.vy * k - q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05) { q.y = 0.05; q.vy = Math.abs(q.vy) * 0.3; }
      q.r += q.vr * dt;
      const t = q.life / q.maxLife;
      P[n++] = q;
    }
    P.length = n;
    for (let i = 0; i < n; i++) {
      const q = P[i]; const t = q.life / q.maxLife;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.size0 + (q.size1 - q.size0) * Math.sqrt(t);
      this.alpha[i] = q.a0 * Math.min(1, t * 8) * (1 - t) * (1 - t);
      this.rot[i] = q.r;
      this.col[i * 3] = q.c[0]; this.col[i * 3 + 1] = q.c[1]; this.col[i * 3 + 2] = q.c[2];
    }
    this.geo.instanceCount = n;
    for (const name of ['iPos', 'iSize', 'iAlpha', 'iRot', 'iColor']) { const a = this.geo.attributes[name]; a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, n * a.itemSize); }
    if (fog) { this.mat.uniforms.fogColor.value.copy(fog.color); this.mat.uniforms.fogDensity.value = fog.density; }
  }

  clear() { this.p.length = 0; this.geo.instanceCount = 0; }
}

export class SkidMarks {
  constructor(scene, texture, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    this.uv = new Float32Array(max * 4 * 2);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const a = i * 4; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
    for (let i = 0; i < max; i++) this.uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0xffffff });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.head = 0; this.count = 0;
    this.last = new Map(); // key -> {x,z,lx,lz,rx,rz}
  }

  // add segment for wheel key at (x,z), lateral dir (dx,dz) normalised, width w, intensity a, colour c
  add(key, x, z, dx, dz, w, a, c = [0.04, 0.04, 0.04]) {
    const L = this.last.get(key);
    const hw = w / 2;
    const lx = x + dx * hw, lz = z + dz * hw, rx = x - dx * hw, rz = z - dz * hw;
    if (L && a > 0.01) {
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < 0.25) return; // wait for enough distance
      if (d < 4) {
        const i = this.head;
        const y = 0.032;
        this.pos.set([L.lx, y, L.lz, L.rx, y, L.rz, lx, y, lz, rx, y, rz], i * 12);
        const a0 = L.a, a1 = a;
        this.col.set([c[0], c[1], c[2], a0, c[0], c[1], c[2], a0, c[0], c[1], c[2], a1, c[0], c[1], c[2], a1], i * 16);
        this.head = (this.head + 1) % this.max; this.count = Math.min(this.max, this.count + 1);
        const pa = this.geo.attributes.position, ca = this.geo.attributes.color;
        pa.addUpdateRange(i * 12, 12); ca.addUpdateRange(i * 16, 16); // partial GPU upload
        pa.needsUpdate = true; ca.needsUpdate = true;
        this.geo.setDrawRange(0, this.count * 6);
      }
    }
    if (a > 0.01) this.last.set(key, { x, z, lx, lz, rx, rz, a }); else this.last.delete(key);
  }

  break(key) { this.last.delete(key); }
  clear() { this.head = 0; this.count = 0; this.geo.setDrawRange(0, 0); this.last.clear(); }
}
