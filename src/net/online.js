// =====================================================================
//  ONLINE OPEN WORLD mode. The local car keeps the full physics; the
//  server receives 15 Hz states, validates them and relays them to
//  nearby players. Street challenges, races, events, chat, horn and
//  headlight flashes all happen without leaving the world.
// =====================================================================
import * as THREE from 'three';
import { DriftScorer } from '../modes/scoring.js';
import { LIMITS, CHALLENGE_TYPES, POIS, regionAt, REGIONS, CAR_PRICES } from './shared.js';
import { RemoteCar, esc } from './remote.js';
import { carById } from '../car/cars.js';
import { fmtTime } from '../modes/modes.js';

const KINDS = Object.keys(CHALLENGE_TYPES);
const fmtN = n => Math.round(n || 0).toLocaleString('pt-BR');

export class OnlineMode {
  constructor(game, opts = {}) {
    this.game = game; this.net = game.net; this.opts = opts;
    this.name = 'MUNDO ONLINE'; this.key = 'online';
    this.time = 0; this.done = false; this.started = true; this.ai = [];
    this.remotes = new Map();
    this.unsub = [];
    this.sendAcc = 0; this.race = null; this.incoming = null; this.outgoing = null;
    this.chatLog = []; this.notes = [];
    this.wallet = { money: 0, xp: 0, level: 1 };
    this.event = null;
  }
  get player() { return this.game.player; }

  // ------------------------------------------------------------------ lifecycle
  start() {
    const g = this.game, w = this.opts.welcome;
    this.scorer = new DriftScorer();
    this._buildOverlay();
    const sp = w.spawn; this.player.place(sp.x, sp.z, sp.h);
    this.wallet = { money: this.net.profile?.money ?? 0, xp: this.net.profile?.xp ?? 0, level: w.you.level };
    this.me = w.you;
    for (const p of w.players) this.addRemote(p);
    if (w.event) this.onEvent(w.event);
    const on = (t, f) => this.unsub.push(this.net.on(t, f));
    on('welcome', m => this.onWelcome(m));
    on('snap', m => { for (const r of m.p) { const rc = this.remotes.get(r[0]); if (rc) rc.push({ ts: m.ts, x: r[1], z: r[2], h: r[3], vx: r[4], vz: r[5], steer: r[6], rpm: r[7], gear: r[8], flags: r[9] }); } });
    on('far', m => { this.far = m.p; this.roomSize = m.n; });
    on('join', m => { this.addRemote(m.player); this.note(`${m.player.name} entrou no mundo`, 'info'); });
    on('leave', m => { this.removeRemote(m.id); });
    on('presence', m => { const r = this.remotes.get(m.id); if (r) r.online = m.online; });
    on('look', m => { const r = this.remotes.get(m.id); if (r) r.setInfo({ car: m.car, look: m.look }); });
    on('crew_update', m => { const r = this.remotes.get(m.id); if (r) r.setInfo({ crew: m.crew, crewId: m.crewId }); if (m.id === this.me.id) { this.me.crew = m.crew; this.me.crewId = m.crewId; } });
    on('fx', m => { const r = this.remotes.get(m.id); if (!r) return; if (m.k === 'horn') r.horn(); else r.flash(); });
    on('chat', m => this.onChat(m));
    on('notify', m => { this.note(m.msg, m.kind); if (m.kind === 'race') g.audio.chime('event'); });
    on('challenged', m => this.onChallenged(m));
    on('challenge_sent', m => { this.outgoing = { ...m, until: performance.now() + m.timeout * 1000 }; this.note(`Desafio enviado a ${m.name}…`, 'race'); });
    on('challenge_result', m => this.onChallengeResult(m));
    on('challenge_expired', m => { if (this.incoming && this.incoming.id === m.id) { this.incoming = null; this.note('Desafio expirou', 'warn'); } });
    on('race', m => this.onRace(m));
    on('wallet', m => { this.wallet = { money: m.money, xp: m.xp, level: m.level }; if (this.net.profile) Object.assign(this.net.profile, { money: m.money, xp: m.xp, level: m.level }); if (m.gain && (m.gain.money || m.gain.xp)) this.note(`+${fmtN(m.gain.money)} CR  +${fmtN(m.gain.xp)} XP  (${m.gain.reason})`, 'money'); });
    on('correct', m => { this.player.place(m.x, m.z, m.h); this.game.rig.snap(this.player); if (m.reason !== 'respawn') this.note('Posição corrigida pelo servidor', 'warn'); });
    on('event', m => this.onEvent(m));
    on('friend_request', m => { this.note(`${m.name} quer ser seu amigo — Pausa → Amigos`, 'friend'); g.audio.chime('friend'); this.pendingFriend = m; });
    on('friend_presence', m => this.note(`${m.name} está ${m.online ? 'online' : 'offline'}`, 'friend'));
    on('crew_invite', m => { this.note(`${m.fromName} convidou você para a equipe ${m.name} — Pausa → Amigos`, 'friend'); this.crewInvite = m; g.audio.chime('friend'); });
    on('friends', m => { this.social = m; g.ui.onlineSocialUpdate && g.ui.onlineSocialUpdate(m); });
    on('profile', m => { g.ui.onlineProfileUpdate && g.ui.onlineProfileUpdate(m); });
    on('kicked', m => { this.note('Desconectado: ' + m.reason, 'warn'); this.kicked = m.reason; });
    on('fatal', m => { this.kicked = m.msg; });
    on('disconnected', () => { this.note('Conexão perdida — reconectando…', 'warn'); });
    on('reconnecting', m => { this.reconnecting = m; });
    on('error', m => this.note(m.msg, 'warn'));
    this.game.ui.objective('G desafiar • H buzina • J farol • ENTER chat • TAB jogadores • M mapa • ESC menu online');
    this.net.send({ t: 'friends' });
  }
  onWelcome(m) {
    // reconnection: server resumed our session
    this.reconnecting = null;
    this.note(m.resumed ? 'Reconectado ao servidor' : 'Conectado', 'info');
    const known = new Set(m.players.map(p => p.id));
    for (const id of [...this.remotes.keys()]) if (!known.has(id)) this.removeRemote(id);
    for (const p of m.players) if (!this.remotes.has(p.id)) this.addRemote(p);
  }
  dispose() {
    this.unsub.forEach(f => f()); this.unsub = [];
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
    this._clearGates();
    this.overlay && this.overlay.remove();
    this.player.frozen = false;
  }
  finish() {
    this.net.disconnect();
    return { mode: 'online', title: 'MUNDO ONLINE', score: this.scorer.total, lines: [['Tempo online', fmtTime(this.time)], ['Saldo', fmtN(this.wallet.money) + ' CR'], ['Nível', this.wallet.level]] };
  }

