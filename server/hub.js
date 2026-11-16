// =====================================================================
//  Hub: authenticated connections, players, matchmaking across rooms,
//  reconnection, social features (friends, blocks, reports, crews,
//  profiles) and message dispatch.
// =====================================================================
import { Room } from './room.js';
import { RateLimiter, hashToken } from './auth.js';
import { log } from './log.js';
import { PROTOCOL_VERSION, LIMITS, POIS, CAR_IDS, sanitizeName, levelForXp } from '../src/net/shared.js';

const SPAWNS = [
  { x: -95, z: 230, h: Math.PI / 2 }, { x: -80, z: 245, h: Math.PI / 2 }, { x: -60, z: 225, h: Math.PI / 2 },
  { x: -40, z: 250, h: Math.PI / 2 }, { x: -20, z: 230, h: Math.PI / 2 }, { x: 0, z: 245, h: Math.PI / 2 },
];
const LOOK_KEYS = ['color', 'rim', 'finish', 'smoke', 'rideHeight'];
function cleanLook(l) {
  const out = {}; if (!l || typeof l !== 'object') return out;
  for (const k of LOOK_KEYS) {
    const v = l[k];
    if (k === 'rideHeight') { if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.max(-0.08, Math.min(0.08, v)); }
    else if (k === 'finish') { if (['metallic', 'matte', 'pearl', 'chrome'].includes(v)) out[k] = v; }
    else if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v;
  }
  return out;
}

export class Player {
  constructor(hub, profile, conn) {
    this.hub = hub; this.id = profile.id; this.name = profile.username;
    this.conn = null; this.attach(conn);
    this.car = profile.active_car; this.look = hub.db.carLook(this.id, this.car) || {};
    this.level = profile.level; this.rep = profile.rep; this.avatar = profile.avatar;
    this.crewId = profile.crew ? profile.crew.id : null; this.crewName = profile.crew ? profile.crew.name : null;
    this.blocked = new Set(hub.db.blockedBy(this.id));
    this.room = null; this.race = null; this.busy = false;
    this.state = { x: 0, z: 0, h: 0, vx: 0, vz: 0, steer: 0, rpm: 0, gear: 1, flags: 0, t: Date.now() };
    this.teleportOk = null; this.violations = 0;
    this.freeDrift = 0; this.chain = 0; this.chainIdle = 0; this.bestChain = 0;
    this.distance = 0; this.paidDistance = 0;
    this.declinedBy = new Map(); this.met = new Set();
    this.limits = { msg: new RateLimiter(60, 40), chat: new RateLimiter(5, LIMITS.chatPerMin / 60), challenge: new RateLimiter(6, 6 / 60), fx: new RateLimiter(4, 2), social: new RateLimiter(10, 0.5), respawn: new RateLimiter(3, 1 / 3) };
    this.region = 'hakone';
  }
  attach(conn) { this.conn = conn; this.online = true; this.discAt = 0; }
  get onlineState() { return this.online; }
  send(m) { if (this.conn && this.online) this.conn.send(m); }
  kick(reason) { this.send({ t: 'kicked', reason }); this.conn && this.conn.close(4001, reason); }
  authorizeTeleport(x, z) { this.teleportOk = { x, z }; }
  spawnPoint() { const k = this.id % SPAWNS.length; return SPAWNS[k]; }
  publicInfo(self = false) {
    const i = { id: this.id, name: this.name, car: this.car, look: this.look, level: this.level, rep: this.rep, avatar: this.avatar, crew: this.crewName, crewId: this.crewId, busy: this.busy };
    if (!self) { const s = this.state; i.s = [s.x, s.z, s.h]; }
    return i;
  }
}

export class Hub {
  constructor(db, config) {
    this.db = db; this.config = config;
    this.rooms = new Map();
    this.online = new Map();   // userId → Player (any room)
    this.stats = { msgs: 0, conns: 0, bytesIn: 0, bytesOut: 0, started: Date.now() };
    this.connLimit = new RateLimiter(config.connBurst, config.connBurst / 60);
    this._roomSeq = 0;
    this.timer = setInterval(() => this.tick(), 1000 / config.tickHz);
  }
  stop() { clearInterval(this.timer); for (const p of this.online.values()) p.kick('Servidor reiniciando'); }

