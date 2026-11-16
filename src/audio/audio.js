// =====================================================================
//  Fully synthesised audio (WebAudio) — engine driven by RPM & load,
//  turbo/blow-off, tyre screech, surfaces, wind, impacts, UI, music.
// =====================================================================

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.vol = { master: 0.8, music: 0.5, sfx: 0.9 };
    this.engines = [];
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master.connect(this.comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.vol.music; this.musicBus.connect(this.master);
    // shared noise buffer
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // pink-ish noise
    this.pinkBuf = c.createBuffer(1, len, c.sampleRate);
    const pd = this.pinkBuf.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; pd[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18; }
    this.enabled = true;
    this.buffers = {};
    this.loadSamples();
    this._buildWorldLoops();
  }

  // real recorded samples (assets/sounds, see CREDITS.txt); synthesis is the fallback
  async loadSamples() {
    const files = { engLow: 'engine_low.wav', engMid: 'engine_mid.wav', engHigh: 'engine_high.wav', skid: 'skid_loop.wav', imp1: 'impact_1.wav', imp2: 'impact_2.wav', imp3: 'impact_3.wav', imp4: 'impact_4.wav' };
    await Promise.all(Object.entries(files).map(async ([k, f]) => {
      try { const r = await fetch('./assets/sounds/' + f); if (!r.ok) throw new Error(r.status); this.buffers[k] = await this.ctx.decodeAudioData(await r.arrayBuffer()); }
      catch (e) { console.warn('som não carregado', f, e); }
    }));
    this.samplesReady = true;
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.vol.master, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * (this.musicDuck ?? 1), this.ctx.currentTime, 0.05);
  }

  noise(pink = false) { const s = this.ctx.createBufferSource(); s.buffer = pink ? this.pinkBuf : this.noiseBuf; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }

  _buildWorldLoops() {
    const c = this.ctx;
    // wind
    this.wind = c.createGain(); this.wind.gain.value = 0;
    const wf = c.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 700;
    this.noise(true).connect(wf).connect(this.wind).connect(this.sfx);
    this.windFilter = wf;
    // ambient crowd/night (very quiet)
    this.amb = c.createGain(); this.amb.gain.value = 0;
    const af = c.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 500; af.Q.value = 0.4;
    this.noise(true).connect(af).connect(this.amb).connect(this.sfx);
  }

  setAmbient(level, wind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.amb.gain.setTargetAtTime(level * 0.05, t, 0.3);
    this.wind.gain.setTargetAtTime(Math.min(0.35, wind * wind * 0.00012), t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + wind * 18, t, 0.1);
  }

  // ------------------------------------------------------------------
  createEngine(opts = {}) {
    if (!this.ctx) return null;
    const e = new EngineVoice(this, opts);
    this.engines.push(e);
    return e;
  }
  removeEngine(e) { if (!e) return; e.dispose(); this.engines = this.engines.filter(x => x !== e); }

  setListener(x, y, z, fx, fz) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    if (L.positionX) { L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z; L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else { L.setPosition(x, y, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  }

  // ------------------------------------------------------------------ one-shots
  impact(strength = 1, type = 'wall') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const imps = ['imp1', 'imp2', 'imp3', 'imp4'].map(k => this.buffers && this.buffers[k]).filter(Boolean);
    if (imps.length && type !== 'cone') {
      const src = c.createBufferSource(); src.buffer = imps[Math.floor(Math.random() * imps.length)];
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const g = c.createGain(); g.gain.value = Math.min(1.3, 0.3 + strength * 0.7);
      src.connect(g).connect(this.sfx); src.start(t);
      return;
    }
    const g = c.createGain(); g.gain.setValueAtTime(Math.min(1.2, 0.25 + strength * 0.6), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5 + strength * 0.3);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = type === 'cone' ? 2500 : 900 + strength * 1400;
    const n = this.noise(); n.connect(f).connect(g).connect(this.sfx); n.stop(t + 1.0);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(type === 'cone' ? 320 : 90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const og = c.createGain(); og.gain.setValueAtTime(type === 'cone' ? 0.15 : Math.min(1, 0.4 + strength * 0.5), t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.35);
    if (type === 'wall' && strength > 0.6) { // metal scrape ring
      const r = c.createOscillator(); r.type = 'triangle'; r.frequency.value = 1400 + Math.random() * 700;
      const rg = c.createGain(); rg.gain.setValueAtTime(0.06, t); rg.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
      r.connect(rg).connect(this.sfx); r.start(t); r.stop(t + 0.6);
    }
  }

  /** car horn (dual-tone, optionally positioned in 3D) */
  horn(pos = null, dur = 0.45) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.02); g.gain.setValueAtTime(0.22, t + dur - 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200;
    let out = this.sfx;
    if (pos) { const pn = c.createPanner(); pn.panningModel = 'HRTF'; pn.distanceModel = 'inverse'; pn.refDistance = 6; pn.maxDistance = 400; pn.rolloffFactor = 1.2; if (pn.positionX) { pn.positionX.value = pos.x; pn.positionY.value = 1; pn.positionZ.value = pos.z; } else pn.setPosition(pos.x, 1, pos.z); pn.connect(this.sfx); out = pn; }
    f.connect(g).connect(out);
    for (const fr of [415, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + dur + 0.02); }
  }
  /** notification chime: 'challenge' | 'chat' | 'friend' | 'win' | 'lose' */
  chime(kind = 'chat') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const seq = { challenge: [784, 988, 1175, 1568], chat: [1320], friend: [988, 1319], win: [784, 988, 1175, 1568, 2093], lose: [659, 523, 392], event: [523, 659, 784, 1046] }[kind] || [1000];
    seq.forEach((fr, i) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = fr;
      const st = t + i * 0.09; g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.12, st + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.28);
      o.connect(g).connect(this.sfx); o.start(st); o.stop(st + 0.3);
    });
  }

  ui(kind = 'move') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    const map = { move: [880, 0.04, 'triangle'], select: [1320, 0.08, 'square'], back: [520, 0.07, 'triangle'], score: [1760, 0.12, 'sine'], fail: [220, 0.3, 'sawtooth'], medal: [1046, 0.5, 'triangle'], count: [660, 0.18, 'square'], go: [1320, 0.45, 'square'] };
    const [f, d, type] = map[kind] || map.move;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (kind === 'fail') o.frequency.exponentialRampToValueAtTime(90, t + d);
    if (kind === 'medal' || kind === 'score') o.frequency.setValueAtTime(f * 1.5, t + d * 0.4);
    g.gain.setValueAtTime(kind === 'move' ? 0.05 : 0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + d + 0.02);
  }

  // ------------------------------------------------------------------ music
  startMusic(mode = 'menu') {
    if (!this.ctx) return;
    if (this.music && this.music.mode === mode) return;
    this.stopMusic();
    this.music = new SynthMusic(this, mode);
  }
  stopMusic() { if (this.music) { this.music.stop(); this.music = null; } }
  duckMusic(v) { this.musicDuck = v; if (this.ctx) this.musicBus.gain.setTargetAtTime(this.vol.music * v, this.ctx.currentTime, 0.3); }
}

