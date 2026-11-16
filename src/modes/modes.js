// =====================================================================
//  Game modes: Free Drift, Drift Challenge, Drift Battle (tandem),
//  Race and Time Attack.
// =====================================================================
import { DriftScorer } from './scoring.js';
import { AIDriver, AI_LEVELS } from '../car/ai.js';
import { START_S, DONUT, PLAZA } from '../world/world.js';
import { PARK_SPAWNS } from '../world/driftPark.js';

export const CHALLENGES = [
  { id: 'c1', name: 'Primeiros Passos', desc: 'Some pontos de drift em qualquer lugar do circuito.', time: 60, targets: [8000, 16000, 28000], metric: 'total', spawn: 'track', tag: 'PONTUAÇÃO' },
  { id: 'c2', name: 'Rei do Donut', desc: 'Só vale dentro do DONUT ZONE do paddock. Mantenha velocidade!', time: 45, targets: [4000, 8000, 14000], metric: 'total', spawn: 'donut', donutOnly: true, minSpeed: 20, tag: 'DONUT' },
  { id: 'c3', name: 'Ângulo Extremo', desc: 'Apenas derrapagens acima de 35° pontuam.', time: 90, targets: [9000, 18000, 32000], metric: 'total', spawn: 'track', angleGate: 35, tag: 'ÂNGULO ≥ 35°' },
  { id: 'c4', name: 'Alta Velocidade', desc: 'Apenas drifts acima de 70 km/h pontuam.', time: 90, targets: [9000, 18000, 32000], metric: 'total', spawn: 'track', speedGate: 70, tag: 'VEL. ≥ 70 KM/H' },
  { id: 'c5', name: 'Combo Master', desc: 'Faça a maior sequência única possível sem quebrar o combo.', time: 120, targets: [8000, 16000, 30000], metric: 'bestChain', spawn: 'track', tag: 'COMBO' },
  { id: 'c6', name: 'Volta Limpa', desc: 'Complete uma volta somando pontos. Batidas quebram o combo.', time: 200, targets: [20000, 40000, 70000], metric: 'total', spawn: 'grid', lap: true, tag: '1 VOLTA' },
  { id: 'c7', name: 'Mestre das Zonas', desc: 'Passe derrapando pelas zonas de clipping (postes azuis) em uma volta.', time: 200, targets: [6, 12, 20], metric: 'zones', spawn: 'grid', lap: true, tag: 'ZONAS', unit: 'zonas' },
  { id: 'c9', name: 'Gymkhana do Paddock', desc: 'Drift livre só dentro do paddock: contorne os cones do slalom e o donut. Oito, transições e muros contam!', time: 75, targets: [7000, 14000, 24000], metric: 'total', spawn: 'plaza', plazaOnly: true, minSpeed: 22, tag: 'PADDOCK' },
  { id: 'c8', name: 'Lenda do Kaido', desc: 'Uma volta, só drifts acima de 20°. O desafio final.', time: 200, targets: [60000, 100000, 150000], metric: 'total', spawn: 'grid', lap: true, angleGate: 20, tag: 'LENDA' },
];
export const MEDAL_REWARD = [0, 500, 1000, 2000];

