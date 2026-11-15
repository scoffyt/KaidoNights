// =====================================================================
//  KAIDO NIGHTS — main game orchestrator
// =====================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Renderer, QUALITY } from './core/renderer.js';
import { Input } from './core/input.js';
import { Save } from './core/save.js';
import { CameraRig, OrbitCam, CAM_LABELS } from './core/camera.js';
import { World, PLAZA, START_S } from './world/world.js';
import { Environment, TIMES } from './world/environment.js';
import { getTextures } from './world/textures.js';
import { Nature } from './world/nature.js';
import { loadCarTemplate, placeholderTemplate, CarVisual } from './car/carModel.js';
import { Car, DEFAULT_TUNE } from './car/car.js';
import { CARS, carById } from './car/cars.js';
import { ParticleSystem, SkidMarks } from './fx/effects.js';
import { AudioSystem } from './audio/audio.js';
import { UI } from './ui/ui.js';
import { FreeDriftMode, ChallengeMode, RaceMode, TimeAttackMode, BattleMode, fmtTime } from './modes/modes.js';

import { NetClient } from './net/net.js';
import { OnlineMode } from './net/online.js';
const MODE_CLASSES = { online: OnlineMode, free: FreeDriftMode, challenge: ChallengeMode, race: RaceMode, timeattack: TimeAttackMode, battle: BattleMode };

export class Game {
  constructor() {
    this.state = 'loading';
    this.save = new Save();
    this.input = new Input();
    this.audio = new AudioSystem();
    this.ui = new UI(this);
    this.cars = [];
    this.clock = new THREE.Clock();
    this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
    window.__game = this; // debug / automated tests
    this.net = new NetClient();
  }