// ---------------------------------------------------------------------
class EngineVoice {
  constructor(sys, { spatial = false, volume = 1 } = {}) {
    this.sys = sys; const c = sys.ctx; this.c = c;
    this.out = c.createGain(); this.out.gain.value = 0;
    this.volume = volume;
    if (spatial) {
      this.panner = c.createPanner();
      this.panner.panningModel = 'HRTF'; this.panner.distanceModel = 'inverse'; this.panner.refDistance = 6; this.panner.maxDistance = 400; this.panner.rolloffFactor = 1.3;
      this.out.connect(this.panner).connect(sys.sfx);
    } else this.out.connect(sys.sfx);

    // --- engine core: custom periodic wave (I6 firing harmonics)
    const real = new Float32Array(16), imag = new Float32Array(16);
    const h = [0, 1, 0.55, 0.42, 0.5, 0.22, 0.3, 0.12, 0.16, 0.08, 0.1, 0.05, 0.06, 0.03, 0.03, 0.02];
    for (let i = 1; i < 16; i++) imag[i] = h[i];
    const wave = c.createPeriodicWave(real, imag);
    this.osc1 = c.createOscillator(); this.osc1.setPeriodicWave(wave);
    this.osc2 = c.createOscillator(); this.osc2.type = 'sawtooth';
    this.sub = c.createOscillator(); this.sub.type = 'sine';
    this.g1 = c.createGain(); this.g1.gain.value = 0.55;
    this.g2 = c.createGain(); this.g2.gain.value = 0.18;
    this.gs = c.createGain(); this.gs.gain.value = 0.35;
    // roughness AM at crank frequency
    this.am = c.createGain(); this.am.gain.value = 1;
    this.lfo = c.createOscillator(); this.lfo.type = 'triangle';
    this.lfoG = c.createGain(); this.lfoG.gain.value = 0.18;
    this.lfo.connect(this.lfoG).connect(this.am.gain);
    // intake noise
    this.nz = sys.noise(); this.nzF = c.createBiquadFilter(); this.nzF.type = 'bandpass'; this.nzF.Q.value = 1.2; this.nzG = c.createGain(); this.nzG.gain.value = 0.0;
    this.nz.connect(this.nzF).connect(this.nzG).connect(this.am);
    this.shaper = c.createWaveShaper(); this.shaper.curve = EngineVoice.curve(); this.shaper.oversample = '2x';
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 2.5;
    this.peak = c.createBiquadFilter(); this.peak.type = 'peaking'; this.peak.frequency.value = 180; this.peak.gain.value = 6; this.peak.Q.value = 1;
    this.osc1.connect(this.g1).connect(this.am);
    this.osc2.connect(this.g2).connect(this.am);
    this.sub.connect(this.gs).connect(this.am);
    // synthesized layer goes through its own gain so recorded samples can take over
    this.synthG = c.createGain(); this.synthG.gain.value = 1;
    this.am.connect(this.shaper).connect(this.lp).connect(this.peak).connect(this.synthG).connect(this.out);

    // --- turbo whistle
    this.turbo = c.createOscillator(); this.turbo.type = 'sine';
    this.turboG = c.createGain(); this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG).connect(this.out);

