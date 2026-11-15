// =====================================================================
//  Server-authoritative races. The server owns: grid, countdown, start
//  time, checkpoint progress (from the validated position stream),
//  drift scoring, finish times, placement, rewards.
// =====================================================================
import { randomUUID } from 'node:crypto';
import { ROUTES, CHALLENGE_TYPES, REWARDS, driftPoints, tandemBonus } from '../src/net/shared.js';
import { log } from './log.js';

const SETUP_MS = 3500, COUNTDOWN_MS = 3000;

// segment p→q intersects circle (c, r)? returns fraction t in [0,1] of first contact or -1
function segCircle(px, pz, qx, qz, cx, cz, r) {
  const dx = qx - px, dz = qz - pz, fx = px - cx, fz = pz - cz;
  const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-9) return -1;
  const disc = b * b - 4 * a * c; if (disc < 0) return -1;
  const s = Math.sqrt(disc), t1 = (-b - s) / (2 * a);
  return t1 >= 0 && t1 <= 1 ? t1 : -1;
}

export class Race {
  /**
   * @param room   Room
   * @param kind   challenge type key (sprint|circuit|timeattack|drift|tandem|bo3) or 'event'
   * @param players array of server players (index 0 = challenger / leader)
   */
  constructor(room, kind, players, opts = {}) {
    this.room = room; this.db = room.db;
    this.kind = kind;
    this.def = kind === 'event' ? { label: opts.label || 'Evento público', route: opts.route || 'circuit1', scoring: 'time' } : CHALLENGE_TYPES[kind];
    this.route = ROUTES[this.def.route];
    this.gates = this.route.gates; this.laps = this.route.laps;
    this.totalGates = this.gates.length * this.laps;
    this.id = randomUUID();
    this.rounds = this.def.rounds || 1; this.round = 1; this.roundWins = new Map();
    this.parts = players.map((p, i) => ({ p, uid: p.id, slot: i, gate: 0, score: 0, finishMs: null, status: 'racing', violations: 0, disc: false, discAt: 0, falseStart: false }));
    this.phase = 'setup';
    this.db.createRace(this.id, kind, this.route.id, room.id);
    for (const pt of this.parts) { pt.p.race = this; pt.p.busy = true; }
    this.timeLimit = (this.route.minLapTime * this.laps * 3.5 + 60) * 1000;
    this.setupRound();
  }

  setupRound() {
    this.phase = 'setup';
    const grid = this.route.grid;
    const now = Date.now();
    this.goAt = now + SETUP_MS + COUNTDOWN_MS;
    for (const pt of this.parts) {
      pt.gate = 0; pt.score = 0; pt.finishMs = null; pt.falseStart = false;
      if (pt.status !== 'dnf') pt.status = 'racing';
      const g = grid[pt.slot % grid.length];
      pt.grid = g;
      pt.p.authorizeTeleport(g.x, g.z);
      pt.p.send({
        t: 'race', phase: 'setup', id: this.id, kind: this.kind, label: this.def.label, scoring: this.def.scoring, ghost: !!this.def.ghost,
        route: this.route.id, routeName: this.route.name, gates: this.gates, laps: this.laps, slot: g, round: this.round, rounds: this.rounds,
        goIn: this.goAt - now, leader: this.def.scoring === 'tandem' ? this.parts[0].uid : null,
        rivals: this.parts.filter(o => o !== pt).map(o => ({ id: o.uid, name: o.p.name })),
      });
    }
    this._t1 = setTimeout(() => this.countdown(), SETUP_MS);
  }
  countdown() {
    if (this.phase !== 'setup') return;
    this.phase = 'countdown';
    this.broadcast({ t: 'race', phase: 'countdown', id: this.id, goIn: this.goAt - Date.now() });
    this._t2 = setTimeout(() => this.go(), Math.max(0, this.goAt - Date.now()));
  }
  go() {
    if (this.phase !== 'countdown') return;
    this.phase = 'running';
    this.startedAt = Date.now();
    if (this.round === 1) this.db.setRaceStatus(this.id, 'running');
    this.broadcast({ t: 'race', phase: 'go', id: this.id });
    this._limit = setTimeout(() => this.finish('time_limit'), this.timeLimit);
  }