// ---------------------------------------------------------------------
export class LapTracker {
  constructor(track) { this.track = track; this.reset(); }
  reset(startS = START_S) {
    this.progress = 0; this.lastS = null; this.lap = 0; this.lapStart = 0; this.laps = []; this.wrongWay = 0; this.cp = 0; this.startS = startS; this.maxProgress = 0;
  }
  // returns 'lap' when a lap is completed
  update(s, time, dt, heading, tx, tz) {
    let ev = null;
    if (this.lastS === null) {
      // initial signed offset to the start line (grid slots are behind it)
      let d0 = s - this.startS; const L0 = this.track.length;
      if (d0 > L0 / 2) d0 -= L0; if (d0 < -L0 / 2) d0 += L0;
      this.progress = d0;
    } else {
      let d = s - this.lastS;
      if (d < -this.track.length / 2) d += this.track.length;
      if (d > this.track.length / 2) d -= this.track.length;
      if (Math.abs(d) < 30) this.progress += d;
    }
    this.lastS = s;
    this.maxProgress = Math.max(this.maxProgress, this.progress);
    // wrong way detection
    const fwd = Math.sin(heading) * tx + Math.cos(heading) * tz;
    if (fwd < -0.4) this.wrongWay += dt; else this.wrongWay = 0;
    const L = this.track.length;
    if (this.progress >= (this.lap + 1) * L) { this.lap++; this.laps.push(time - this.lapStart); this.lapStart = time; ev = 'lap'; }
    this.cp = Math.floor((this.progress - this.lap * L) / (L / 3));
    return ev;
  }
  get lapFraction() { return (this.progress - this.lap * this.track.length) / this.track.length; }
}

