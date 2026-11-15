// =====================================================================
//  A Room is one instance of the shared open world (all regions).
//  - validated state updates (speed / acceleration / teleport checks)
//  - interest management: full-rate snapshots only for players nearby,
//    1 Hz positions for the rest (minimap), crew mates always included
//  - street challenges, public events, races, local chat, horn/lights
//  - free-roam drift earnings computed on the server
// =====================================================================
import { randomUUID } from 'node:crypto';
import { LIMITS, CHALLENGE_TYPES, driftPoints, regionAt, filterChat } from '../src/net/shared.js';
import { Race } from './race.js';
import { log } from './log.js';

const CELL = 150;

export class Room {
  constructor(hub, id, { name, isPrivate = false, code = null, capacity }) {
    this.hub = hub; this.db = hub.db; this.id = id;
    this.name = name; this.isPrivate = isPrivate; this.code = code;
    this.capacity = capacity;
    this.players = new Map();          // userId → Player
    this.challenges = new Map();       // id → {id, from, to, kind, expires}
    this.races = new Set();
    this.event = null;
    this.tickN = 0;
    this.nextEventAt = Date.now() + hub.config.eventEveryMin * 60e3;
    this.created = Date.now();
  }
  get size() { return this.players.size; }
  info() { return { id: this.id, name: this.name, players: this.size, capacity: this.capacity, private: this.isPrivate, region: this.hub.config.region }; }

  add(p) {
    this.players.set(p.id, p);
    p.room = this;
    const spawn = p.spawnPoint();
    p.state = { x: spawn.x, z: spawn.z, h: spawn.h, vx: 0, vz: 0, steer: 0, rpm: 900, gear: 1, flags: 0, t: Date.now() };
    p.authorizeTeleport(spawn.x, spawn.z);
    p.send({ t: 'welcome', you: p.publicInfo(true), room: this.info(), spawn, players: [...this.players.values()].filter(o => o !== p).map(o => o.publicInfo()), event: this.event && this.eventInfo(), serverTime: Date.now() });
    this.broadcast({ t: 'join', player: p.publicInfo() }, p);
    log.info('player joined room', { user: p.id, room: this.id, size: this.size });
  }
  remove(p, reason = 'leave') {
    if (!this.players.has(p.id)) return;
    if (p.race) p.race.leave(p, reason);
    for (const [id, c] of this.challenges) if (c.from === p || c.to === p) this.challenges.delete(id);
    if (this.event) this.event.joined.delete(p.id);
    this.players.delete(p.id);
    p.room = null;
    this.broadcast({ t: 'leave', id: p.id, reason });
    log.info('player left room', { user: p.id, room: this.id, reason, size: this.size });
  }
  broadcast(m, except) { const s = JSON.stringify(m); for (const o of this.players.values()) if (o !== except && o.online) o.send(s); }
  near(p, r) { const out = []; for (const o of this.players.values()) if (o !== p && Math.hypot(o.state.x - p.state.x, o.state.z - p.state.z) <= r) out.push(o); return out; }