  setLoading(p, txt) {
    const bar = document.querySelector('#loading .loadbar i'); if (bar) bar.style.width = (p * 100).toFixed(0) + '%';
    const t = document.querySelector('#loading .loadtxt'); if (t && txt) t.textContent = txt;
  }
  // load (and cache) a car template from the catalogue
  async getTpl(id, onProgress) {
    if (this.tpls[id]) return this.tpls[id];
    if (this._tplLoading && this._tplLoading[id]) return this._tplLoading[id];
    const def = carById(id);
    this._tplLoading = this._tplLoading || {};
    this._tplLoading[id] = loadCarTemplate(def.file, onProgress, { wheelBase: def.wheelBase, ...(def.import || {}) }).then(t => { this.tpls[id] = t; t.carId = id; delete this._tplLoading[id]; return t; })
      .catch(e => { delete this._tplLoading[id]; throw e; });
    return this._tplLoading[id];
  }
  // per-car paint/tune configuration
  carConfig(id) {
    const d = this.save.data; d.carConfigs = d.carConfigs || {};
    if (d.car.id === id) return d.car;
    const def = carById(id);
    return d.carConfigs[id] || { id, color: def.color, finish: 'metallic', rim: def.rim, smoke: '#eeeeee', tune: null };
  }
  async frame() { await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); }

  async init() {
    const s = this.save.s;
    this.setLoading(0.02, 'Iniciando renderizador');
    await this.frame();
    this.renderer = new Renderer(document.body);
    this.renderer.quality = s.quality; this.renderer.resScale = s.resScale;
    this.renderer.motionBlur = s.motionBlur;
    this.renderer.setQuality(s.quality, s.resScale);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(s.fov, innerWidth / innerHeight, 0.1, 5000);
    this.rig = new CameraRig(this.camera); this.rig.baseFov = s.fov; this.rig.mode = s.camera || 'chase';
    this.rig.sens = s.mouseSens ?? 1;

    this.setLoading(0.06, 'Gerando texturas');
    await this.frame();
    getTextures(s.quality);
    this.env = new Environment(this.scene, this.renderer.renderer);

    this.setLoading(0.12, 'Construindo o circuito Hakone Bay');
    await this.frame();
    this.world = new World(this.scene, s.quality);
    // local lamp lights (nearest floodlights become real lights around the player)
    this.lampLights = [];
    for (let k = 0; k < 4; k++) { const l = new THREE.PointLight(0xffe2b8, 0, 55, 1.6); this.scene.add(l); this.lampLights.push(l); }
    this._lampT = 0;

    // effects
    const T = getTextures(s.quality);
    this.effects = {
      smoke: new ParticleSystem(this.scene, T.smoke, 1600, false),
      sparks: new ParticleSystem(this.scene, T.glow, 400, true),
      skid: new SkidMarks(this.scene, T.skid, 8000),
    };

    // Stylized Nature MegaKit (assets/nature) — falls back to procedural trees if missing
    this.setLoading(0.15, 'Plantando vegetação (Stylized Nature)');
    await this.frame();
    try {
      this.nature = new Nature(this.world, this.scene, s.quality);
      await this.nature.load(p => this.setLoading(0.15 + p * 0.05, `Plantando vegetação ${(p * 100).toFixed(0)}%`));
      const st = this.nature.scatter();
      console.info('nature', st);
      // keep the cheap procedural trees only as a distant forest ring
      this.world.buildProcTrees(s.quality === 'low' ? 250 : s.quality === 'ultra' ? 900 : 550, 470);
    } catch (e) { console.warn('Pacote de natureza indisponível, usando árvores procedurais', e); this.nature = null; }

    // Drift Park region (second map) streams in the background
    this.world.park.load().then(pk => console.info('drift park', { segments: pk.segCount })).catch(e => console.warn('Drift Park indisponível', e));

    this.setLoading(0.2, 'Carregando Nissan Skyline R34 (GLB)');
    await this.frame();
    this.tpls = {};
    const curId = this.save.data.car.id = carById(this.save.data.car.id).id;
    try {
      this.carTpl = await this.getTpl(curId, p => this.setLoading(0.2 + p * 0.6, `Carregando ${carById(curId).short} ${(p * 100).toFixed(0)}%`));
    } catch (e) {
      console.error('GLB load failed, using placeholder', e);
      this.carTpl = placeholderTemplate();
      this.glbError = String(e && e.message || e);
    }
    this.setLoading(0.85, 'Preparando garagem');
    await this.frame();
    this._buildGarage();
    this.applyTime(s.time);

    // player car
    this.player = this._spawnPlayer();
    this._placeMenuCar();
    this._parkedCars();
    this.applySettings();

    this.setLoading(0.95, 'Compilando shaders');
    await this.frame();
    this.renderer.buildComposer(this.scene, this.camera);
    this.rig.attach(this.renderer.renderer.domElement);
    try { this.renderer.renderer.compile(this.scene, this.camera); } catch (e) { }
    this.setLoading(1, 'Pronto');
    await this.frame();
    document.getElementById('loading').classList.add('hide');
    this.state = 'title';
    this.menuOrbit = new OrbitCam(this.camera, new THREE.Vector3());
    this.menuOrbit.radius = 7.5; this.menuOrbit.phi = 1.32;
    this.menuOrbit.target.set(this.player.veh.x, 0.8, this.player.veh.z);
    this.ui.title();
    const startFromTitle = () => {
      if (this.state !== 'title') return;
      this.audio.init(); this.applySettings(); this.ensureEngines();
      this.audio.startMusic('menu');
      this.toMenu();
      if (this.glbError) this.ui.toast('Modelo R34.glb não encontrado — usando carro provisório', 5000);
    };
    window.addEventListener('keydown', e => { if (e.code === 'F1') { e.preventDefault(); if (this.state === 'menu') this.ui.helpMenu(); } startFromTitle(); });
    window.addEventListener('pointerdown', startFromTitle);
    this._startFromTitle = startFromTitle;
    this.input.onPad = (id) => this.ui.toast('Controle conectado: ' + id.slice(0, 40));
    this.loop();
  }

  // ------------------------------------------------------------ cars
  _carOpts() {
    const c = this.save.data.car, s = this.save.s;
    return { isPlayer: true, name: 'player', baseSpec: carById(c.id).spec, color: c.color, finish: c.finish, rimColor: c.rim, tune: c.tune || DEFAULT_TUNE, tcs: s.tcs, abs: s.abs, steerAssist: s.steerAssist, driftAssist: s.driftAssist, autoGear: s.autoGear, smokeColor: hexToRgb(c.smoke) };
  }
  _spawnPlayer() { const car = new Car(this, this.carTpl, this._carOpts()); this.cars.push(car); return car; }
  spawnAICar({ color = '#ffffff', name = 'AI' } = {}) {
    const ids = Object.keys(this.tpls); const id = ids[Math.floor(Math.random() * ids.length)] || null;
    const tpl = id ? this.tpls[id] : this.carTpl;
    const car = new Car(this, tpl, { baseSpec: id ? carById(id).spec : {}, color, name: name + Math.random().toString(36).slice(2, 6), lod: true, tcs: true, driftAssist: 0.6, steerAssist: 0, headlights: false });
    this.cars.push(car); return car;
  }
  spawnGhost() {
    const car = new Car(this, this.carTpl, { color: '#00e5ff', name: 'ghost', lod: true, ghost: true, headlights: false });
    car.visual.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.28; o.material.depthWrite = false; o.castShadow = false; } });
    this.audio.removeEngine(car.engine); car.engine = null;
    this.cars.push(car); return car;
  }
  // cars created before the AudioContext existed get their engine voice now
  // ------------------------------------------------------------ online
  /** make the local player car match the server-side active car (ownership is enforced by the server) */
  async syncOnlineCar(carId, live = false) {
    const d = this.save.data;
    const cfg = carId === d.car.id ? d.car : (d.carConfigs && d.carConfigs[carId]) || this.carConfig(carId);
    const look = { color: cfg.color, rim: cfg.rim, finish: cfg.finish, smoke: cfg.smoke, rideHeight: cfg.tune && cfg.tune.rideHeight || 0 };
    const r = await this.net.api('/api/garage', { car: carId, look });
    this.net.profile = r.profile;
    if (carId !== d.car.id) {
      if (live) { const v = this.player.veh; const x = v.x, z = v.z, h = v.heading; await this.selectCar(carId); this.player.place(x, z, h); this.ensureEngines(); }
      else await this.selectCar(carId);
    }
  }
  async goOnline(room) {
    const net = this.net;
    this.ui.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="width:560px"><h1>Conectando…</h1><div class="desc" id="mp-st">Sincronizando garagem</div></div></div>`);
    const st = (t) => { const e = document.getElementById('mp-st'); if (e) e.textContent = t; };
    try {
      const pr = await net.me();
      const owned = pr.cars.map(c => c.id);
      const want = owned.includes(this.save.data.car.id) ? this.save.data.car.id : pr.active_car;
      await this.syncOnlineCar(want);
      st('Entrando no mundo compartilhado');
      const welcome = await new Promise((res, rej) => {
        const offs = [];
        const done = (f, v) => { offs.forEach(o => o()); clearTimeout(to); f(v); };
        offs.push(net.on('welcome', m => done(res, m)));
        offs.push(net.on('fatal', m => done(rej, new Error(m.msg))));
        const to = setTimeout(() => done(rej, new Error('Tempo esgotado ao conectar')), 12000);
        net.connect(room);
      });
      this.startMode('online', { welcome });
    } catch (e) {
      net.disconnect();
      this.ui.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="width:560px"><h1>Falha ao entrar</h1><div class="desc">${String(e.message).replace(/</g, '&lt;')}</div><div class="btns"><button class="btn primary" data-nav data-action="online">Voltar</button></div></div></div>`, { back: () => this.ui.onlineHub() });
    }
  }

  ensureEngines() {
    for (const c of this.cars) if (!c.engine && !c.ghost) {
      c.engine = this.audio.createEngine({ spatial: !c.isPlayer, volume: c.isPlayer ? 1 : 0.8 });
      c.veh.onShift = () => { c.engine && c.engine.shift(); };
    }
  }
  removeCar(car) { car.dispose(); this.cars = this.cars.filter(c => c !== car); }

  _parkedCars() {
    const n = this.save.s.quality === 'low' ? 1 : 3;
    const cols = ['#1e3fae', '#f4f4f4', '#7a1fa2', '#f2c200'];
    this.parked = [];
    for (let k = 0; k < n; k++) {
      const sp = this.world.parkingSpots[k * 2];
      const v = new CarVisual(this.carTpl, { color: cols[k], lod: true, headlights: false, castShadow: false });
      v.root.position.set(sp.x, 0, sp.z); v.root.rotation.y = sp.heading;
      v.setLights({ head: false, brake: 0, night: true });
      this.scene.add(v.root); this.parked.push(v);
      // static collision box
      const hw = 0.95, hl = 2.3, sh = Math.sin(sp.heading), ch = Math.cos(sp.heading);
      const P = [[hw, hl], [-hw, hl], [-hw, -hl], [hw, -hl]].map(([l, f]) => [sp.x + l * ch + f * sh, sp.z - l * sh + f * ch]);
      for (let i = 0; i < 4; i++) {
        const a = P[i], b = P[(i + 1) % 4];
        const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        // outward normal (polygon is clockwise in x/z) — choose the one pointing away from centre
        let nx = ez / L, nz = -ex / L;
        const mx = (a[0] + b[0]) / 2 - sp.x, mz = (a[1] + b[1]) / 2 - sp.z; if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
        this.world.segments.push({ ax: a[0], az: a[1], bx: b[0], bz: b[1], nx, nz, type: 'wall' });
      }
    }
    this.world._buildSegmentGrid();
  }

  _placeMenuCar() {
    // parked in front of the lit pit garages
    this.player.place(18, 286, -Math.PI / 2 + 0.35);
  }

  respawnOnTrack(car) {
    const t = this.world.track;
    const P = PLAZA, x = car.veh.x, z = car.veh.z;
    const pk = this.world.park;
    if (pk && (pk.contains(x, z) || pk.onRoad(x, z))) {
      if (pk.isAsphalt(x, z) && !pk.isWall(x, z)) { car.place(x, z, car.veh.heading); return; }
      const sp = pk.nearestSpawn(x, z); car.place(sp.x, sp.z, sp.h); return;
    }
    if (x > P.x0 && x < P.x1 && z > P.z0 && z < P.z1) { car.place(x, z, car.veh.heading); return; }
    const pr = t.project(x, z, car.hint);
    const p = t.pointAt(pr.s, Math.max(-pr.hw + 2, Math.min(pr.hw - 2, pr.lat * 0.5)));
    car.place(p.x, p.z, Math.atan2(p.tx, p.tz));
  }

  // ------------------------------------------------------------ settings
  applySettings() {
    const s = this.save.s;
    if (this.renderer) {
      if (this.renderer.quality !== s.quality || this.renderer.resScale !== s.resScale) {
        const shadowChange = QUALITY[this.renderer.quality].shadows !== QUALITY[s.quality].shadows;
        this.renderer.setQuality(s.quality, s.resScale);
        if (shadowChange) [this.scene, this.garageScene].forEach(sc => sc && sc.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }));
      }
      this.renderer.motionBlur = s.motionBlur;
      const Q = QUALITY[s.quality];
      this.env && this.env.setShadowQuality(Q.shadowSize, Q.shadows);
      if (this.effects) { this.effects.smoke.setMax(Q.particles); this.effects.smokeScale = s.quality === 'low' ? 0.5 : 1; }
      if (this.env && this.env.envOn !== Q.envMap) { this.env.envOn = Q.envMap; this.env.buildEnvMap(Q.envMap); }
    }
    if (this.rig) { this.rig.baseFov = s.fov; }
    if (this.player) {
      const v = this.player.veh; v.tcs = s.tcs; v.abs = s.abs; v.steerAssist = s.steerAssist; v.driftAssist = s.driftAssist; v.autoGear = s.autoGear;
    }
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    if (this.env && this.env.timeKey !== s.time) this.applyTime(s.time);
  }
  setTime(t) { this.save.s.time = t; this.applyTime(t); this.save.save(); }
  applyTime(t) {
    const Q = QUALITY[this.save.s.quality];
    this.env.envOn = Q.envMap;
    this.env.apply(t, Q.envMap);
    this.world.isNight(TIMES[t].night);
    this.world.setHaze(new THREE.Color(TIMES[t].night ? 0x1a2236 : t === 'sunset' ? 0xd9a07a : 0xa9c0d6), TIMES[t].night ? 0.7 : t === 'sunset' ? 0.45 : 0.32);
    if (this.renderer) this.renderer.setBloom(TIMES[t].bloom[0], TIMES[t].bloom[1]);
    this.lampLights && this.lampLights.forEach(l => { if (!TIMES[t].night) l.intensity = 0; });
  }

  // ------------------------------------------------------------ menus / state
  toMenu(tab) {
    this.state = 'menu';
    this.ui.hideHud();
    this.menuOrbit.detach();
    this._placeMenuCar();
    this.audio.startMusic('menu'); this.audio.duckMusic(1);
    this.player.engine && this.player.engine.silence();
    this.effects.smoke.clear(); this.effects.sparks.clear();
    this.ui.mainMenu(tab);
  }

  startMode(type, opts = {}) {
    const Cls = MODE_CLASSES[type]; if (!Cls) return;
    this.audio.init(); this.ensureEngines();
    this.menuOrbit.detach();
    if (this.mode) { this.mode.dispose(); this.mode = null; }
    this.lastStart = { type, opts };
    if (opts.time && opts.time !== this.save.s.time) this.setTime(opts.time);
    this.effects.skid.clear(); this.effects.smoke.clear(); this.effects.sparks.clear();
    this.world.resetProps(); this.world.setStartLights(0);
    this.applySettings();
    this.renderer.buildComposer(this.scene, this.camera);
    this.ui.buildHud();
    this.mode = new Cls(this, opts);
    this.mode.start();
    this.rig.snap(this.player);
    this.state = 'playing';
    this.sessionStart = performance.now();
    if (this.save.s.raceMusic) { this.audio.startMusic('race'); this.audio.duckMusic(0.55); } else this.audio.stopMusic();
    this.ui.toast(`Câmera: ${CAM_LABELS[this.rig.mode]}  •  C troca  •  ESC pausa`, 2500);
  }
  restart() { const ls = this.lastStart; if (ls) this.startMode(ls.type, ls.opts); }
  retry() { this.restart(); }
  pause() { if (this.state !== 'playing') return; this.state = 'paused'; this.ui.pauseMenu(); this.player.engine && this.player.engine.silence(); this.cars.forEach(c => c.engine && c.engine.silence()); this.audio.duckMusic(0.3); }
  resume() { if (this.state !== 'paused') return; this.ui.clearScreen(); this.state = 'playing'; this.input.pressed.clear(); this.input.keys.delete('Escape'); this.clock.getDelta(); this.audio.duckMusic(this.save.s.raceMusic ? 0.55 : 0); }
  quitToMenu() {
    if (this.mode && this.mode.key === 'online') { this.net.disconnect(); this.mode.dispose(); this.mode = null; this.save.save(); this.toMenu('online'); return; }
    if (this.mode && this.state === 'paused' && !this._finishing) {
      // finishing a free-drift session still records the result
      if (this.mode.key === 'free' && this.mode.scorer && this.mode.scorer.total + this.mode.scorer.chain > 0) { this.state = 'playing'; this.endMode(); return; }
    }
    if (this.mode) { this.mode.dispose(); this.mode = null; }
    this.cars.filter(c => c !== this.player).forEach(c => this.removeCar(c));
    this.save.save();
    this.toMenu();
  }

  endMode() {
    if (!this.mode) return;
    this._finishing = true;
    const r = this.mode.finish();
    const d = this.save.data;
    // stats & ranking
    if (this.mode.scorer) {
      d.stats.totalScore += this.mode.scorer.total;
      d.stats.bestChain = Math.max(d.stats.bestChain, this.mode.scorer.bestChain);
      d.stats.maxAngle = Math.max(d.stats.maxAngle, this.mode.scorer.maxAngle);
      d.stats.driftDistance += this.mode.scorer.distanceDrifting;
    }
    if (r.mode === 'free') d.stats.bestFree = Math.max(d.stats.bestFree, r.score);
    if (r.rankingMode) r.rankPos = this.save.addRanking(r.rankingMode, r.rankScore, r.rankExtra || {}, r.lowerIsBetter);
    const summary = r.mode === 'race' || r.mode === 'timeattack' ? fmtTime(r.score) : r.mode === 'battle' ? `${r.score} pts` : `${Math.round(r.score || 0).toLocaleString('pt-BR')}${r.medal ? ' • ' + ['', 'Bronze', 'Prata', 'Ouro'][r.medal] : ''}`;
    this.save.addHistory({ title: r.title, mode: r.mode, summary });
    this.save.save();
    this.state = 'results';
    this.cars.forEach(c => c.engine && c.engine.silence());
    this.ui.hideHud();
    this.ui.results(r);
    this._finishing = false;
  }

  // ------------------------------------------------------------ showroom (garage + car select)
  _showroomBackground() {
    // teal gradient with the festival triangle pattern (matches the menu theme)
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#5fd0bb'); gr.addColorStop(0.55, '#2f9b93'); gr.addColorStop(1, '#17605e');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
    const W = 120, H = 104;
    for (let y = -1; y < 6; y++) for (let x = -1; x < 10; x++) {
      for (const up of [0, 1]) {
        const ox = x * W + (y % 2 ? W / 2 : 0) + (up ? W / 2 : 0);
        g.fillStyle = `rgba(255,255,255,${0.015 + ((x * 7 + y * 13 + up * 5) % 5) * 0.012})`;
        g.beginPath();
        if (up) { g.moveTo(ox - W / 2, y * H + H); g.lineTo(ox + W / 2, y * H + H); g.lineTo(ox, y * H); }
        else { g.moveTo(ox - W / 2, y * H); g.lineTo(ox + W / 2, y * H); g.lineTo(ox, y * H + H); }
        g.fill();
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  _buildGarage() {
    const gs = new THREE.Scene();
    gs.background = this._showroomBackground();
    const pm = new THREE.PMREMGenerator(this.renderer.renderer);
    gs.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    gs.environmentIntensity = 0.9;
    // stand / podium
    const stand = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.75, 0.32, 96), new THREE.MeshStandardMaterial({ color: 0x14403e, roughness: 0.35, metalness: 0.5 }));
    base.position.y = 0.16; base.receiveShadow = true; base.castShadow = true; stand.add(base);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(3.42, 3.42, 0.04, 96), new THREE.MeshStandardMaterial({ color: 0xe9f1ef, roughness: 0.25, metalness: 0.1 }));
    top.position.y = 0.34; top.receiveShadow = true; stand.add(top);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.045, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 1, 0).multiplyScalar(1.6) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.33; stand.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.75, 0.03, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.63).multiplyScalar(1.4) }));
    ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.02; stand.add(ring2);
    gs.add(stand);
    this.turntable = new THREE.Group(); this.turntable.position.y = 0.36; gs.add(this.turntable);
    // soft floor that fades into the background
    const fc = document.createElement('canvas'); fc.width = fc.height = 256; const fg = fc.getContext('2d');
    const rg = fg.createRadialGradient(128, 128, 10, 128, 128, 128); rg.addColorStop(0, 'rgba(10,50,48,0.85)'); rg.addColorStop(0.6, 'rgba(20,80,76,0.35)'); rg.addColorStop(1, 'rgba(20,80,76,0)');
    fg.fillStyle = rg; fg.fillRect(0, 0, 256, 256);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001; gs.add(floor);
    const key = new THREE.SpotLight(0xffffff, 420, 30, 0.6, 0.5, 1.5); key.position.set(4, 9, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; gs.add(key);
    const rim = new THREE.SpotLight(0xff3fb0, 160, 30, 0.7, 0.6, 1.5); rim.position.set(-6, 3, -6); gs.add(rim);
    const fill = new THREE.SpotLight(0xccff66, 110, 30, 0.7, 0.6, 1.5); fill.position.set(-5, 4, 6); gs.add(fill);
    gs.add(new THREE.HemisphereLight(0xc8fff0, 0x204040, 0.9));
    this.garageScene = gs;
    this.garageCam = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 200);
    this.garageOrbit = new OrbitCam(this.garageCam, new THREE.Vector3(0, 0.85, 0));
    this.garageOrbit.radius = 8.2; this.garageOrbit.phi = 1.33;
    this.setShowroomCar(this.carTpl, this.save.data.car);
    this.thumbs = {};
  }

  setShowroomCar(tpl, cfg) {
    if (this.garageCar) { this.garageCar.root.removeFromParent(); }
    this.garageCar = new CarVisual(tpl, { color: cfg.color, finish: cfg.finish, rimColor: cfg.rim, headlights: false });
    this.garageCar.setLights({ head: true, brake: 0, night: false });
    this.garageCar.root.position.y = (cfg.tune && cfg.tune.rideHeight) || 0;
    this.turntable.add(this.garageCar.root);
    this.showroomCarId = tpl.carId || cfg.id;
  }

  // small transparent render of a car for the menus (cached per car + colour)
  carThumb(id) {
    const cfg = this.carConfig(id);
    const key = id + cfg.color + cfg.finish + cfg.rim;
    if (this.thumbs[key]) return this.thumbs[key];
    const tpl = this.tpls[id]; if (!tpl) return '';
    const W = 512, H = 256;
    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
    const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 100);
    cam.position.set(6.6, 2.2, 8.2); cam.lookAt(0, 0.62, 0);
    const v = new CarVisual(tpl, { color: cfg.color, finish: cfg.finish, rimColor: cfg.rim, headlights: false, castShadow: false });
    v.setLights({ head: true, brake: 0, night: false });
    const sc = new THREE.Scene(); sc.environment = this.garageScene.environment; sc.environmentIntensity = 1;
    sc.add(new THREE.HemisphereLight(0xffffff, 0x445555, 1.4)); const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 6, 4); sc.add(dl);
    sc.add(v.root);
    const r = this.renderer.renderer; const prevT = r.getRenderTarget(); const prevC = r.getClearAlpha(); const prevExp = r.toneMappingExposure;
    r.setRenderTarget(rt); r.setClearColor(0x000000, 0); r.toneMappingExposure = 0.9; r.clear(); r.render(sc, cam);
    const px = new Uint8Array(W * H * 4); r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    r.setRenderTarget(prevT); r.setClearAlpha(prevC); r.toneMappingExposure = prevExp;
    rt.dispose(); v.root.removeFromParent();
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    // render target is linear: apply sRGB-ish gamma for display
    const d = img.data; for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; if (!a) continue; for (let k = 0; k < 3; k++) d[i + k] = Math.min(255, Math.pow(d[i + k] / 255, 1 / 2.2) * 255); }
    g.putImageData(img, 0, 0);
    return (this.thumbs[key] = c.toDataURL('image/png'));
  }

  _enterShowroom() {
    this.menuOrbit.detach();
    this.renderer.buildComposer(this.garageScene, this.garageCam);
    this.renderer.setBloom(0.25, 0.95);
    this.renderer.renderer.toneMappingExposure = 0.85;
    this.garageOrbit.attach(this.renderer.renderer.domElement);
    this.garageOrbit.auto = true;
  }
  _leaveShowroom() { this.garageOrbit.detach(); this.applyTime(this.save.s.time); }

  openGarage(tab = 'paint') {
    this.state = 'garage';
    if (this.showroomCarId !== this.save.data.car.id) this.setShowroomCar(this.carTpl, this.save.data.car);
    this.garageTune = { ...DEFAULT_TUNE, ...(this.save.data.car.tune || {}) };
    this._enterShowroom();
    this.ui.garage(tab);
  }
  closeGarage() {
    this.save.data.car.tune = { ...this.garageTune };
    this.save.save();
    this.player.applyTune(this.garageTune);
    this._leaveShowroom();
    this.toMenu('cars');
  }

  // ---------------- car selection
  openCarSelect() {
    this.state = 'carselect';
    this.csIndex = Math.max(0, CARS.findIndex(c => c.id === this.save.data.car.id));
    this._enterShowroom();
    this.garageOrbit.radius = 11.5; this.garageOrbit.phi = 1.36; this.garageOrbit.target.set(0, 1.0, 0);
    this.ui.carSelect(this.csIndex);
    this.previewCar(CARS[this.csIndex].id);
    // preload every car so the list shows thumbnails
    CARS.forEach(c => this.getTpl(c.id).then(() => this.state === 'carselect' && this.ui.refreshCarCards && this.ui.refreshCarCards()).catch(() => { }));
  }
  async previewCar(id) {
    this._previewId = id;
    if (this.showroomCarId === id) return;
    this.ui.carLoading && this.ui.carLoading(true);
    try {
      const tpl = await this.getTpl(id);
      if (this._previewId !== id || this.state !== 'carselect') return;
      this.setShowroomCar(tpl, this.carConfig(id));
      this.audio.ui('move');
    } catch (e) { this.ui.toast('Falha ao carregar ' + carById(id).short + ': ' + e.message, 4000); }
    this.ui.carLoading && this.ui.carLoading(false);
  }
  async selectCar(id) {
    const d = this.save.data;
    if (id !== d.car.id) {
      const tpl = await this.getTpl(id);
      d.carConfigs = d.carConfigs || {};
      d.carConfigs[d.car.id] = { ...d.car };
      d.car = { ...this.carConfig(id), id };
      this.carTpl = tpl;
      // rebuild the player car with the new model + physics
      const old = this.player; this.player = this._spawnPlayer();
      this.removeCar(old);
      this._placeMenuCar();
      this.save.save();
      this.ui.toast(`${carById(id).make} ${carById(id).short} selecionado`, 2200);
    }
    this.closeCarSelect();
  }
  closeCarSelect() { this._leaveShowroom(); this.toMenu('cars'); }

  setPaint(p) {
    const c = this.save.data.car; Object.assign(c, p);
    if (p.color) { this.garageCar.setColor(p.color); this.player.visual.setColor(p.color); }
    if (p.rim) { this.garageCar.setRimColor(p.rim); this.player.visual.setRimColor(p.rim); }
    if (p.finish) { this.garageCar.setFinish(p.finish); this.player.visual.setFinish(p.finish); }
    if (p.smoke) this.player.smokeColor = hexToRgb(p.smoke);
    this.save.save();
  }
  updateGarageTune() { this.garageCar.root.position.y = this.garageTune.rideHeight; }
  resetTune() { this.garageTune = { ...DEFAULT_TUNE }; this.updateGarageTune(); }

  // ------------------------------------------------------------ events
  handleScoreEvents(scorer) {
    for (const e of scorer.takeEvents()) {
      if (e.type === 'bank') { this.ui.popup(`+${e.points.toLocaleString('pt-BR')}`, 'bank'); this.ui.chainState('bank'); this.audio.ui('score'); }
      else if (e.type === 'fail') { this.ui.popup(`${e.reason}  −${e.lost.toLocaleString('pt-BR')}`, 'fail'); this.ui.chainState('fail'); this.audio.ui('fail'); }
      else if (e.type === 'zone') this.ui.popup(e.points ? `${e.kind} +${e.points}` : e.kind, 'zone');
      else if (e.type === 'mult') this.ui.popup(`COMBO x${e.value}`, 'mult');
      else if (e.type === 'transition') this.ui.popup('TRANSIÇÃO', 'zone');
    }
  }
  onImpact(car, e) {
    if (car === this.player) {
      this.rig.addShake(Math.min(1, e.strength / 12));
      if (e.strength > 5) this.save.data.stats.crashes++;
    }
    this.mode && this.mode.onImpact(car, e);
  }

  // ------------------------------------------------------------ loop
  loop(ts) {
    requestAnimationFrame(t => this.loop(t));
    // frame pacing: use the vsync timestamp from requestAnimationFrame (not a fresh timer read, which
    // jitters by the time the browser spent before calling us) and smooth tiny variations, so motion
    // advances in even steps that match what the display shows
    const now = ts ?? performance.now();
    const limit = this.save.s.fpsLimit;
    if (limit) {
      const step = 1000 / limit;
      this._budget = (this._budget || 0) + (this._lastTs ? now - this._lastTs : step);
      this._lastTs = now;
      if (this._budget < step - 1) return;
      this._budget = Math.min(this._budget - step, step);
    } else this._lastTs = now;
    let raw = this._lastFrame ? (now - this._lastFrame) / 1000 : 1 / 60;
    this._lastFrame = now;
    if (!(raw > 0)) raw = 1 / 60;
    // smoothing: average of recent frame times, reset on real hitches so the game never runs in slow motion
    const hist = this._dtHist || (this._dtHist = []);
    const avg = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : raw;
    if (Math.abs(raw - avg) > avg * 0.5) hist.length = 0;
    hist.push(raw); if (hist.length > 6) hist.shift();
    let dt = Math.min(1 / 20, hist.reduce((a, b) => a + b, 0) / hist.length);
    this.clock.getDelta();
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = this._fpsN / this._fpsAcc; this._fpsAcc = 0; this._fpsN = 0; }
    try { this.update(dt); } catch (e) { console.error(e); this._errCount = (this._errCount || 0) + 1; if (this._errCount < 5) this.ui.toast('Erro: ' + e.message, 4000); }
    this.input.endFrame();
  }

  update(dt) {
    if (this.nature) this.nature.update(dt);
    if (this.state === 'title') { const p = this.input.pad(); if (p && p.buttons.some(b => b.pressed)) this._startFromTitle(); }
    this.ui.pollPad();
    if (this.state === 'garage' || this.state === 'carselect') {
      this.garageOrbit.update(dt);
      this.renderer.render(this.garageScene, this.garageCam);
      return;
    }
    if (this.rig.enabled !== (this.state === 'playing')) this.rig.setEnabled(this.state === 'playing');
    // the festival menus are opaque: no need to render the circuit behind them
    if (this.state === 'menu' || this.state === 'results') return;
    if (this.state === 'playing') this.updatePlaying(dt);
    else {
      // menu backdrop: idle car with orbit cam
      if (this.state === 'title') {
        this.menuOrbit.update(dt);
        this.player.visual.update(this.player.veh, dt, this.player.tune.rideHeight);
        this.player.visual.setLights({ head: true, brake: 0, night: this.env.preset.night });
      }
      if (this.state === 'paused' && this.mode && this.mode.whilePaused) this.mode.whilePaused(dt);
      this.effects.smoke.update(dt, this.scene.fog); this.effects.sparks.update(dt, this.scene.fog);
      this._updateLamps(dt, this.camera.position.x, this.camera.position.z);
      this.env.follow(this.camera.position.x, this.camera.position.z);
      this.renderer.setSpeedBlur(0);
    }
    this.renderer.render(this.scene, this.camera);
  }

  updatePlaying(dt) {
    const inp = this.input;
    inp.update(dt);
    if (inp.pause) { this.pause(); return; }
    if (inp.camera) { const m = this.rig.cycle(); this.save.s.camera = m; this.ui.toast('Câmera: ' + CAM_LABELS[m], 1200); }
    if (inp.reset) { this.respawnOnTrack(this.player); this.rig.snap(this.player); this.mode.onRespawn && this.mode.onRespawn(); }
    if (inp.lights) this.player.lightsOn = !this.player.lightsOn;
    if (!this.player.veh.autoGear) { if (inp.shiftUp) this.player.veh.shiftUp(); if (inp.shiftDown) this.player.veh.shiftDown(); }

    this.player.update(dt, inp.state);
    this.mode.update(dt);
    // car-car collisions
    const active = this.cars.filter(c => !c.ghost);
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const hit = Car.collidePair(active[i], active[j]);
      if (hit && hit.strength > 1.5) {
        this.audio.impact(Math.min(1.2, hit.strength / 10), 'wall');
        if (active[i] === this.player || active[j] === this.player) { this.rig.addShake(Math.min(0.8, hit.strength / 14)); this.mode.onCarHit && this.mode.onCarHit(active[i], active[j], hit); }
      }
    }
    const coneHits = this.player.collideProps();
    if (coneHits && this.mode.onCone) this.mode.onCone(coneHits);
    for (const c of this.cars) if (c !== this.player && !c.ghost) c.collideProps();
    this.world.updateProps(dt);
    this.effects.smoke.update(dt, this.scene.fog);
    this.effects.sparks.update(dt, this.scene.fog);
    // camera (light vibration over the kerbs)
    if (this.player.veh.speed > 8 && this.player.veh.wheelSurface.includes('curb')) this.rig.addShake(0.015);
    this.rig.update(this.player, dt, inp.lookBack, this.world);
    const v = this.player.veh;
    this.env.follow(v.x, v.z);
    this._updateLamps(dt, v.x, v.z);
    this.renderer.setSpeedBlur(Math.min(0.7, Math.max(0, (v.speed - 28) / 50) * 0.6) + (v.nitroActive ? 0.35 : 0));
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, Math.sin(v.heading), Math.cos(v.heading));
    this.audio.setAmbient(this.env.preset.night ? 0.6 : 1, v.speed);
    // stats
    const st = this.save.data.stats;
    st.distance += v.speed * dt; st.playTime += dt; st.maxSpeed = Math.max(st.maxSpeed, v.speedKmh);
    // HUD
    const info = this.mode.hud();
    info.others = this.mode.mapOthers ? this.mode.mapOthers() : this.cars.filter(c => c !== this.player).map(c => ({ x: c.veh.x, z: c.veh.z, color: c.ghost ? '#00e5ff' : '#ffc940' }));
    this.ui.updateHud(dt, this.player, info, this.fps);
    if (this.mode.done) this.endMode();
  }

  _updateLamps(dt, x, z) {
    this._lampT -= dt;
    if (this._lampT > 0 || !this.env.preset.night) return;
    this._lampT = 0.4;
    const L = this.world.lampPositions.map(p => [p, (p.hx - x) ** 2 + (p.hz - z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, this.lampLights.length);
    L.forEach(([p, d2], k) => { const l = this.lampLights[k]; l.position.set(p.hx, p.hy - 0.5, p.hz); l.intensity = d2 < 140 * 140 ? 380 : 0; });
  }
}

function hexToRgb(h) { const n = parseInt((h || '#eeeeee').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
