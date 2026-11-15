// Renderer, post-processing pipeline and graphics quality presets
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export const QUALITY = {
  low:   { label: 'Baixa', pixelRatio: 0.8, shadows: false, shadowSize: 1024, bloom: false, ao: false, aa: 'none', speedBlur: false, particles: 250, skid: 1500, antialias: false, envMap: false },
  high:  { label: 'Alta',  pixelRatio: 1.0, shadows: true,  shadowSize: 2048, bloom: true,  ao: false, aa: 'fxaa', speedBlur: true, particles: 700, skid: 4000, antialias: false, envMap: true },
  ultra: { label: 'Ultra', pixelRatio: 1.5, shadows: true,  shadowSize: 4096, bloom: true,  ao: true,  aa: 'smaa', speedBlur: true, particles: 1400, skid: 8000, antialias: false, envMap: true },
};

// radial speed blur + vignette + chromatic fringe (screen-space "motion blur")
const SpeedBlurShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, vignette: { value: 0.35 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette; varying vec2 vUv;
    void main(){
      vec2 c = vUv - vec2(0.5, 0.52);
      float d = length(c);
      vec4 col = texture2D(tDiffuse, vUv);
      if (amount > 0.001) {
        float k = amount * smoothstep(0.12, 0.7, d);
        vec4 acc = col; float w = 1.0;
        for (int i = 1; i <= 8; i++) { float t = float(i) / 8.0; vec2 uv = vUv - c * k * t * 0.09; acc += texture2D(tDiffuse, uv) * (1.0 - t * 0.5); w += (1.0 - t * 0.5); }
        col = acc / w;
      }
      float v = smoothstep(0.85, 0.25, d);
      col.rgb *= mix(1.0, v, vignette);
      gl_FragColor = col;
    }`,
};

export class Renderer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.id = 'game-canvas';
    this.quality = 'high';
    this.resScale = 1;
    this.composer = null;
    this.scene = null; this.camera = null;
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(q, resScale = this.resScale) {
    this.quality = q; this.resScale = resScale;
    const Q = QUALITY[q];
    this.renderer.shadowMap.enabled = Q.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * Q.pixelRatio * resScale);
    this.renderer.shadowMap.needsUpdate = true;
    if (this.scene && this.camera) this.buildComposer(this.scene, this.camera);
    this.resize();
  }

  buildComposer(scene, camera) {
    this.scene = scene; this.camera = camera;
    const Q = QUALITY[this.quality];
    if (this.composer) this.composer.dispose?.();
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x * this.renderer.getPixelRatio(), size.y * this.renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: this.quality === 'ultra' ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    this.aoPass = null;
    if (Q.ao) {
      try {
        const ao = new GTAOPass(scene, camera, size.x, size.y);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1, scale: 1, samples: 12 });
        composer.addPass(ao); this.aoPass = ao;
      } catch (e) { console.warn('AO disabled', e); }
    }
    this.bloomPass = null;
    if (Q.bloom) {
      this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 0.88);
      composer.addPass(this.bloomPass);
    }
    this.speedPass = new ShaderPass(SpeedBlurShader);
    this.speedPass.enabled = true;
    composer.addPass(this.speedPass);
    composer.addPass(new OutputPass());
    this.fxaa = null; this.smaa = null;
    if (Q.aa === 'fxaa') {
      this.fxaa = new ShaderPass(FXAAShader);
      composer.addPass(this.fxaa);
    } else if (Q.aa === 'smaa') {
      this.smaa = new SMAAPass(size.x * this.renderer.getPixelRatio(), size.y * this.renderer.getPixelRatio());
      composer.addPass(this.smaa);
    }
    this.composer = composer;
    this.resize();
  }

  setBloom(strength, threshold) { if (this.bloomPass) { this.bloomPass.strength = strength; this.bloomPass.threshold = threshold; } }
  setSpeedBlur(v) { if (this.speedPass) this.speedPass.uniforms.amount.value = QUALITY[this.quality].speedBlur && this.motionBlur !== false ? v : 0; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    if (this.composer) {
      this.composer.setSize(w, h);
      const pr = this.renderer.getPixelRatio();
      if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      if (this.aoPass) this.aoPass.setSize(w, h);
    }
  }

  render(scene, camera) {
    if (this.composer && this.scene === scene && this.camera === camera) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}