    // --- tyres: noisy screech + tonal squeal
    this.tyreG = c.createGain(); this.tyreG.gain.value = 0;
    this.tyreBP = c.createBiquadFilter(); this.tyreBP.type = 'bandpass'; this.tyreBP.frequency.value = 1100; this.tyreBP.Q.value = 2.2;
    this.tyreN = sys.noise(); this.tyreN.connect(this.tyreBP).connect(this.tyreG);
    this.sq = c.createOscillator(); this.sq.type = 'sawtooth'; this.sq.frequency.value = 820;
    this.sqF = c.createBiquadFilter(); this.sqF.type = 'bandpass'; this.sqF.frequency.value = 900; this.sqF.Q.value = 6;
    this.sqG = c.createGain(); this.sqG.gain.value = 0.25;
    this.vib = c.createOscillator(); this.vib.frequency.value = 9; this.vibG = c.createGain(); this.vibG.gain.value = 22; this.vib.connect(this.vibG).connect(this.sq.frequency);
    this.sq.connect(this.sqF).connect(this.sqG).connect(this.tyreG);
    this.tyreG.connect(spatial ? this.panner : sys.sfx);

    // --- surface rumble (gravel/grass)
    this.rumbleG = c.createGain(); this.rumbleG.gain.value = 0;
    this.rumbleF = c.createBiquadFilter(); this.rumbleF.type = 'lowpass'; this.rumbleF.frequency.value = 380;
    sys.noise().connect(this.rumbleF).connect(this.rumbleG).connect(spatial ? this.panner : sys.sfx);

