// Sky, fog, sun/moon light, environment map (time-of-day presets)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const TIMES = {
  night:  { label: 'Noite', exposure: 0.95, fog: 0x0a1020, fogDensity: 0.0014, hemiSky: 0x6a7eb8, hemiGround: 0x2a2620, hemi: 0.8, sun: 0xa9bcff, sunI: 1.1, sunEl: 38, sunAz: 130, bloom: [0.4, 0.92], night: true },
  sunset: { label: 'Pôr do sol', exposure: 0.62, fog: 0xc9906a, fogDensity: 0.0011, hemiSky: 0xffc9a0, hemiGround: 0x3a2a20, hemi: 0.7, sun: 0xffb070, sunI: 3.2, sunEl: 6, sunAz: 250, bloom: [0.25, 0.95], night: false },
  day:    { label: 'Dia', exposure: 0.5, fog: 0xb8c8dc, fogDensity: 0.0007, hemiSky: 0xcfe3ff, hemiGround: 0x4a4436, hemi: 0.9, sun: 0xfff3e0, sunI: 3.6, sunEl: 48, sunAz: 200, bloom: [0.18, 0.95], night: false },
};

function nightSkyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { moonDir: { value: new THREE.Vector3(0.4, 0.6, -0.7).normalize() }, time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      varying vec3 vDir; uniform vec3 moonDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 top = vec3(0.012, 0.018, 0.045);
        vec3 hor = vec3(0.07, 0.085, 0.16);
        vec3 col = mix(hor, top, pow(max(h,0.0), 0.45));
        // city light pollution near horizon
        col += vec3(0.20, 0.11, 0.07) * exp(-max(h,0.0) * 14.0) * 0.55;
        // stars
        vec3 sp = floor(d * 420.0);
        float st = hash(sp);
        float star = step(0.9975, st) * smoothstep(0.0, 0.25, h) * (0.5 + 0.5 * hash(sp + 3.1));
        col += vec3(star) * 1.6;
        // moon
        float md = dot(d, normalize(moonDir));
        col += vec3(0.95, 0.97, 1.0) * smoothstep(0.9994, 0.9997, md) * 6.0;
        col += vec3(0.25, 0.3, 0.45) * pow(max(md, 0.0), 120.0) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene; this.renderer = renderer;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const c = this.sun.shadow.camera; c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 1; c.far = 400;
    scene.add(this.sun); scene.add(this.sun.target);
    this.sky = new Sky(); this.sky.scale.setScalar(4500);
    this.nightDome = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), nightSkyMaterial());
    this.nightDome.frustumCulled = false; this.nightDome.renderOrder = -10;
    scene.add(this.sky); scene.add(this.nightDome);
    scene.fog = new THREE.FogExp2(0x000000, 0.001);
    this.sunDir = new THREE.Vector3();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
  }

  setShadowQuality(size, enabled) {
    this.sun.castShadow = enabled;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  apply(timeKey, envMapOn = true) {
    const P = TIMES[timeKey] || TIMES.night;
    this.preset = P; this.timeKey = timeKey;
    const el = THREE.MathUtils.degToRad(P.sunEl), az = THREE.MathUtils.degToRad(P.sunAz);
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    this.hemi.color.setHex(P.hemiSky); this.hemi.groundColor.setHex(P.hemiGround); this.hemi.intensity = P.hemi;
    this.sun.color.setHex(P.sun); this.sun.intensity = P.sunI;
    this.scene.fog.color.setHex(P.fog); this.scene.fog.density = P.fogDensity;
    this.renderer.toneMappingExposure = P.exposure;
    if (P.night) {
      this.sky.visible = false; this.nightDome.visible = true;
      this.nightDome.material.uniforms.moonDir.value.copy(this.sunDir);
      this.scene.background = new THREE.Color(0x05070d);
    } else {
      this.sky.visible = true; this.nightDome.visible = false;
      const u = this.sky.material.uniforms;
      u.turbidity.value = timeKey === 'sunset' ? 6 : 3;
      u.rayleigh.value = timeKey === 'sunset' ? 2.6 : 1.2;
      u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.86;
      u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
      this.scene.background = null;
    }
    this.buildEnvMap(envMapOn);
  }

  buildEnvMap(on) {
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    if (!on) { this.scene.environment = null; return; }
    // render a small env scene: sky + a few bright emitters to give reflections character
    const envScene = new THREE.Scene();
    const P = this.preset;
    if (P.night) {
      const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), nightSkyMaterial());
      dome.material.uniforms.moonDir.value.copy(this.sunDir);
      envScene.add(dome);
      // floodlight strips around horizon
      const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.92, 0.8).multiplyScalar(6) });
      for (let k = 0; k < 10; k++) {
        const a = k / 10 * Math.PI * 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 0.6), lm);
        m.position.set(Math.cos(a) * 30, 8 + (k % 3) * 2, Math.sin(a) * 30); m.lookAt(0, 0, 0);
        envScene.add(m);
      }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: 0x0b0c10 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -1; envScene.add(ground);
    } else {
      const sky = new Sky(); sky.scale.setScalar(450);
      const u = sky.material.uniforms;
      Object.keys(this.sky.material.uniforms).forEach(k => { if (u[k] && u[k].value?.copy) u[k].value.copy(this.sky.material.uniforms[k].value); else if (u[k]) u[k].value = this.sky.material.uniforms[k].value; });
      envScene.add(sky);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: P === TIMES.sunset ? 0x2a2018 : 0x3a3a34 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
    }
    this.envRT = this.pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = P.night ? 0.8 : 1.0;
    envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
  }

  follow(x, z) {
    // keep the shadow camera centred on the player, snapped to whole shadow-map texels in light space:
    // a continuously sliding shadow camera makes every shadow edge crawl/flicker ("pixels jumping")
    const d = 120, sh = this.sun.shadow, cam = sh.camera;
    const texel = (cam.right - cam.left) / sh.mapSize.x;
    const f = this._lf || (this._lf = new THREE.Vector3()), r = this._lr || (this._lr = new THREE.Vector3()), u = this._lu || (this._lu = new THREE.Vector3());
    f.copy(this.sunDir).normalize().negate();
    r.set(0, 1, 0).cross(f).normalize(); u.copy(f).cross(r).normalize();
    const c = this._lc || (this._lc = new THREE.Vector3()); c.set(x, 0, z);
    const a = Math.round(c.dot(r) / texel) * texel, b = Math.round(c.dot(u) / texel) * texel, w = c.dot(f);
    c.copy(r).multiplyScalar(a).addScaledVector(u, b).addScaledVector(f, w);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(f, -d);
    this.sky.position.set(x, 0, z); this.nightDome.position.set(x, 0, z);
  }
}