  /** called by the room for every validated state of a participant */
  onState(p, prev, cur, dt) {
    const pt = this.parts.find(x => x.p === p); if (!pt || pt.status !== 'racing') return;
    if (this.phase === 'countdown' || this.phase === 'setup') {
      if (this.phase === 'countdown' && Math.hypot(cur.x - pt.grid.x, cur.z - pt.grid.z) > 6 && !pt.falseStart) { pt.falseStart = true; p.send({ t: 'notify', kind: 'warn', msg: 'Queima de largada! +3 s' }); }
      return;
    }
    if (this.phase !== 'running') return;
    // drift scoring (server side)
    if (this.def.scoring === 'drift' || this.def.scoring === 'tandem') {
      let pts = driftPoints(prev, cur, dt);
      if (this.def.scoring === 'tandem' && pt.slot > 0) {
        const lead = this.parts[0].p.state; pts *= tandemBonus(Math.hypot(lead.x - cur.x, lead.z - cur.z));
      }
      pt.score += pts;
    }
    // checkpoints: segment prev→cur crossing the next gate
    let guard = 0;
    while (pt.gate < this.totalGates && guard++ < 3) {
      const g = this.gates[pt.gate % this.gates.length];
      const t = segCircle(prev.x, prev.z, cur.x, cur.z, g.x, g.z, g.r);
      if (t < 0) break;
      pt.gate++;
      const atMs = (prev.t + (cur.t - prev.t) * t) - this.startedAt;
      p.send({ t: 'race', phase: 'cp', id: this.id, gate: pt.gate, total: this.totalGates, ms: Math.round(atMs) });
      if (pt.gate >= this.totalGates) {
        const minMs = this.route.minLapTime * this.laps * 1000;
        if (atMs < minMs) { pt.status = 'dq'; this.flag(p, 'impossible_time', { atMs, minMs }); p.send({ t: 'race', phase: 'dq', id: this.id, reason: 'Tempo impossível' }); }
        else { pt.finishMs = Math.round(atMs + (pt.falseStart ? 3000 : 0)); pt.status = 'finished'; this.broadcast({ t: 'race', phase: 'finished', id: this.id, who: p.id, name: p.name, ms: pt.finishMs, score: Math.round(pt.score) }); }
        this.checkDone();
        break;
      }
    }
  }
  violation(p, why) {
    const pt = this.parts.find(x => x.p === p); if (!pt || pt.status !== 'racing') return;
    if (++pt.violations >= 3) { pt.status = 'dq'; p.send({ t: 'race', phase: 'dq', id: this.id, reason: 'Movimento inválido detectado' }); this.flag(p, 'race_dq', { why }); this.checkDone(); }
  }
  flag(p, kind, detail) { this.db.activity(p.id, kind, { race: this.id, ...detail }, true); log.warn('suspicious', { user: p.id, kind, ...detail }); }