function fmtTime(t) { if (t == null || !isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }
export { fmtTime };

// ---------------------------------------------------------------------
class BaseMode {
  constructor(game, opts = {}) { this.game = game; this.opts = opts; this.time = 0; this.done = false; this.started = false; this.countdown = 0; this.ai = []; }
  get player() { return this.game.player; }
  gridPos(slot) {
    const t = this.game.world.track;
    const p = t.pointAt(START_S - 10 - slot * 9, slot % 2 ? -3.2 : 3.2);
    return { x: p.x, z: p.z, h: Math.atan2(p.tx, p.tz) };
  }
  startCountdown(sec = 3) { this.countdown = sec + 1; this.started = false; this.player.frozen = true; this.ai.forEach(a => a.car.frozen = true); this._lastCount = -1; }
  tickCountdown(dt) {
    if (this.started) return;
    this.countdown -= dt;
    const n = Math.ceil(this.countdown - 1);
    if (n !== this._lastCount) {
      this._lastCount = n;
      if (n >= 1 && n <= 3) { this.game.ui.centerMsg(String(n)); this.game.audio.ui('count'); this.game.world.setStartLights({ 3: 1, 2: 3, 1: 5 }[n]); }
      if (n === 0) { this.game.ui.centerMsg('GO!'); this.game.audio.ui('go'); this.game.world.setStartLights(0, true); }
    }
    if (this.countdown <= 1) { this.started = true; this.player.frozen = false; this.ai.forEach(a => a.car.frozen = false); this.onStart && this.onStart(); setTimeout(() => this.game.world.setStartLights(0), 2500); }
  }
  addAI(level, style, color, slot, name) {
    const car = this.game.spawnAICar({ color, name });
    const g = this.gridPos(slot);
    car.place(g.x, g.z, g.h);
    const ai = new AIDriver(this.game.world.track, this.game.world.racingLine, level, style);
    this.ai.push({ car, ai, name, lap: new LapTracker(this.game.world.track), finished: null });
    return this.ai[this.ai.length - 1];
  }
  updateAI(dt) {
    const cars = [this.player, ...this.ai.map(a => a.car)];
    for (const a of this.ai) {
      if (!this.started) { a.car.update(dt, { throttle: 0, brake: 1, steer: 0, handbrake: 1 }); continue; }
      const inp = a.ai.update(dt, a.car, cars);
      a.car.poseTarget = a.ai.style === 'drift' ? a.ai.driftTarget : undefined;
      a.car.update(dt, inp);
      // respawn if stuck for long
      if (a.ai.respawnTimer > 5 || (a.car.trackInfo && a.car.trackInfo.dist > a.car.trackInfo.hw + 25)) this.game.respawnOnTrack(a.car), a.ai.respawnTimer = 0;
    }
  }
  hud() { return {}; }
  onImpact() { }
  dispose() { this.ai.forEach(a => this.game.removeCar(a.car)); this.ai = []; }
}

// ---------------------------------------------------------------------
export class FreeDriftMode extends BaseMode {
  constructor(game, opts) { super(game, opts); this.name = 'DRIFT LIVRE'; this.key = 'free'; }
  start() {
    this.scorer = new DriftScorer();
    if (this.opts && this.opts.spawn === 'park') { const sp = PARK_SPAWNS[0]; this.player.place(sp.x, sp.z, sp.h); this.name = 'DRIFT PARK'; }
    else { const g = this.gridPos(0); this.player.place(g.x, g.z, g.h); }
    this.started = true;
    this.game.ui.centerMsg(this.name, true);
    this.game.ui.objective('W acelera • S freia • A/D direção • ESPAÇO freio de mão • F embreagem • SHIFT nitro • C câmera • R reposiciona • ESC pausa');
  }
  update(dt) {
    this.time += dt;
    this.scorer.update(dt, this.player, this.game.world);
    this.game.handleScoreEvents(this.scorer);
  }
  onImpact(car, e) { if (car === this.player) this.scorer.onImpact(e.strength); }
  hud() { return { score: this.scorer, boxes: [{ l: 'Tempo de sessão', v: fmtTime(this.time).slice(0, -4) }, { l: 'Recorde de sequência', v: Math.max(this.game.save.data.stats.bestChain, this.scorer.bestChain).toLocaleString('pt-BR') }] }; }
  finish() {
    const total = this.scorer.finish();
    return { mode: 'free', title: 'DRIFT LIVRE', score: total, lines: [['Pontuação da sessão', total.toLocaleString('pt-BR')], ['Melhor sequência', this.scorer.bestChain.toLocaleString('pt-BR')], ['Drifts', this.scorer.drifts], ['Ângulo máximo', this.scorer.maxAngle.toFixed(0) + '°'], ['Tempo', fmtTime(this.time)]], rankingMode: 'free', rankScore: total };
  }
}

// ---------------------------------------------------------------------
export class ChallengeMode extends BaseMode {
  constructor(game, opts) { super(game, opts); this.def = opts.def; this.name = this.def.name.toUpperCase(); this.key = 'challenge'; }
  start() {
    const d = this.def;
    this.scorer = new DriftScorer({ angleGate: d.angleGate || 0, speedGate: d.speedGate || 0, donutOnly: !!d.donutOnly, plazaOnly: !!d.plazaOnly, minSpeed: d.minSpeed || 30 });
    this.zones = 0;
    this.lap = new LapTracker(this.game.world.track);
    if (d.spawn === 'donut') this.player.place(DONUT.x - DONUT.r + 4, DONUT.z, 0);
    else if (d.spawn === 'plaza') this.player.place(-60, 250, Math.PI / 2);
    else if (d.spawn === 'grid') { const g = this.gridPos(0); this.player.place(g.x, g.z, g.h); }
    else { const t = this.game.world.track; const p = t.pointAt(START_S + 60); this.player.place(p.x, p.z, Math.atan2(p.tx, p.tz)); }
    this.remaining = d.time;
    this.startCountdown(3);
    this.game.ui.objective(`${d.desc}  •  Bronze ${this.fmt(d.targets[0])} / Prata ${this.fmt(d.targets[1])} / Ouro ${this.fmt(d.targets[2])}`);
  }
  fmt(v) { return this.def.unit ? `${v} ${this.def.unit}` : v.toLocaleString('pt-BR'); }
  metric() { const m = this.def.metric; return m === 'bestChain' ? Math.max(this.scorer.bestChain, Math.round(this.scorer.chain * this.scorer.mult)) : m === 'zones' ? this.zones : this.scorer.total + (m === 'total' ? Math.round(this.scorer.chain * this.scorer.mult) : 0); }
  update(dt) {
    this.tickCountdown(dt);
    if (!this.started) return;
    this.time += dt; this.remaining -= dt;
    this.scorer.update(dt, this.player, this.game.world);
    for (const e of this.scorer.events) if (e.type === 'zone' && /ZONA/.test(e.kind)) this.zones++;
    this.game.handleScoreEvents(this.scorer);
    const v = this.player.veh, ti = this.player.trackInfo;
    const ev = this.lap.update(ti.s, this.time, dt, v.heading, this.game.world.track.tx[ti.i], this.game.world.track.tz[ti.i]);
    if ((this.def.lap && ev === 'lap') || this.remaining <= 0) this.done = true;
  }
  onImpact(car, e) { if (car === this.player) this.scorer.onImpact(e.strength); }
  hud() {
    const m = this.metric(), T = this.def.targets;
    const next = T.find(t => m < t);
    const boxes = [{ l: 'Tempo restante', v: Math.max(0, this.remaining).toFixed(1) + '<small>s</small>' }, { l: this.def.metric === 'zones' ? 'Zonas' : this.def.metric === 'bestChain' ? 'Melhor sequência' : 'Pontos', v: this.fmt(m) }];
    if (next) boxes.push({ l: 'Próxima medalha', v: this.fmt(next) });
    if (this.def.lap) boxes.push({ l: 'Volta', v: (this.lap.lapFraction * 100).toFixed(0) + '<small>%</small>' });
    return { score: this.scorer, boxes };
  }
  finish() {
    this.scorer.finish();
    const m = this.metric(), T = this.def.targets;
    const medal = m >= T[2] ? 3 : m >= T[1] ? 2 : m >= T[0] ? 1 : 0;
    const rec = this.game.save.data.challenges[this.def.id] || { medal: 0, best: 0 };
    const newBest = m > rec.best;
    let reward = 0;
    if (medal > rec.medal) { for (let k = rec.medal + 1; k <= medal; k++) reward += MEDAL_REWARD[k]; }
    this.game.save.data.challenges[this.def.id] = { medal: Math.max(medal, rec.medal), best: Math.max(m, rec.best) };
    this.game.save.data.credits += reward;
    return { mode: 'challenge', title: this.def.name, score: m, medal, reward, newRecord: newBest && m > 0, lines: [['Resultado', this.fmt(m)], ['Bronze / Prata / Ouro', T.map(t => this.fmt(t)).join(' / ')], ['Melhor anterior', this.fmt(rec.best)], ['Créditos ganhos', reward.toLocaleString('pt-BR')]], rankingMode: 'challenge', rankScore: m, rankExtra: { name: this.def.name }, retry: { type: 'challenge', def: this.def } };
  }
}

// ---------------------------------------------------------------------
export class RaceMode extends BaseMode {
  constructor(game, opts) { super(game, opts); this.name = 'CORRIDA'; this.key = 'race'; this.laps = opts.laps || 3; this.level = opts.level || 'normal'; this.opponents = opts.opponents ?? 3; }
  start() {
    const names = ['Kenji "Ryu" Takeda', 'Aiko Mori', 'Daichi Sato', 'Yuna Kobayashi', 'Haruto Ito'];
    const colors = ['#f2f2f2', '#1f4fd1', '#f5c400', '#1b1b1b', '#00a86b'];
    const slots = [];
    const playerSlot = this.opponents; // start at the back
    for (let k = 0; k < this.opponents; k++) this.addAI(this.level, 'race', colors[k], k, names[k]);
    // vary AI pace slightly
    this.ai.forEach((a, k) => { a.ai.speedScale = 0.97 + k * 0.012 + Math.random() * 0.02; });
    const g = this.gridPos(playerSlot);
    this.player.place(g.x, g.z, g.h);
    this.lap = new LapTracker(this.game.world.track);
    this.ai.forEach(a => a.lap.reset());
    this.startCountdown(3);
    this.finishOrder = [];
    this.game.ui.objective(`${this.laps} voltas • Dificuldade ${AI_LEVELS[this.level].label}`);
  }
  update(dt) {
    this.tickCountdown(dt);
    this.updateAI(dt);
    if (!this.started) return;
    this.time += dt;
    const t = this.game.world.track;
    const v = this.player.veh, ti = this.player.trackInfo;
    const ev = this.lap.update(ti.s, this.time, dt, v.heading, t.tx[ti.i], t.tz[ti.i]);
    if (ev === 'lap') {
      const lt = this.lap.laps[this.lap.laps.length - 1];
      this.game.ui.popup(`VOLTA ${this.lap.lap}: ${fmtTime(lt)}`, 'zone');
      if (this.lap.lap === this.laps - 1) this.game.ui.centerMsg('ÚLTIMA VOLTA', true);
      if (this.lap.lap >= this.laps) { this.finishOrder.push({ name: 'VOCÊ', time: this.time, player: true }); this.done = true; }
    }
    for (const a of this.ai) {
      const ai = a.car.trackInfo; if (!ai) continue;
      const e2 = a.lap.update(ai.s, this.time, dt, a.car.veh.heading, t.tx[ai.i], t.tz[ai.i]);
      if (e2 === 'lap' && a.lap.lap >= this.laps && !a.finished) { a.finished = this.time; this.finishOrder.push({ name: a.name, time: this.time }); }
    }
    if (this.lap.wrongWay > 1.5) this.game.ui.warn('CONTRAMÃO'); else this.game.ui.warn(null);
  }
  standings() {
    const L = this.game.world.track.length;
    const list = [{ name: 'VOCÊ', prog: this.lap.progress, me: true, fin: this.done ? this.time : null }, ...this.ai.map(a => ({ name: a.name, prog: a.lap.progress, fin: a.finished }))];
    list.sort((a, b) => (a.fin && b.fin) ? a.fin - b.fin : a.fin ? -1 : b.fin ? 1 : b.prog - a.prog);
    return list;
  }
  hud() {
    const st = this.standings();
    const pos = st.findIndex(s => s.me) + 1;
    const cur = this.time - this.lap.lapStart;
    const best = this.lap.laps.length ? Math.min(...this.lap.laps) : null;
    return { boxes: [{ l: 'Posição', v: `${pos}<small>/${st.length}</small>`, cls: 'pos' }, { l: 'Volta', v: `${Math.min(this.laps, this.lap.lap + 1)}<small>/${this.laps}</small>` }, { l: 'Tempo da volta', v: fmtTime(cur) }, { l: 'Melhor volta', v: fmtTime(best) }], standings: st.map(s => ({ name: s.name, me: s.me })) };
  }
  finish() {
    const st = this.standings();
    // estimate unfinished AI times by their average speed
    const L = this.game.world.track.length;
    const rows = st.map((s, i) => {
      let time = s.fin;
      if (!time) { const remaining = this.laps * L - s.prog; time = this.time + Math.max(0, remaining) / Math.max(10, s.prog / Math.max(1, this.time)); }
      return { pos: i + 1, name: s.name, time, me: s.me };
    });
    rows.sort((a, b) => a.time - b.time).forEach((r, i) => r.pos = i + 1);
    const me = rows.find(r => r.me);
    const st2 = this.game.save.data.stats; st2.races++; if (me.pos === 1) st2.wins++;
    const reward = [0, 1500, 900, 500, 250, 100][me.pos] || 50;
    this.game.save.data.credits += reward;
    const best = Math.min(...this.lap.laps);
    return { mode: 'race', title: me.pos === 1 ? 'VITÓRIA!' : `${me.pos}º LUGAR`, score: me.time, table: rows, lines: [['Tempo total', fmtTime(me.time)], ['Melhor volta', fmtTime(best)], ['Créditos', '+' + reward]], rankingMode: 'race', rankScore: +me.time.toFixed(3), lowerIsBetter: true, retry: { type: 'race', opts: this.opts } };
  }
}

// ---------------------------------------------------------------------
export class TimeAttackMode extends BaseMode {
  constructor(game, opts) { super(game, opts); this.name = 'TIME ATTACK'; this.key = 'timeattack'; }
  start() {
    const g = this.gridPos(0);
    this.player.place(g.x, g.z, g.h);
    this.lap = new LapTracker(this.game.world.track);
    this.rec = this.game.save.data.records;
    this.best = this.rec.timeAttack;
    this.sectorBest = this.rec.timeAttackSectors || [null, null, null];
    this.sectors = []; this.lastCp = 0; this.sectorStart = 0;
    this.record = [];  // ghost recording for current lap
    this.recT = 0;
    this.ghostData = this.rec.ghost;
    this.ghost = this.ghostData ? this.game.spawnGhost() : null;
    this.lapsDone = [];
    this.startCountdown(3);
    this.game.ui.objective('Complete voltas no menor tempo possível • Fantasma da melhor volta');
  }
  onStart() { this.lap.lapStart = this.time; }
  update(dt) {
    this.tickCountdown(dt);
    if (!this.started) return;
    this.time += dt;
    const t = this.game.world.track, v = this.player.veh, ti = this.player.trackInfo;
    const lapT = this.time - this.lap.lapStart;
    // ghost recording
    this.recT += dt;
    if (this.recT >= 0.05) { this.recT = 0; this.record.push([+(lapT.toFixed(3)), +v.x.toFixed(2), +v.z.toFixed(2), +v.heading.toFixed(3)]); }
    // ghost playback
    if (this.ghost && this.ghostData) {
      const gd = this.ghostData; let k = Math.min(gd.length - 2, Math.max(0, Math.floor(lapT / 0.05)));
      while (k < gd.length - 2 && gd[k + 1][0] < lapT) k++;
      const a = gd[k], b = gd[k + 1]; const f = Math.max(0, Math.min(1, (lapT - a[0]) / Math.max(1e-3, b[0] - a[0])));
      let dh = b[3] - a[3]; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
      this.ghost.veh.x = a[1] + (b[1] - a[1]) * f; this.ghost.veh.z = a[2] + (b[2] - a[2]) * f; this.ghost.veh.heading = a[3] + dh * f;
      this.ghost.visual.root.position.set(this.ghost.veh.x, 0, this.ghost.veh.z); this.ghost.visual.root.rotation.y = this.ghost.veh.heading;
      this.ghost.visual.root.visible = lapT < gd[gd.length - 1][0];
    }
    const ev = this.lap.update(ti.s, this.time, dt, v.heading, t.tx[ti.i], t.tz[ti.i]);
    // sectors
    if (this.lap.cp !== this.lastCp && this.lap.cp > this.lastCp) {
      const st = this.time - this.sectorStart; this.sectorStart = this.time;
      this.showSector(this.lastCp, st); this.lastCp = this.lap.cp;
    }
    if (ev === 'lap') {
      const lt = this.lap.laps[this.lap.laps.length - 1];
      const st = this.time - this.sectorStart; this.sectorStart = this.time; this.showSector(2, st); this.lastCp = 0;
      this.lapsDone.push(lt);
      const isBest = !this.best || lt < this.best;
      if (isBest) {
        this.best = lt; this.rec.timeAttack = lt; this.rec.ghost = this.record; this.ghostData = this.record;
        if (!this.ghost) this.ghost = this.game.spawnGhost();
        this.game.ui.centerMsg('NOVO RECORDE!', true); this.game.audio.ui('medal');
        this.game.save.save();
      } else this.game.ui.popup(`VOLTA ${fmtTime(lt)}  (+${(lt - this.best).toFixed(3)})`, 'fail');
      this.record = [];
    }
    if (this.lap.wrongWay > 1.5) this.game.ui.warn('CONTRAMÃO'); else this.game.ui.warn(null);
  }
  showSector(i, t) {
    const b = this.sectorBest[i];
    if (b == null || t < b) { this.sectorBest[i] = t; this.rec.timeAttackSectors = this.sectorBest; }
    const d = b == null ? null : t - b;
    this.game.ui.popup(`SETOR ${i + 1}  ${t.toFixed(3)}${d == null ? '' : `  (${d <= 0 ? '' : '+'}${d.toFixed(3)})`}`, d == null || d <= 0 ? 'bank' : 'fail');
  }
  hud() {
    const cur = this.started ? this.time - this.lap.lapStart : 0;
    return { boxes: [{ l: 'Volta atual', v: fmtTime(cur) }, { l: 'Recorde', v: fmtTime(this.best) }, { l: 'Última', v: fmtTime(this.lapsDone[this.lapsDone.length - 1]) }, { l: 'Voltas', v: this.lapsDone.length }] };
  }
  finish() {
    const best = this.lapsDone.length ? Math.min(...this.lapsDone) : null;
    return { mode: 'timeattack', title: 'TIME ATTACK', score: best, newRecord: best && best <= (this.rec.timeAttack || 1e9), lines: [['Melhor volta da sessão', fmtTime(best)], ['Recorde pessoal', fmtTime(this.rec.timeAttack)], ['Voltas completas', this.lapsDone.length]], rankingMode: best ? 'timeattack' : null, rankScore: best ? +best.toFixed(3) : 0, lowerIsBetter: true, retry: { type: 'timeattack' } };
  }
  dispose() { super.dispose(); if (this.ghost) { this.game.removeCar(this.ghost); this.ghost = null; } }
}

// ---------------------------------------------------------------------
//  Tandem drift battle: run 1 AI leads / player chases, run 2 swapped.
// ---------------------------------------------------------------------
export class BattleMode extends BaseMode {
  constructor(game, opts) { super(game, opts); this.name = 'DRIFT BATTLE'; this.key = 'battle'; this.level = opts.level || 'normal'; }
  start() {
    this.run = 1; this.results = []; this.opp = this.addAI(this.level, 'drift', '#f2f2f2', 0, 'Kenji "Ryu" Takeda');
    this.setupRun();
  }
  setupRun() {
    const t = this.game.world.track;
    const lead = t.pointAt(START_S + 5), chase = t.pointAt(START_S - 9);
    const playerLeads = this.run === 2;
    const pl = playerLeads ? lead : chase, op = playerLeads ? chase : lead;
    this.player.place(pl.x, pl.z, Math.atan2(pl.tx, pl.tz));
    this.opp.car.place(op.x, op.z, Math.atan2(op.tx, op.tz));
    this.opp.ai = new AIDriver(t, this.game.world.racingLine, this.level, 'drift');
    this.lap = new LapTracker(t); this.lap.reset(START_S);
    this.scorer = new DriftScorer({ minSpeed: 25 });
    this.stats = { p: { drift: 0, angle: 0, prox: 0, proxT: 0, pen: 0, t: 0 }, o: { drift: 0, angle: 0, prox: 0, proxT: 0, pen: 0, t: 0 } };
    this.runTime = 0;
    this.startCountdown(3);
    this.game.ui.objective(playerLeads ? 'CORRIDA 2/2 — Você LIDERA: drift limpo, ângulo e velocidade' : 'CORRIDA 1/2 — Você PERSEGUE: fique colado no líder enquanto derrapa');
    this.game.world.resetProps();
  }
  update(dt) {
    this.tickCountdown(dt);
    // the chaser AI (run 2) aims behind the player: modulate its speed
    if (this.run === 2 && this.started) {
      const d = this.gap();
      this.opp.ai.speedScale = d > 14 ? 1.12 : d < 6 ? 0.85 : 1.0;
    }
    this.updateAI(dt);
    if (!this.started) return;
    this.time += dt; this.runTime += dt;
    const t = this.game.world.track, v = this.player.veh, ti = this.player.trackInfo;
    this.scorer.update(dt, this.player, this.game.world);
    this.game.handleScoreEvents(this.scorer);
    const pAngle = this.scorer.angle, pDrift = this.scorer.active && pAngle > 12;
    const oAngle = Math.abs(this.opp.car.pose || 0) * 57.3, oDrift = oAngle > 15 && this.opp.car.veh.speed > 8;
    const S = this.stats; S.p.t += dt; S.o.t += dt;
    if (pDrift) { S.p.drift += dt; S.p.angle += pAngle * dt; }
    if (oDrift) { S.o.drift += dt; S.o.angle += oAngle * dt; }
    const gap = this.gap();
    const chaser = this.run === 1 ? S.p : S.o;
    if (gap < 18) { chaser.proxT += dt; chaser.prox += Math.max(0, 1 - Math.max(0, gap - 3) / 15) * dt; }
    if (gap > 40) chaser.pen += dt * 2;
    // lap end when leader completes lap
    const leader = this.run === 1 ? this.opp : null;
    const lt = this.run === 1 ? this.opp.car.trackInfo : ti;
    const carL = this.run === 1 ? this.opp.car : this.player;
    const ev = this.lap.update(lt.s, this.time, dt, carL.veh.heading, t.tx[lt.i], t.tz[lt.i]);
    if (ev === 'lap' || this.runTime > 200) this.endRun();
  }
  gap() { const a = this.player.veh, b = this.opp.car.veh; return Math.hypot(a.x - b.x, a.z - b.z); }
  onImpact(car, e) { if (car === this.player) { this.scorer.onImpact(e.strength); if (e.strength > 3) this.stats.p.pen += 3; } }
  onCarHit(a, b, hit) {
    if (!this.started) return;
    // chaser at fault
    const chaserIsPlayer = this.run === 1;
    if (chaserIsPlayer) this.stats.p.pen += 6; else this.stats.o.pen += 6;
    this.game.ui.popup('CONTATO!', 'fail');
  }
  score(st, leading) {
    const T = Math.max(1, st.t);
    const drift = st.drift / T, ang = st.drift > 0 ? st.angle / st.drift : 0;
    let s;
    if (leading) s = drift * 55 + Math.min(1, ang / 45) * 35 + 10;
    else s = drift * 35 + Math.min(1, ang / 45) * 20 + (st.prox / T) * 45;
    return Math.max(0, Math.min(100, s - st.pen));
  }
  endRun() {
    const lvlF = { easy: 0.78, normal: 0.9, hard: 1.0 }[this.level];
    const pLead = this.run === 2;
    const ps = this.score(this.stats.p, pLead);
    // AI judged with its scripted drift quality scaled by difficulty
    const os = this.score(this.stats.o, !pLead) * lvlF;
    this.results.push({ run: this.run, player: ps, opp: os });
    this.game.ui.popup(`CORRIDA ${this.run}: VOCÊ ${ps.toFixed(1)} × ${os.toFixed(1)} RYU`, ps >= os ? 'bank' : 'fail');
    if (this.run === 1) { this.run = 2; this.setupRun(); }
    else this.done = true;
  }
  hud() {
    const gap = this.gap();
    return { score: this.scorer, boxes: [{ l: 'Corrida', v: `${this.run}<small>/2</small>` }, { l: this.run === 1 ? 'Você persegue' : 'Você lidera', v: `${gap.toFixed(1)}<small> m</small>` }, { l: 'Volta', v: (this.lap.lapFraction * 100).toFixed(0) + '<small>%</small>' }], battle: { gap, chasing: this.run === 1 } };
  }
  finish() {
    const P = this.results.reduce((a, r) => a + r.player, 0), O = this.results.reduce((a, r) => a + r.opp, 0);
    const win = P > O + 0.5, tie = Math.abs(P - O) <= 0.5;
    const st = this.game.save.data.stats; st.battles++; if (win) st.battleWins++;
    const reward = win ? 1200 : tie ? 500 : 200;
    this.game.save.data.credits += reward;
    return { mode: 'battle', title: tie ? 'EMPATE (OMT)' : win ? 'VITÓRIA NA BATALHA!' : 'DERROTA', score: Math.round(P * 10) / 10, table: this.results.map(r => ({ pos: r.run, name: r.run === 1 ? 'Corrida 1 (perseguição)' : 'Corrida 2 (liderança)', time: `${r.player.toFixed(1)} × ${r.opp.toFixed(1)}` })), lines: [['Sua nota total', P.toFixed(1)], ['Adversário', O.toFixed(1)], ['Créditos', '+' + reward]], rankingMode: 'battle', rankScore: Math.round(P * 10) / 10, retry: { type: 'battle', opts: this.opts } };
  }
}