  // ------------------------------------------------------------------ rooms / matchmaking
  createRoom(opts = {}) {
    const id = `${this.config.region}-${++this._roomSeq}`;
    const r = new Room(this, id, { name: opts.name || `Hakone Bay #${this._roomSeq}`, isPrivate: !!opts.isPrivate, code: opts.code || null, capacity: this.config.roomCapacity });
    this.rooms.set(id, r);
    log.info('room created', { id, private: r.isPrivate });
    return r;
  }
  publicRooms() { return [...this.rooms.values()].filter(r => !r.isPrivate); }
  matchmake(pref) {
    if (pref) {
      const byId = this.rooms.get(pref); if (byId && !byId.isPrivate && byId.size < byId.capacity) return byId;
      const byCode = [...this.rooms.values()].find(r => r.isPrivate && r.code && r.code === String(pref).toUpperCase());
      if (byCode && byCode.size < byCode.capacity) return byCode;
    }
    // fill the busiest public room that still has space (keeps the world lively), otherwise open a new one
    const open = this.publicRooms().filter(r => r.size < r.capacity).sort((a, b) => b.size - a.size);
    if (open.length) return open[0];
    if (this.rooms.size >= this.config.maxRooms) return null;
    return this.createRoom();
  }
  roomList() { return this.publicRooms().map(r => r.info()); }

  // ------------------------------------------------------------------ connections
  onConnection(conn) {
    if (!this.connLimit.take(conn.ip)) { conn.close(4029, 'rate limited'); return; }
    this.stats.conns++;
    let player = null;
    const authTimer = setTimeout(() => { if (!player) conn.close(4000, 'auth timeout'); }, 10000);
    conn.on('message', raw => {
      this.stats.msgs++;
      let m; try { m = JSON.parse(raw); } catch { return conn.close(4002, 'bad json'); }
      if (!m || typeof m.t !== 'string') return;
      if (!player) {
        if (m.t !== 'hello') return conn.close(4003, 'hello first');
        clearTimeout(authTimer);
        player = this.hello(conn, m);
        return;
      }
      if (!player.limits.msg.take(player.id)) { this.db.activity(player.id, 'msg_flood', null, true); return; }
      try { this.dispatch(player, m); } catch (e) { log.error('dispatch error', { user: player.id, t: m.t, e: e.message }); player.send({ t: 'error', msg: 'Erro interno' }); }
    });
    conn.on('close', () => {
      clearTimeout(authTimer);
      this.stats.bytesIn += conn.bytesIn; this.stats.bytesOut += conn.bytesOut;
      if (player && player.conn === conn) this.onDisconnect(player);
    });
  }
  hello(conn, m) {
    if (m.v !== PROTOCOL_VERSION) { conn.send({ t: 'fatal', msg: 'Versão do jogo desatualizada. Recarregue a página.' }); conn.close(4004, 'version'); return null; }
    const uid = this.db.sessionUser(hashToken(m.token || ''));
    if (!uid) { conn.send({ t: 'fatal', msg: 'Sessão inválida. Faça login novamente.', auth: true }); conn.close(4005, 'auth'); return null; }
    const user = this.db.userById(uid);
    if (!user || user.banned) { conn.send({ t: 'fatal', msg: 'Conta suspensa.' }); conn.close(4006, 'banned'); return null; }
    // reconnection: same user already known → take over the connection (session resume)
    const existing = this.online.get(uid);
    if (existing) {
      const old = existing.conn;
      existing.attach(conn);
      if (old && old !== conn && old.open) { old.send({ t: 'kicked', reason: 'Conectado em outro lugar' }); old.close(4007, 'replaced'); }
      if (existing.room) {
        existing.send({ t: 'welcome', resumed: true, you: existing.publicInfo(true), room: existing.room.info(), spawn: { x: existing.state.x, z: existing.state.z, h: existing.state.h }, players: [...existing.room.players.values()].filter(o => o !== existing).map(o => o.publicInfo()), event: existing.room.event && existing.room.eventInfo(), serverTime: Date.now() });
        existing.authorizeTeleport(existing.state.x, existing.state.z);
        if (existing.race) existing.race.reconnect(existing);
        existing.room.broadcast({ t: 'presence', id: uid, online: true }, existing);
      }
      log.info('player resumed', { user: uid });
      this.notifyFriends(existing, true);
      return existing;
    }
    const profile = this.db.profile(uid);
    const room = this.matchmake(m.room);
    if (!room) { conn.send({ t: 'fatal', msg: 'Servidor lotado. Tente novamente em instantes.' }); conn.close(4008, 'full'); return null; }
    const p = new Player(this, profile, conn);
    this.online.set(uid, p);
    this.db.touchLogin(uid);
    this.db.activity(uid, 'join', { room: room.id, ip: conn.ip });
    room.add(p);
    this.notifyFriends(p, true);
    return p;
  }
  onDisconnect(p) {
    p.online = false; p.discAt = Date.now(); p.conn = null;
    if (p.race) p.race.disconnect(p);
    if (p.room) p.room.broadcast({ t: 'presence', id: p.id, online: false });
    log.info('player disconnected (grace)', { user: p.id });
  }
  dropPlayer(p, reason) {
    if (p.room) p.room.remove(p, reason);
    if (this.online.get(p.id) === p) this.online.delete(p.id);
    this.notifyFriends(p, false);
    this.db.activity(p.id, 'leave', { reason });
  }
  notifyFriends(p, online) {
    for (const f of this.db.friendsOf(p.id)) if (f.status === 'accepted') { const o = this.online.get(f.id); if (o) o.send({ t: 'friend_presence', id: p.id, name: p.name, online }); }
  }