  addRemote(info) {
    if (info.id === this.me?.id || this.remotes.has(info.id)) return;
    const r = new RemoteCar(this.game, info, this.plates);
    if (this.game.audio.ctx && this.remotes.size < 6) r.engine = this.game.audio.createEngine({ spatial: true, volume: 0.7 });
    this.remotes.set(info.id, r);
  }
  removeRemote(id) { const r = this.remotes.get(id); if (r) { r.dispose(); this.remotes.delete(id); } }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    this.time += dt;
    const g = this.game, inp = g.input, v = this.player.veh;
    this.scorer.update(dt, this.player, g.world);
    g.handleScoreEvents(this.scorer);
    // send state (15 Hz)
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / LIMITS.stateHz) {
      this.sendAcc = 0;
      const ang = this.scorer.angle || 0;
      const flags = (this.player.lightsOn ? 1 : 0) | (Math.abs(ang) > 12 && v.speed > 8 ? 2 : 0) | (v.input.brake > 0.1 || v.input.handbrake ? 4 : 0) | (v.input.throttle > 0.5 ? 8 : 0);
      this.net.send({ t: 'st', x: +v.x.toFixed(2), z: +v.z.toFixed(2), h: +v.heading.toFixed(4), vx: +v.vx.toFixed(2), vz: +v.vz.toFixed(2), s: +v.steer.toFixed(2), r: v.rpm | 0, g: v.gear, f: flags });
    }
    this.updateRemotes(dt);
    this.handleKeys(inp);
    this.updateRace(dt);
    this.updateOverlay(dt);
  }
  whilePaused(dt) { this.updateRemotes(dt); this.updateOverlay(dt); this.sendAcc += dt; if (this.sendAcc > 0.5) { this.sendAcc = 0; const v = this.player.veh; this.net.send({ t: 'st', x: v.x, z: v.z, h: v.heading, vx: 0, vz: 0, s: 0, r: 900, g: v.gear, f: 0 }); } }
  updateRemotes(dt) {
    const night = this.game.env.preset?.night;
    let n = 0;
    const sorted = [...this.remotes.values()].sort((a, b) => (a.dist || 1e9) - (b.dist || 1e9));
    for (const r of sorted) {
      r.update(dt, this.game.camera, night);
      // only the closest few cars get an engine voice
      if (n++ < 5) { if (!r.engine && this.game.audio.ctx) r.engine = this.game.audio.createEngine({ spatial: true, volume: 0.7 }); }
      else if (r.engine) { this.game.audio.removeEngine(r.engine); r.engine = null; }
    }
  }
  onRespawn() { const v = this.player.veh; this.net.send({ t: 'respawn', x: v.x, z: v.z }); }

  handleKeys(inp) {
    if (this.chatOpen) return;
    if (inp.hit('KeyH')) { this.net.send({ t: 'horn' }); this.game.audio.horn(); }
    if (inp.hit('KeyJ')) { this.net.send({ t: 'flash' }); this.player.visual.headMat.opacity = 1; }
    if (inp.hit('Enter', 'NumpadEnter')) { this.openChat(); return; }
    if (inp.hit('Tab')) { this.game.pause(); this.game.ui.onlinePlayers(); return; }
    if (inp.hit('KeyM')) { this.game.pause(); this.game.ui.onlineMap(); return; }
    if (this.incoming) {
      if (inp.hit('KeyY')) this.replyChallenge(true); else if (inp.hit('KeyN')) this.replyChallenge(false);
    }
    if (this.picker) {
      for (let i = 0; i < KINDS.length; i++) if (inp.hit('Digit' + (i + 1), 'Numpad' + (i + 1))) { this.sendChallenge(this.picker.id, KINDS[i]); this.picker = null; }
      if (inp.hit('KeyG', 'Backspace')) this.picker = null;
    } else if (inp.hit('KeyG') && this.target && !this.race) this.picker = { id: this.target.id, name: this.target.info.name };
    if (this.race && inp.hit('KeyX') && (this.race.phase === 'running' || this.race.phase === 'setup' || this.race.phase === 'countdown')) this.net.send({ t: 'race_leave' });
  }
  sendChallenge(id, kind) { this.net.send({ t: 'challenge', to: id, kind }); }
  challenge(id, kind = 'sprint') { this.sendChallenge(id, kind); }
  replyChallenge(accept) { if (!this.incoming) return; this.net.send({ t: 'challenge_reply', id: this.incoming.id, accept }); this.incoming = null; }
  onChallenged(m) { this.incoming = { ...m, until: performance.now() + m.timeout * 1000 }; this.game.audio.chime('challenge'); }
  onChallengeResult(m) {
    this.outgoing = null;
    const why = { declined: `${m.name} recusou o desafio`, expired: `${m.name} não respondeu`, too_far: 'Chegue mais perto (até 80 m) para desafiar', busy: `${m.name} está ocupado`, you_busy: 'Você já está em um desafio', pending: 'Já existe um desafio pendente', blocked: 'Não é possível desafiar este jogador', cooldown: `Aguarde para desafiar ${m.name} novamente`, rate_limited: 'Muitos desafios — aguarde', not_found: 'Jogador não encontrado' };
    if (m.ok) this.note(`${m.name} aceitou! Preparando largada…`, 'race'); else this.note(why[m.reason] || 'Desafio não enviado', 'warn');
  }
  onEvent(m) {
    this.event = { ...m, at: performance.now() };
    if (!this._evNoted || this._evNoted !== m.id) { this._evNoted = m.id; this.note(`${m.label} — Pausa → Eventos para participar (${Math.round(m.startsIn / 1000)} s)`, 'race'); this.game.audio.chime('event'); }
  }
  joinEvent(leave = false) { if (this.event) this.net.send({ t: 'event_join', id: this.event.id, leave }); }

  // ------------------------------------------------------------------ races
  onRace(m) {
    const g = this.game;
    if (m.phase === 'setup') {
      this.race = { ...m, gate: 0, total: m.gates.length * m.laps, startedAt: 0, goAt: performance.now() + m.goIn };
      this.player.place(m.slot.x, m.slot.z, m.slot.h); g.rig.snap(this.player);
      this.player.frozen = true; this.picker = null;
      this.scorer = new DriftScorer();
      this._buildGates();
      g.ui.centerMsg(`${m.label.toUpperCase()}${m.rounds > 1 ? ` • RODADA ${m.round}/${m.rounds}` : ''}`, true);
      this.note(`${m.label}: ${m.routeName} • vs ${m.rivals.map(r => r.name).join(', ')}`, 'race');
      g.effects.skid.clear();
    } else if (m.phase === 'countdown') { if (this.race) this.race.goAt = performance.now() + m.goIn; }
    else if (m.phase === 'go') { if (!this.race) return; this.race.phase = 'running'; this.race.startedAt = performance.now(); this.player.frozen = false; g.ui.centerMsg('VAI!'); g.audio.ui('go'); }
    else if (m.phase === 'cp') { if (!this.race) return; this.race.gate = m.gate; g.audio.ui('score'); g.ui.popup(`CHECKPOINT ${m.gate}/${m.total}  ${fmtTime(m.ms / 1000)}`, 'zone'); this._updateGates(); }
    else if (m.phase === 'finished') { if (m.who === this.me.id) { g.ui.centerMsg('CHEGADA!', true); this._clearGates(); } else this.note(`${m.name} cruzou a chegada (${fmtTime(m.ms / 1000)})`, 'race'); }
    else if (m.phase === 'dq') { this.note('Desclassificado: ' + m.reason, 'warn'); this._clearGates(); this.player.frozen = false; }
    else if (m.phase === 'left') { if (m.who !== this.me.id) this.note(`${m.name} saiu da corrida (${m.reason === 'disconnected' ? 'desconectou' : 'abandonou'})`, 'warn'); else { this._clearGates(); this.player.frozen = false; } }
    else if (m.phase === 'round') { this.note(`Rodada ${m.round}: ${m.winner === this.me.id ? 'você venceu!' : m.winner ? 'rival venceu' : 'sem vencedor'}`, 'race'); this._clearGates(); }
    else if (m.phase === 'resume') { this.race = { ...m, phase: m.elapsed ? 'running' : 'setup', startedAt: performance.now() - m.elapsed }; this._buildGates(); this.note('Corrida retomada após reconexão', 'race'); }
    else if (m.phase === 'result') {
      this.player.frozen = false; this._clearGates();
      const r = this.race; this.race = null;
      this.lastResult = m;
      g.audio.chime(m.you && m.you.win ? 'win' : 'lose');
      g.ui.onlineRaceResult && g.ui.onlineRaceResult(m, r);
    }
  }
  updateRace() {
    const r = this.race; if (!r) return;
    if (r.phase !== 'running' && r.goAt) {
      const left = (r.goAt - performance.now()) / 1000;
      const n = Math.ceil(left);
      if (n !== this._lastCount && n <= 3 && n > 0) { this._lastCount = n; this.game.ui.centerMsg(String(n)); this.game.audio.ui('count'); }
    }
    if (this.gateMesh) { const t = performance.now() / 1000; this.gateMesh.children.forEach((c, i) => { if (c.material && c.material.opacity !== undefined && c.userData.pulse) c.material.opacity = 0.35 + Math.sin(t * 4) * 0.15; }); }
  }
  _buildGates() { this._clearGates(); this.gateMesh = new THREE.Group(); this.game.scene.add(this.gateMesh); this._updateGates(); }
  _updateGates() {
    const r = this.race; if (!r || !this.gateMesh) return;
    this.gateMesh.clear();
    const gates = r.gates; const k = r.gate % gates.length;
    const lastLap = Math.floor(r.gate / gates.length) === r.laps - 1;
    const isFinal = r.gate === r.total - 1;
    const g = gates[k], nx = gates[(k + 1) % gates.length];
    const prev = r.gate === 0 ? (r.slot || g) : gates[(k - 1 + gates.length) % gates.length];
    const dir = Math.atan2(g.x - prev.x, g.z - prev.z);
    const col = isFinal ? 0xffffff : 0x16c5b8;
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false });
    const glow = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const arch = new THREE.Group();
    const w = Math.min(g.r * 1.6, 22);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), mat); p.position.set(sx * w / 2, 3, 0); arch.add(p); }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, 0.6, 0.5), mat); top.position.y = 6; arch.add(top);
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(w, 5.6), glow); curtain.position.y = 3; curtain.userData.pulse = true; arch.add(curtain);
    if (isFinal) { const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d'); for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#fff' : '#111'; x.fillRect(i * 16, j * 16, 16, 16); } const tex = new THREE.CanvasTexture(c); const b = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.5, 1.2), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); b.position.y = 6.9; arch.add(b); }
    arch.position.set(g.x, 0, g.z); arch.rotation.y = dir;
    this.gateMesh.add(arch);
    // light beacon for the following gate
    if (!isFinal) { const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x16c5b8, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })); bm.position.set(nx.x, 30, nx.z); this.gateMesh.add(bm); }
    void lastLap;
  }
  _clearGates() { if (this.gateMesh) { this.gateMesh.removeFromParent(); this.gateMesh.traverse(o => { o.geometry && o.geometry.dispose(); }); this.gateMesh = null; } }

  // ------------------------------------------------------------------ chat
  openChat() {
    this.chatOpen = true;
    const inp = this.chatInput; inp.style.display = ''; inp.value = ''; inp.focus();
    this.game.input.keys.clear();
  }
  closeChat() { this.chatOpen = false; this.chatInput.blur(); this.chatInput.style.display = 'none'; this.game.input.keys.clear(); }
  submitChat(text) {
    text = text.trim(); if (!text) return;
    let ch = 'local', to = null, msg = text;
    const m = /^\/(g|global|c|crew|e|equipe|w|pm)\s+(.*)$/i.exec(text);
    if (m) {
      const k = m[1].toLowerCase();
      if (k === 'g' || k === 'global') { ch = 'global'; msg = m[2]; }
      else if (k === 'c' || k === 'crew' || k === 'e' || k === 'equipe') { ch = 'crew'; msg = m[2]; }
      else { const mm = /^(\S+)\s+(.*)$/.exec(m[2]); if (!mm) return; const target = [...this.remotes.values()].find(r => r.info.name.toLowerCase() === mm[1].toLowerCase()) || (this.social?.friends || []).find(f => f.username.toLowerCase() === mm[1].toLowerCase()); if (!target) return this.note('Jogador não encontrado: ' + mm[1], 'warn'); ch = 'pm'; to = target.id || target.info?.id; msg = mm[2]; }
    }
    this.net.send({ t: 'chat', ch, to, msg });
  }
  onChat(m) {
    this.chatLog.push({ ...m, at: performance.now() });
    if (this.chatLog.length > 40) this.chatLog.shift();
    if (m.from !== this.me.id) this.game.audio.chime('chat');
    this._chatDirty = true;
  }

  // ------------------------------------------------------------------ overlay (DOM)
  _buildOverlay() {
    const o = document.createElement('div'); o.id = 'mp';
    o.innerHTML = `<div class="mp-plates"></div>
      <div class="mp-notes"></div>
      <div class="mp-chat"><div class="mp-chat-log"></div><input class="mp-chat-in" maxlength="${LIMITS.chatMax}" placeholder="Mensagem (local) — /g global • /e equipe • /w nome privado" style="display:none"></div>
      <div class="mp-prompt"></div>
      <div class="mp-race"></div>
      <div class="mp-top"></div>`;
    document.getElementById('ui').appendChild(o);
    this.overlay = o;
    this.plates = o.querySelector('.mp-plates');
    this.chatInput = o.querySelector('.mp-chat-in');
    this.chatInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { this.submitChat(this.chatInput.value); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
    });
  }
  note(msg, kind = 'info') {
    this.notes.push({ msg, kind, at: performance.now() });
    if (this.notes.length > 5) this.notes.shift();
    this._notesDirty = true;
  }
  updateOverlay(dt) {
    const o = this.overlay; if (!o) return;
    const now = performance.now();
    // notifications
    const before = this.notes.length; this.notes = this.notes.filter(n => now - n.at < 7000);
    if (this._notesDirty || before !== this.notes.length) { this._notesDirty = false; o.querySelector('.mp-notes').innerHTML = this.notes.map(n => `<div class="mp-note ${n.kind}">${esc(n.msg)}</div>`).join(''); }
    // chat
    if (this._chatDirty || (this._chatT = (this._chatT || 0) - dt) < 0) {
      this._chatDirty = false; this._chatT = 1;
      const recent = this.chatLog.filter(c => this.chatOpen || now - c.at < 15000).slice(-8);
      o.querySelector('.mp-chat-log').innerHTML = recent.map(c => `<div class="mp-msg ${c.ch}"><b>${c.ch === 'pm' ? (c.from === this.me.id ? '→ ' + esc(c.toName) : '✉ ' + esc(c.name)) : c.ch === 'global' ? '[G] ' + esc(c.name) : c.ch === 'crew' ? '[E] ' + esc(c.name) : esc(c.name)}:</b> ${esc(c.msg)}</div>`).join('');
    }
    // nearest challengeable player
    let best = null, bd = LIMITS.challengeRadius;
    for (const r of this.remotes.values()) if (r.dist !== undefined && r.online && !r.info.busy) { const d = Math.hypot(r.veh.x - this.player.veh.x, r.veh.z - this.player.veh.z); if (d < bd) { bd = d; best = r; } }
    this.target = best;
    let prompt = '';
    if (this.incoming) {
      const left = Math.max(0, (this.incoming.until - now) / 1000);
      prompt = `<div class="mp-card hot"><div class="t">DESAFIO RECEBIDO</div><div class="n">${esc(this.incoming.name)} <small>nível ${this.incoming.level}</small></div><div class="k">${esc(this.incoming.label)} — ${esc(this.incoming.desc)}</div>
        <div class="bar"><i style="width:${(left / LIMITS.challengeTimeout * 100).toFixed(0)}%"></i></div><div class="keys"><span class="key">Y</span> aceitar &nbsp; <span class="key">N</span> recusar</div></div>`;
    } else if (this.picker) {
      prompt = `<div class="mp-card"><div class="t">DESAFIAR ${esc(this.picker.name)}</div>${KINDS.map((k, i) => `<div class="opt"><span class="key">${i + 1}</span> ${CHALLENGE_TYPES[k].label} <small>${CHALLENGE_TYPES[k].desc}</small></div>`).join('')}<div class="keys"><span class="key">G</span> cancelar</div></div>`;
    } else if (this.outgoing) {
      const left = Math.max(0, (this.outgoing.until - now) / 1000);
      prompt = `<div class="mp-card"><div class="t">AGUARDANDO ${esc(this.outgoing.name)}</div><div class="bar"><i style="width:${(left / LIMITS.challengeTimeout * 100).toFixed(0)}%"></i></div></div>`;
    } else if (best && !this.race) {
      prompt = `<div class="mp-hint"><span class="key">G</span> Desafiar <b>${esc(best.info.name)}</b> • ${bd.toFixed(0)} m</div>`;
    }
    if (prompt !== this._prompt) { o.querySelector('.mp-prompt').innerHTML = prompt; this._prompt = prompt; }
    // race panel
    let rh = '';
    const r = this.race;
    if (r) {
      const el = r.startedAt ? (now - r.startedAt) / 1000 : 0;
      rh = `<div class="mp-racebox"><div class="l">${esc(r.label)}${r.rounds > 1 ? ` • ${r.round}/${r.rounds}` : ''}</div><div class="v">${fmtTime(el)}</div><div class="l">Checkpoint ${r.gate}/${r.total}${r.scoring !== 'time' ? ` • ${fmtN(this.scorer.total + this.scorer.chain * this.scorer.mult)} pts (servidor decide)` : ''}</div><div class="l small"><span class="key">X</span> abandonar</div></div>`;
    }
    if (rh !== this._rh) { o.querySelector('.mp-race').innerHTML = rh; this._rh = rh; }
    // top status
    const ping = this.net.rtt | 0, region = REGIONS.find(x => x.id === regionAt(this.player.veh.x, this.player.veh.z));
    const conn = this.net.connected ? `<i class="dot on"></i>${ping} ms` : `<i class="dot"></i>${this.kicked ? esc(this.kicked) : 'reconectando…'}`;
    const top = `${conn} • ${(this.roomSize || this.remotes.size + 1)} online • ${region ? region.name : 'Fora da estrada'}`;
    if (top !== this._top) { o.querySelector('.mp-top').innerHTML = top; this._top = top; }
  }

  hud() {
    const lvl = this.wallet.level;
    return {
      score: this.race ? null : this.scorer,
      boxes: [{ l: 'Créditos', v: fmtN(this.wallet.money) + ' CR' }, { l: 'Nível', v: lvl }],
    };
  }
  // minimap extras
  mapOthers() {
    const out = [];
    for (const r of this.remotes.values()) out.push({ x: r.veh.x, z: r.veh.z, color: r.info.crewId && r.info.crewId === this.me.crewId ? '#3bff7a' : '#ffc940' });
    if (this.far) for (const f of this.far) out.push({ x: f[1], z: f[2], color: f[3] ? '#3bff7a' : '#ff9c40' });
    if (this.race && this.race.gates) { const g = this.race.gates[this.race.gate % this.race.gates.length]; out.push({ x: g.x, z: g.z, color: '#ffffff' }); }
    return out;
  }
}
export { POIS, CAR_PRICES, carById };