  disconnect(p) { const pt = this.parts.find(x => x.p === p); if (pt && pt.status === 'racing') { pt.disc = true; pt.discAt = Date.now(); } }
  reconnect(p) {
    const pt = this.parts.find(x => x.uid === p.id); if (!pt) return;
    pt.p = p; pt.disc = false; p.race = this; p.busy = true;
    p.send({ t: 'race', phase: 'resume', id: this.id, kind: this.kind, label: this.def.label, scoring: this.def.scoring, gates: this.gates, laps: this.laps, gate: pt.gate, total: this.totalGates, elapsed: this.startedAt ? Date.now() - this.startedAt : 0, status: pt.status });
  }
  leave(p, reason = 'left') {
    const pt = this.parts.find(x => x.uid === p.id); if (!pt) return;
    if (pt.status === 'racing') pt.status = 'dnf';
    pt.p.race = null; pt.p.busy = false;
    this.broadcast({ t: 'race', phase: 'left', id: this.id, who: p.id, name: p.name, reason });
    this.checkDone();
  }
  tick(now) {
    for (const pt of this.parts) if (pt.disc && pt.status === 'racing' && now - pt.discAt > this.room.hub.config.reconnectGraceSec * 1000) { pt.status = 'dnf'; this.broadcast({ t: 'race', phase: 'left', id: this.id, who: pt.uid, name: pt.p.name, reason: 'disconnected' }); this.checkDone(); }
  }
  checkDone() {
    if (this.phase === 'done') return;
    const racing = this.parts.filter(x => x.status === 'racing');
    const finished = this.parts.filter(x => x.status === 'finished');
    // single-opponent race: once everyone else is out, the remaining racer still has to finish (time scoring) — but if nobody can finish anymore, end
    if (!racing.length) return this.finish('all_done');
    if (this.def.scoring === 'time' && finished.length && racing.every(x => x.disc)) return this.finish('rest_disconnected');
  }
  ranking() {
    const score = this.def.scoring === 'time' ? (a, b) => a.finishMs - b.finishMs : (a, b) => b.score - a.score;
    const fin = this.parts.filter(x => x.status === 'finished').sort(score);
    const rest = this.parts.filter(x => x.status !== 'finished');
    return [...fin, ...rest];
  }
  finish(reason) {
    if (this.phase === 'done') return;
    clearTimeout(this._limit); clearTimeout(this._t1); clearTimeout(this._t2);
    for (const pt of this.parts) if (pt.status === 'racing') pt.status = 'dnf';
    const order = this.ranking();
    const winner = order[0] && order[0].status === 'finished' ? order[0] : null;
    if (this.rounds > 1) {
      if (winner) this.roundWins.set(winner.uid, (this.roundWins.get(winner.uid) || 0) + 1);
      const best = Math.max(0, ...this.roundWins.values());
      const playersLeft = this.parts.filter(x => x.status !== 'dq' && !(x.status === 'dnf' && x.disc));
      this.broadcast({ t: 'race', phase: 'round', id: this.id, round: this.round, winner: winner ? winner.uid : null, wins: Object.fromEntries(this.roundWins) });
      if (best < Math.ceil((this.rounds + 1) / 2) && this.round < this.rounds && playersLeft.length >= 2) {
        this.round++;
        for (const pt of this.parts) if (pt.status !== 'dq' && !pt.disc) pt.status = 'racing';
        this._next = setTimeout(() => this.setupRound(), 2500);
        return;
      }
    }
    this.phase = 'done';
    // final placement (bo3: by round wins, then last round order)
    let final = order;
    if (this.rounds > 1) final = [...this.parts].sort((a, b) => (this.roundWins.get(b.uid) || 0) - (this.roundWins.get(a.uid) || 0));
    const overallWinner = this.rounds > 1 ? ((this.roundWins.get(final[0].uid) || 0) > 0 ? final[0] : null) : winner;
    const table = REWARDS[this.kind] || REWARDS.sprint;
    const results = [];
    final.forEach((pt, i) => {
      const finished = this.rounds > 1 ? (this.roundWins.get(pt.uid) || 0) > 0 || pt.status === 'finished' : pt.status === 'finished';
      const isWin = overallWinner === pt;
      const place = i + 1;
      let reward = null;
      if (finished || isWin) {
        const k = Math.min(i, table.money.length - 1);
        const scale = this.parts.length === 1 ? 0 : 1;
        reward = this.db.grantReward(this.id, pt.uid, { money: table.money[k] * scale, xp: table.xp[k] * scale, rep: table.rep[k] * scale, reason: 'race_' + this.kind, win: this.parts.length > 1 ? isWin : null });
      } else if (pt.status !== 'dq') {
        this.db.grantReward(this.id, pt.uid, { money: 0, xp: 0, rep: 0, reason: 'race_' + this.kind + '_dnf', win: this.parts.length > 1 ? false : null });
      }
      this.db.saveResult(this.id, pt.uid, { place, timeMs: pt.finishMs, score: Math.round(pt.score), status: pt.status, car: pt.p.car });
      results.push({ id: pt.uid, name: pt.p.name, place, status: pt.status, ms: pt.finishMs, score: Math.round(pt.score), wins: this.roundWins.get(pt.uid) || 0, reward, win: isWin });
    });
    this.db.setRaceStatus(this.id, 'finished', { winner: overallWinner ? overallWinner.uid : null });
    log.info('race finished', { id: this.id, kind: this.kind, reason, winner: overallWinner?.uid ?? null, results: results.map(r => [r.id, r.status, r.ms, r.score]) });
    for (const pt of this.parts) {
      const mine = results.find(r => r.id === pt.uid);
      pt.p.send({ t: 'race', phase: 'result', id: this.id, kind: this.kind, label: this.def.label, scoring: this.def.scoring, reason, results, you: mine });
      if (pt.p.race === this) { pt.p.race = null; pt.p.busy = false; }
      if (mine && mine.reward) pt.p.send({ t: 'wallet', money: mine.reward.balance, xp: mine.reward.xpTotal, level: mine.reward.level });
    }
    this.room.raceEnded(this);
  }
  broadcast(m) { for (const pt of this.parts) if (!pt.disc) pt.p.send(m); }
  abort(reason) { if (this.phase === 'done') return; this.finish(reason || 'aborted'); }
}