  // ------------------------------------------------------------------ dispatch
  dispatch(p, m) {
    const R = p.room;
    switch (m.t) {
      case 'st': return R && R.onState(p, m);
      case 'respawn': return R && R.respawn(p, m);
      case 'ping': return p.send({ t: 'pong', c: m.c, s: Date.now() });
      case 'horn': return R && R.fx(p, 'horn');
      case 'flash': return R && R.fx(p, 'flash');
      case 'chat': return R && R.chat(p, m);
      case 'challenge': return R && R.challenge(p, m);
      case 'challenge_reply': return R && R.challengeReply(p, m);
      case 'challenge_cancel': { if (!R) return; for (const [id, c] of R.challenges) if (c.from === p) { R.challenges.delete(id); c.to.send({ t: 'challenge_expired', id }); } return; }
      case 'race_leave': return p.race && p.race.leave(p, 'left');
      case 'event_join': return R && R.eventJoin(p, m);
      case 'car': return this.changeCar(p, m);
      case 'profile': return this.sendProfile(p, +m.id);
      case 'friends': return this.sendFriends(p);
      case 'friend': return this.friendOp(p, m);
      case 'block': return this.blockOp(p, m);
      case 'report': return this.reportOp(p, m);
      case 'crew': return this.crewOp(p, m);
      case 'leave_world': { this.dropPlayer(p, 'leave'); p.conn && p.conn.close(1000, 'bye'); return; }
      default: return p.send({ t: 'error', msg: 'Mensagem desconhecida: ' + String(m.t).slice(0, 20) });
    }
  }
  changeCar(p, m) {
    const car = String(m.car || '');
    if (!CAR_IDS.includes(car)) return p.send({ t: 'notify', kind: 'warn', msg: 'Carro desconhecido' });
    if (!this.db.ownsCar(p.id, car)) { this.db.activity(p.id, 'car_not_owned', { car }, true); return p.send({ t: 'notify', kind: 'warn', msg: 'Você não possui este carro' }); }
    if (p.race) return p.send({ t: 'notify', kind: 'warn', msg: 'Não é possível trocar de carro durante uma corrida' });
    const look = cleanLook(m.look);
    this.db.setActiveCar(p.id, car, Object.keys(look).length ? look : null);
    p.car = car; p.look = this.db.carLook(p.id, car) || {};
    p.room && p.room.broadcast({ t: 'look', id: p.id, car: p.car, look: p.look });
  }
  sendProfile(p, id) {
    const pub = this.db.publicProfile(id);
    if (!pub) return p.send({ t: 'profile', error: 'not_found' });
    const o = this.online.get(id);
    pub.online = !!(o && o.online); pub.room = o && o.room ? o.room.id : null;
    pub.friend = this.db.areFriends(p.id, id) ? 'accepted' : this.db.friendsOf(p.id).find(f => f.id === id)?.status || null;
    pub.blocked = p.blocked.has(id);
    p.send({ t: 'profile', profile: pub });
  }
  sendFriends(p) {
    const list = this.db.friendsOf(p.id).map(f => { const o = this.online.get(f.id); return { ...f, online: !!(o && o.online), room: o && o.room ? o.room.id : null, region: o ? o.region : null, x: o && o.room === p.room ? Math.round(o.state.x) : null, z: o && o.room === p.room ? Math.round(o.state.z) : null }; });
    const crew = p.crewId ? { id: p.crewId, name: p.crewName, leader: this.db.crewOf(p.id)?.leader_id, members: this.db.crewMembers(p.crewId).map(m => ({ ...m, online: !!this.online.get(m.id)?.online })) } : null;
    p.send({ t: 'friends', friends: list, recent: this.db.recentPlayers(p.id), crew, blocked: [...p.blocked] });
  }
  friendOp(p, m) {
    if (!p.limits.social.take(p.id)) return p.send({ t: 'notify', kind: 'warn', msg: 'Aguarde um pouco' });
    const id = +m.id; const target = this.db.userById(id);
    if (!target) return p.send({ t: 'notify', kind: 'warn', msg: 'Jogador não encontrado' });
    try {
      let r;
      if (m.op === 'request') r = this.db.friendRequest(p.id, id);
      else if (m.op === 'accept') r = this.db.friendAccept(p.id, id);
      else if (m.op === 'decline' || m.op === 'remove') { this.db.friendRemove(p.id, id); r = 'removed'; }
      else return;
      const o = this.online.get(id);
      if (o) {
        if (r === 'pending') o.send({ t: 'friend_request', id: p.id, name: p.name });
        if (r === 'accepted') o.send({ t: 'notify', kind: 'friend', msg: `${p.name} agora é seu amigo` });
        this.sendFriends(o);
      }
      p.send({ t: 'notify', kind: 'friend', msg: r === 'pending' ? `Pedido de amizade enviado a ${target.username}` : r === 'accepted' ? `${target.username} agora é seu amigo` : 'Amizade removida' });
      this.sendFriends(p);
    } catch (e) { p.send({ t: 'notify', kind: 'warn', msg: { self: 'Você não pode adicionar a si mesmo', blocked: 'Não é possível', no_request: 'Nenhum pedido pendente' }[e.message] || 'Falha' }); }
  }
  blockOp(p, m) {
    const id = +m.id; if (!this.db.userById(id) || id === p.id) return;
    this.db.block(p.id, id, !!m.on);
    if (m.on) p.blocked.add(id); else p.blocked.delete(id);
    p.send({ t: 'notify', kind: 'info', msg: m.on ? 'Jogador bloqueado' : 'Jogador desbloqueado' });
    this.sendFriends(p);
  }
  reportOp(p, m) {
    const id = +m.id; if (!this.db.userById(id) || id === p.id) return;
    if (!p.limits.social.take(p.id)) return;
    this.db.report(p.id, id, m.reason || 'sem motivo');
    this.db.activity(id, 'reported', { by: p.id, reason: String(m.reason || '').slice(0, 100) }, true);
    p.send({ t: 'notify', kind: 'info', msg: 'Denúncia registrada. Obrigado.' });
  }
  crewOp(p, m) {
    if (!p.limits.social.take(p.id)) return p.send({ t: 'notify', kind: 'warn', msg: 'Aguarde um pouco' });
    const refresh = (ids) => { for (const id of ids) { const o = this.online.get(id); if (o) { const c = this.db.crewOf(id); o.crewId = c ? c.id : null; o.crewName = c ? c.name : null; this.sendFriends(o); o.room && o.room.broadcast({ t: 'crew_update', id: o.id, crew: o.crewName, crewId: o.crewId }); } } };
    try {
      if (m.op === 'create') {
        const name = sanitizeName(m.name); if (name.length < 3) return p.send({ t: 'notify', kind: 'warn', msg: 'Nome da equipe inválido' });
        this.db.createCrew(p.id, name); refresh([p.id]);
      } else if (m.op === 'invite') {
        const crew = this.db.crewOf(p.id); if (!crew) return p.send({ t: 'notify', kind: 'warn', msg: 'Crie uma equipe primeiro' });
        const o = this.online.get(+m.id); if (!o) return p.send({ t: 'notify', kind: 'warn', msg: 'Jogador offline' });
        if (o.blocked.has(p.id)) return;
        o.pendingCrewInvite = { crewId: crew.id, from: p.id, until: Date.now() + 60e3 };
        o.send({ t: 'crew_invite', crewId: crew.id, name: crew.name, from: p.id, fromName: p.name });
        p.send({ t: 'notify', kind: 'info', msg: `Convite enviado a ${o.name}` });
      } else if (m.op === 'accept') {
        const inv = p.pendingCrewInvite; if (!inv || inv.until < Date.now()) return p.send({ t: 'notify', kind: 'warn', msg: 'Convite expirado' });
        this.db.joinCrew(inv.crewId, p.id); p.pendingCrewInvite = null;
        refresh(this.db.crewMembers(inv.crewId).map(x => x.id));
      } else if (m.op === 'leave') {
        const cid = this.db.leaveCrew(p.id); refresh([p.id, ...this.db.crewMembers(cid).map(x => x.id)]);
      } else if (m.op === 'kick') {
        const crew = this.db.crewOf(p.id); if (!crew || crew.leader_id !== p.id) return p.send({ t: 'notify', kind: 'warn', msg: 'Apenas o líder pode expulsar' });
        const target = +m.id; if (this.db.crewOf(target)?.id !== crew.id || target === p.id) return;
        this.db.leaveCrew(target); refresh([target, ...this.db.crewMembers(crew.id).map(x => x.id)]);
        this.online.get(target)?.send({ t: 'notify', kind: 'warn', msg: `Você foi removido da equipe ${crew.name}` });
      }
    } catch (e) { p.send({ t: 'notify', kind: 'warn', msg: { already_in_crew: 'Já está em uma equipe', crew_full: 'Equipe cheia (8)', no_crew: 'Sem equipe' }[e.message] || 'Falha' }); }
  }