  // ------------------------------------------------------------------ state
  onState(p, m) {
    const now = Date.now();
    const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    const cur = { x: num(m.x), z: num(m.z), h: num(m.h), vx: num(m.vx), vz: num(m.vz), steer: Math.max(-1, Math.min(1, num(m.s))), rpm: Math.max(0, Math.min(12000, num(m.r))), gear: Math.max(-1, Math.min(7, num(m.g) | 0)), flags: num(m.f) & 0xff, t: now };
    const prev = p.state;
    const dt = Math.max(0.001, (now - prev.t) / 1000);
    const dist = Math.hypot(cur.x - prev.x, cur.z - prev.z);
    const sp = Math.hypot(cur.vx, cur.vz);
    let bad = null, teleported = false;
    if (Math.abs(cur.x) > 5000 || Math.abs(cur.z) > 5000) bad = 'out_of_world';
    else if (sp > LIMITS.maxSpeed) bad = 'speed';
    else if (p.teleportOk && Math.hypot(cur.x - p.teleportOk.x, cur.z - p.teleportOk.z) < 30) { p.teleportOk = null; teleported = true; }
    else if (dist > LIMITS.teleportDist && dist > LIMITS.maxSpeed * dt * 1.6 + 5) bad = 'teleport';
    else if (dist > LIMITS.maxSpeed * Math.min(dt, 1) * 1.35 + 3) bad = 'position_speed';
    if (bad) {
      p.violations++;
      this.db.activity(p.id, 'invalid_state', { bad, dist: +dist.toFixed(1), dt: +dt.toFixed(3), sp: +sp.toFixed(1) }, true);
      if (p.race) p.race.violation(p, bad);
      p.send({ t: 'correct', x: prev.x, z: prev.z, h: prev.h, reason: bad });
      p.authorizeTeleport(prev.x, prev.z);
      if (p.violations > 30) { log.warn('kicking player for repeated invalid states', { user: p.id }); p.kick('Movimentos inválidos repetidos'); }
      return;
    }
    p.state = cur;
    if (!teleported) p.distance += dist;
    if (p.race) p.race.onState(p, teleported ? cur : prev, cur, dt); // a teleport never crosses checkpoints
    else {
      // free roam drift earnings (server computed)
      const pts = driftPoints(prev, cur, dt);
      if (pts > 0) { p.freeDrift += pts; p.chain += pts; p.chainIdle = 0; } else if ((p.chainIdle += dt) > 1.5 && p.chain > 0) { if (p.chain > p.bestChain) p.bestChain = p.chain; p.chain = 0; }
    }
    const reg = regionAt(cur.x, cur.z);
    if (reg !== p.region) { p.region = reg; }
  }
  respawn(p, m) {
    // client asks to be reset (R key); server allows a short jump to a valid place nearby (never across a race route) or to the spawn
    if (!p.limits.respawn.take(p.id)) return;
    const x = +m.x, z = +m.z, maxJump = p.race ? 80 : 400;
    if (Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x - p.state.x, z - p.state.z) < maxJump) p.authorizeTeleport(x, z);
    else if (p.race) p.send({ t: 'correct', x: p.state.x, z: p.state.z, h: p.state.h, reason: 'respawn_denied' });
    else { const s = p.spawnPoint(); p.authorizeTeleport(s.x, s.z); p.send({ t: 'correct', x: s.x, z: s.z, h: s.h, reason: 'respawn' }); }
  }

  // ------------------------------------------------------------------ tick: snapshots + timers
  tick() {
    const now = Date.now();
    this.tickN++;
    // spatial hash
    const grid = new Map();
    for (const p of this.players.values()) { const k = `${Math.floor(p.state.x / CELL)},${Math.floor(p.state.z / CELL)}`; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(p); }
    const R = LIMITS.interestRadius, rc = Math.ceil(R / CELL);
    const farTick = this.tickN % Math.round(this.hub.config.tickHz / LIMITS.farRate) === 0;
    for (const p of this.players.values()) {
      if (!p.online) continue;
      const cx = Math.floor(p.state.x / CELL), cz = Math.floor(p.state.z / CELL);
      const list = [], seen = new Set();
      for (let i = -rc; i <= rc; i++) for (let j = -rc; j <= rc; j++) {
        const a = grid.get(`${cx + i},${cz + j}`); if (!a) continue;
        for (const o of a) {
          if (o === p) continue;
          const d = Math.hypot(o.state.x - p.state.x, o.state.z - p.state.z); if (d > R) continue;
          seen.add(o.id);
          const s = o.state;
          list.push([o.id, r1(s.x), r1(s.z), r3(s.h), r1(s.vx), r1(s.vz), r2(s.steer), s.rpm | 0, s.gear, s.flags | (o.online ? 0 : 128)]);
          if (d < 60 && !p.met.has(o.id)) { p.met.add(o.id); this.db.seen(p.id, o.id); }
        }
      }
      if (list.length) p.send({ t: 'snap', ts: now, p: list });
      if (farTick) {
        const far = [];
        for (const o of this.players.values()) if (o !== p && !seen.has(o.id)) far.push([o.id, Math.round(o.state.x), Math.round(o.state.z), o.crewId && o.crewId === p.crewId ? 1 : 0]);
        p.send({ t: 'far', p: far, n: this.size });
      }
    }
    // challenges expiry
    for (const [id, c] of this.challenges) if (now > c.expires) { this.challenges.delete(id); c.from.send({ t: 'challenge_result', id, ok: false, reason: 'expired', name: c.to.name }); c.to.send({ t: 'challenge_expired', id }); }
    for (const r of this.races) r.tick(now);
    // free-roam payouts every 20 s
    if (this.tickN % (this.hub.config.tickHz * 20) === 0) for (const p of this.players.values()) this.payFreeRoam(p);
    // public events
    this.tickEvents(now);
    // drop players whose reconnect grace expired
    for (const p of this.players.values()) if (!p.online && now - p.discAt > this.hub.config.reconnectGraceSec * 1000) this.hub.dropPlayer(p, 'timeout');
  }
  payFreeRoam(p) {
    const pts = p.freeDrift; p.freeDrift = 0;
    const dist = p.distance - p.paidDistance; p.paidDistance = p.distance;
    if (pts < 200 && dist < 1) return;
    if (p.violations > 5) return; // no earnings while flagged
    const money = Math.min(1500, Math.floor(pts / 40)), xp = Math.min(800, Math.floor(pts / 60));
    this.db.addDriftStats(p.id, Math.max(p.bestChain, 0), dist);
    p.bestChain = 0;
    if (money <= 0 && xp <= 0) return;
    const w = this.db.payFreeRoam(p.id, money, xp, 'free_' + this.id);
    p.level = w.level;
    p.send({ t: 'wallet', money: w.balance, xp: w.xpTotal, level: w.level, gain: { money, xp, reason: 'Drift livre' } });
  }

  // ------------------------------------------------------------------ challenges
  challenge(p, m) {
    const to = this.players.get(+m.to);
    const kind = CHALLENGE_TYPES[m.kind] ? m.kind : 'sprint';
    const fail = (reason) => p.send({ t: 'challenge_result', ok: false, reason, name: to?.name });
    if (!to || to === p) return fail('not_found');
    if (!p.limits.challenge.take(p.id)) return fail('rate_limited');
    if (p.busy || p.race) return fail('you_busy');
    if (to.busy || to.race || !to.online) return fail('busy');
    if ([...this.challenges.values()].some(c => c.from === p || c.to === to || c.from === to || c.to === p)) return fail('pending');
    if (this.db.isBlocked(to.id, p.id) || this.db.isBlocked(p.id, to.id)) return fail('blocked');
    const d = Math.hypot(to.state.x - p.state.x, to.state.z - p.state.z);
    if (d > LIMITS.challengeRadius) return fail('too_far');
    const cd = p.declinedBy.get(to.id); if (cd && Date.now() < cd) return fail('cooldown');
    const id = randomUUID();
    const c = { id, from: p, to, kind, expires: Date.now() + LIMITS.challengeTimeout * 1000 };
    this.challenges.set(id, c);
    to.send({ t: 'challenged', id, from: p.id, name: p.name, car: p.car, level: p.level, kind, label: CHALLENGE_TYPES[kind].label, desc: CHALLENGE_TYPES[kind].desc, timeout: LIMITS.challengeTimeout });
    p.send({ t: 'challenge_sent', id, to: to.id, name: to.name, kind, timeout: LIMITS.challengeTimeout });
    this.db.activity(p.id, 'challenge', { to: to.id, kind });
  }
  challengeReply(p, m) {
    const c = this.challenges.get(m.id);
    if (!c || c.to !== p) return p.send({ t: 'notify', kind: 'warn', msg: 'Desafio não está mais disponível' });
    this.challenges.delete(m.id);
    if (!m.accept) {
      c.from.declinedBy.set(p.id, Date.now() + LIMITS.challengeCooldown * 1000);
      c.from.send({ t: 'challenge_result', id: c.id, ok: false, reason: 'declined', name: p.name });
      return;
    }
    if (c.from.busy || c.from.race || !c.from.online || !this.players.has(c.from.id)) return p.send({ t: 'notify', kind: 'warn', msg: 'O desafiante não está mais disponível' });
    c.from.send({ t: 'challenge_result', id: c.id, ok: true, name: p.name });
    this.startRace(c.kind, [c.from, p]);
  }
  startRace(kind, players, opts) {
    const r = new Race(this, kind, players, opts);
    this.races.add(r);
    this.broadcast({ t: 'notify', kind: 'race', msg: `${players.map(x => x.name).join(' × ')} iniciaram: ${r.def.label}` });
    return r;
  }
  raceEnded(r) { this.races.delete(r); }

  // ------------------------------------------------------------------ public events
  eventInfo() { const e = this.event; return e && { id: e.id, label: e.label, route: e.route, startsIn: Math.max(0, e.startAt - Date.now()), joined: [...e.joined] }; }
  tickEvents(now) {
    if (!this.event && now > this.nextEventAt && this.size >= 2) {
      this.event = { id: randomUUID(), label: 'Evento público: Volta Hakone Bay', route: 'circuit1', startAt: now + (this.hub.config.eventJoinSec ?? 60) * 1000, joined: new Set() };
      this.broadcast({ t: 'event', ...this.eventInfo() });
    }
    if (this.event && now > this.event.startAt) {
      const e = this.event; this.event = null; this.nextEventAt = now + this.hub.config.eventEveryMin * 60e3;
      const ps = [...e.joined].map(id => this.players.get(id)).filter(p => p && p.online && !p.busy);
      if (ps.length >= 2) this.startRace('event', ps.slice(0, 8), { label: e.label, route: e.route });
      else this.broadcast({ t: 'notify', kind: 'info', msg: 'Evento público cancelado: participantes insuficientes' });
    }
  }
  eventJoin(p, m) {
    const e = this.event;
    if (!e || e.id !== m.id) return p.send({ t: 'notify', kind: 'warn', msg: 'Evento não disponível' });
    if (p.busy) return p.send({ t: 'notify', kind: 'warn', msg: 'Você está ocupado' });
    if (m.leave) e.joined.delete(p.id); else e.joined.add(p.id);
    this.broadcast({ t: 'event', ...this.eventInfo() });
  }

  // ------------------------------------------------------------------ chat / fx
  chat(p, m) {
    const msg = filterChat(m.msg);
    if (!msg) return;
    if (!p.limits.chat.take(p.id)) return p.send({ t: 'notify', kind: 'warn', msg: 'Você está enviando mensagens rápido demais' });
    const ch = ['local', 'global', 'crew', 'pm'].includes(m.ch) ? m.ch : 'local';
    const out = { t: 'chat', ch, from: p.id, name: p.name, msg, ts: Date.now() };
    const deliver = (o) => { if (!o.blocked.has(p.id)) o.send(out); };
    if (ch === 'global') for (const o of this.players.values()) deliver(o);
    else if (ch === 'local') { deliver(p); for (const o of this.near(p, 200)) deliver(o); }
    else if (ch === 'crew') { if (!p.crewId) return p.send({ t: 'notify', kind: 'warn', msg: 'Você não está em uma equipe' }); for (const o of this.hub.online.values()) if (o.crewId === p.crewId) deliver(o); }
    else if (ch === 'pm') {
      const to = this.hub.online.get(+m.to);
      if (!to) return p.send({ t: 'notify', kind: 'warn', msg: 'Jogador offline' });
      out.to = to.id; out.toName = to.name; deliver(to); p.send(out);
    }
  }
  fx(p, kind) {
    if (!p.limits.fx.take(p.id)) return;
    const m = { t: 'fx', id: p.id, k: kind };
    for (const o of this.near(p, LIMITS.interestRadius)) o.send(m);
  }
}
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