    [this.osc1, this.osc2, this.sub, this.lfo, this.turbo, this.sq, this.vib].forEach(o => o.start());
    this.boost = 0; this.lastThrottle = 0; this.popTimer = 0;
    this.out.gain.setTargetAtTime(0.5 * volume, c.currentTime, 0.2);
  }

  static curve() {
    if (EngineVoice._curve) return EngineVoice._curve;
    const n = 1024, cv = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(x * 2.2) * 0.9; }
    return (EngineVoice._curve = cv);
  }

  setPosition(x, y, z) { if (!this.panner) return; if (this.panner.positionX) { this.panner.positionX.value = x; this.panner.positionY.value = y; this.panner.positionZ.value = z; } else this.panner.setPosition(x, y, z); }

  // rpm, throttle 0..1, skid 0..1, slipSpeed m/s, offroad 0..1, limiter bool, dt
  _setupSamples() {
    const B = this.sys.buffers, c = this.c;
    this.sampleSetup = true;
    if (B.engLow && B.engHigh) {
      this.smpFilter = c.createBiquadFilter(); this.smpFilter.type = 'lowpass'; this.smpFilter.Q.value = 0.7;
      this.smpBus = c.createGain(); this.smpBus.gain.value = 1.0;
      this.smpFilter.connect(this.smpBus).connect(this.out);
      this.layers = [['engLow', 42.8], ['engMid', 69.8], ['engHigh', 76.2]].filter(([k]) => B[k]).map(([k, f0]) => {
        const src = c.createBufferSource(); src.buffer = B[k]; src.loop = true; src.start(0, Math.random() * B[k].duration);
        const g = c.createGain(); g.gain.value = 0; src.connect(g).connect(this.smpFilter);
        return { src, g, f0 };
      });
      this.synthG.gain.setTargetAtTime(0.32, c.currentTime, 0.2); // keep a little synth for top-end/turbo character
    }
    if (B.skid) {
      const src = c.createBufferSource(); src.buffer = B.skid; src.loop = true; src.start(0, Math.random() * B.skid.duration);
      this.skidSrc = src; this.skidG = c.createGain(); this.skidG.gain.value = 0;
      src.connect(this.skidG).connect(this.panner || this.sys.sfx);
      this.sqG.gain.value = 0.06; // tonal synth squeal mostly replaced
    }
  }

  update({ rpm, throttle, skid, slipSpeed = 0, offroad = 0, limiter = false, nitro = false }, dt) {
    const c = this.c, t = c.currentTime;
    if (!this.sampleSetup && this.sys.samplesReady) this._setupSamples();
    if (this.layers) {
      // crossfade recorded loops by rpm; pitch follows firing frequency (compressed so it never sounds chipmunky)
      const n = Math.min(1, Math.max(0, (rpm - 900) / 7300));
      const target = 42 * Math.pow(rpm / 950, 0.78);
      const w = [Math.max(0, 1 - n * 2.2), Math.max(0, 1 - Math.abs(n - 0.5) * 2.4), Math.max(0, (n - 0.45) * 1.9)];
      const sum = w.reduce((a, b) => a + b, 0) || 1;
      this.layers.forEach((L, i) => {
        const wi = w[i] ?? w[w.length - 1];
        L.src.playbackRate.setTargetAtTime(Math.min(4, target / L.f0), t, 0.03);
        L.g.gain.setTargetAtTime((wi / sum) * (0.55 + throttle * 0.6), t, 0.05);
      });
      this.smpFilter.frequency.setTargetAtTime(900 + throttle * 5000 + rpm * 0.4, t, 0.05);
    }
    if (this.skidSrc) {
      this.skidSrc.playbackRate.setTargetAtTime(0.85 + Math.min(slipSpeed, 30) * 0.01, t, 0.05);
      this.skidG.gain.setTargetAtTime(Math.min(1, skid) * 0.75 * this.volume, t, 0.04);
    }
    const f0 = rpm / 60 * 3;                 // firing frequency (I6)
    const tc = 0.025;
    this.osc1.frequency.setTargetAtTime(f0, t, tc);
    this.osc2.frequency.setTargetAtTime(f0 * 2.003, t, tc);
    this.sub.frequency.setTargetAtTime(f0 * 0.5, t, tc);
    this.lfo.frequency.setTargetAtTime(rpm / 60, t, tc);
    this.nzF.frequency.setTargetAtTime(500 + rpm * 0.35, t, 0.05);
    const load = throttle;
    this.nzG.gain.setTargetAtTime(0.05 + load * 0.22, t, 0.05);
    this.g2.gain.setTargetAtTime(0.1 + load * 0.25, t, 0.05);
    this.lp.frequency.setTargetAtTime(380 + rpm * 0.32 + load * 2600, t, 0.04);
    const vol = (0.28 + load * 0.5 + rpm / 8000 * 0.25) * this.volume * (limiter ? 0.55 : 1);
    this.out.gain.setTargetAtTime(vol, t, 0.03);
    // turbo boost model
    const targetBoost = Math.max(0, (rpm - 2800) / 4200) * throttle;
    this.boost += (targetBoost - this.boost) * Math.min(1, dt * (targetBoost > this.boost ? 2.2 : 5));
    this.turbo.frequency.setTargetAtTime(1800 + this.boost * 4200, t, 0.05);
    this.turboG.gain.setTargetAtTime(this.boost * 0.035 * this.volume, t, 0.05);
    // blow-off valve on lift
    if (this.lastThrottle > 0.6 && throttle < 0.2 && this.boost > 0.35) this.blowOff(this.boost);
    // pops & crackles on overrun / limiter
    this.popTimer -= dt;
    if ((limiter || (throttle < 0.1 && rpm > 4200)) && this.popTimer <= 0 && Math.random() < (limiter ? 0.5 : 0.12)) { this.pop(); this.popTimer = 0.05 + Math.random() * 0.12; }
    this.lastThrottle = throttle;
    // tyres
    const sk = Math.min(1, skid);
    this.tyreG.gain.setTargetAtTime(sk * (this.skidSrc ? 0.08 : 0.32) * this.volume, t, 0.04);
    this.tyreBP.frequency.setTargetAtTime(800 + Math.min(slipSpeed, 30) * 22, t, 0.05);
    this.sq.frequency.setTargetAtTime(700 + Math.min(slipSpeed, 30) * 9, t, 0.05);
    this.rumbleG.gain.setTargetAtTime(Math.min(0.5, offroad) * this.volume * 0.6, t, 0.05);
  }

  blowOff(b) {
    const c = this.c, t = c.currentTime;
    const n = this.sys.noise(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(3200, t); f.frequency.exponentialRampToValueAtTime(1200, t + 0.35); f.Q.value = 1.5;
    const g = c.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.22 * b * this.volume, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    n.connect(f).connect(g).connect(this.panner || this.sys.sfx); n.stop(t + 0.5);
    this.boost *= 0.3;
  }

  pop() {
    const c = this.c, t = c.currentTime;
    const n = this.sys.noise(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500 + Math.random() * 1500;
    const g = c.createGain(); g.gain.setValueAtTime(0.35 * this.volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.04);
    n.connect(f).connect(g).connect(this.panner || this.sys.sfx); n.stop(t + 0.12);
  }

  shift() {
    const c = this.c, t = c.currentTime;
    this.out.gain.cancelScheduledValues(t); this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0.08 * this.volume, t + 0.04);
    const n = this.sys.noise(); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = c.createGain(); g.gain.setValueAtTime(0.08 * this.volume, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(f).connect(g).connect(this.panner || this.sys.sfx); n.stop(t + 0.08);
    if (this.boost > 0.4) this.blowOff(this.boost * 0.7);
  }

  silence() { const t = this.c.currentTime; this.out.gain.setTargetAtTime(0, t, 0.05); this.skidG && this.skidG.gain.setTargetAtTime(0, t, 0.05); this.tyreG.gain.setTargetAtTime(0, t, 0.05); this.rumbleG.gain.setTargetAtTime(0, t, 0.05); this.turboG.gain.setTargetAtTime(0, t, 0.05); }

  dispose() {
    try { [this.osc1, this.osc2, this.sub, this.lfo, this.turbo, this.sq, this.vib, this.nz, this.tyreN, this.skidSrc, ...(this.layers || []).map(l => l.src)].forEach(o => o && o.stop()); } catch (e) { }
    try { this.skidG && this.skidG.disconnect(); } catch (e) { }
    try { this.out.disconnect(); this.tyreG.disconnect(); this.rumbleG.disconnect(); this.panner && this.panner.disconnect(); } catch (e) { }
  }
}

// ---------------------------------------------------------------------
//  Procedural synthwave / city-pop style loop
// ---------------------------------------------------------------------
class SynthMusic {
  constructor(sys, mode) {
    this.sys = sys; this.mode = mode; const c = sys.ctx;
    this.bpm = mode === 'menu' ? 96 : 118;
    this.step = 0; this.next = c.currentTime + 0.1;
    this.out = c.createGain(); this.out.gain.value = 0; this.out.connect(sys.musicBus);
    this.out.gain.setTargetAtTime(mode === 'menu' ? 0.55 : 0.35, c.currentTime, 1.0);
    this.delay = c.createDelay(); this.delay.delayTime.value = 60 / this.bpm * 0.75;
    this.fb = c.createGain(); this.fb.gain.value = 0.32;
    this.delay.connect(this.fb).connect(this.delay); this.delay.connect(this.out);
    // progression (A minor-ish: Am F C G / Dm)
    this.chords = mode === 'menu'
      ? [[57, 60, 64, 67], [53, 57, 60, 64], [48, 52, 55, 59], [55, 59, 62, 65]]
      : [[52, 55, 59, 62], [48, 52, 55, 59], [55, 59, 62, 66], [50, 53, 57, 60]];
    this.timer = setInterval(() => this.schedule(), 40);
  }
  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  schedule() {
    const c = this.sys.ctx; const spb = 60 / this.bpm / 4; // 16th notes
    while (this.next < c.currentTime + 0.15) { this.play(this.step, this.next, spb); this.next += spb; this.step++; }
  }
  play(step, t, spb) {
    const c = this.sys.ctx;
    const bar = Math.floor(step / 16) % 4, s = step % 16;
    const ch = this.chords[bar];
    // kick on quarters
    if (s % 4 === 0) { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); g.gain.setValueAtTime(0.75, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.32); }
    // snare on 2 & 4
    if (s === 4 || s === 12) { const n = this.sys.noise(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.7; const g = c.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); n.connect(f).connect(g).connect(this.out); n.connect(f).connect(g).connect(this.delay); n.stop(t + 0.2); }
    // hats
    if (s % 2 === 1 || this.mode !== 'menu') { const n = this.sys.noise(); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000; const g = c.createGain(); g.gain.setValueAtTime(s % 4 === 2 ? 0.08 : 0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04); n.connect(f).connect(g).connect(this.out); n.stop(t + 0.05); }
    // bass: octave pulse
    { const root = ch[0] - 24 + (s % 2 ? 12 : 0); const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(root); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1200, t); f.frequency.exponentialRampToValueAtTime(200, t + spb * 0.9); const g = c.createGain(); g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.001, t + spb * 0.95); o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + spb); }
    // pad at bar start
    if (s === 0) {
      for (const m of ch) for (const det of [-6, 6]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(m); o.detune.value = det;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
        const g = c.createGain(); const dur = spb * 16; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.022, t + 0.4); g.gain.setValueAtTime(0.022, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(f).connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
      }
    }
    // arpeggio lead
    if (this.mode === 'menu' ? s % 2 === 0 : true) {
      const pat = [0, 2, 1, 3, 2, 1, 3, 0];
      const m = ch[pat[(s >> (this.mode === 'menu' ? 1 : 0)) % 8]] + 12;
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = this.mtof(m);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2400;
      const g = c.createGain(); g.gain.setValueAtTime(0.035, t); g.gain.exponentialRampToValueAtTime(0.001, t + spb * 1.6);
      o.connect(f).connect(g); g.connect(this.out); g.connect(this.delay); o.start(t); o.stop(t + spb * 1.7);
    }
  }
  stop() { clearInterval(this.timer); const c = this.sys.ctx; this.out.gain.setTargetAtTime(0, c.currentTime, 0.3); setTimeout(() => this.out.disconnect(), 1500); }
}