  tick() {
    const t0 = performance.now();
    this._tickBody();
    const ms = performance.now() - t0;
    const tm = this.tickStats || (this.tickStats = { n: 0, sum: 0, max: 0, last: 0 });
    tm.n++; tm.sum += ms; tm.last = ms; if (ms > tm.max) tm.max = ms;
  }
  _tickBody() {
    for (const r of this.rooms.values()) {
      try { r.tick(); } catch (e) { log.error('room tick error', { room: r.id, e: e.message, stack: e.stack }); }
      // close empty rooms beyond the first public one
      if (r.size === 0 && this.rooms.size > 1 && Date.now() - r.created > 60e3) { this.rooms.delete(r.id); log.info('room closed', { id: r.id }); }
    }
  }
  metrics(reset = false) {
    const tm = this.tickStats || { n: 1, sum: 0, max: 0, last: 0 };
    const out = { tickAvgMs: +(tm.sum / Math.max(1, tm.n)).toFixed(3), tickMaxMs: +tm.max.toFixed(3), tickLastMs: +tm.last.toFixed(3), bytesOutLive: [...this.online.values()].reduce((a, p) => a + (p.conn ? p.conn.bytesOut : 0), 0) };
    if (reset) this.tickStats = { n: 0, sum: 0, max: 0, last: 0 };
    return { ...out, uptimeSec: Math.round((Date.now() - this.stats.started) / 1000), online: this.online.size, rooms: [...this.rooms.values()].map(r => ({ ...r.info(), races: r.races.size })), msgs: this.stats.msgs, conns: this.stats.conns, mem: process.memoryUsage().rss, pois: POIS.length, levelCap: levelForXp(1e9) };
  }
}
export { cleanLook };
