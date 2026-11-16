// =====================================================================
//  Online screens, mixed into the UI class (same festival look):
//  login/register, lobby (servers, profile, garage/shop, rankings),
//  online pause menu, players, friends & crew, public profiles,
//  world map, events, race results.
// =====================================================================
import { CARS, carById, CLASS_COLORS } from '../car/cars.js';
import { CAR_PRICES, POIS, REGIONS, xpForLevel, CHALLENGE_TYPES } from '../net/shared.js';
import { fmtTime } from '../modes/modes.js';
import { esc } from '../net/remote.js';

const fmtN = n => Math.round(n || 0).toLocaleString('pt-BR');
const scr = (inner, w = 980) => `<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel mp-panel" style="width:${w}px">${inner}</div></div>`;
const ACH = { first_win: 'Primeira vitória', ten_wins: '10 vitórias', level_5: 'Nível 5', drift_10k: 'Drift de 10 mil', first_purchase: 'Primeira compra' };

export function installOnlineUi(UI) {
  const P = UI.prototype;

  // ------------------------------------------------------------------ entry
  P.onlineHub = async function () {
    const g = this.game, net = g.net;
    this.show(scr(`<h1>Online</h1><div class="desc">Procurando servidor…</div>`, 640), { back: () => this.mainMenu('online') });
    const info = await net.detect();
    if (!info) return this.onlineNoServer();
    if (!net.loggedIn) return this.onlineLogin();
    try { await net.me(); } catch (e) { if (e.status === 401) return this.onlineLogin(); return this.onlineNoServer(e.message); }
    this.onlineLobby();
  };
  P.onlineNoServer = function (err) {
    const net = this.game.net;
    this.show(scr(`<h1>Servidor indisponível</h1>
      <div class="desc">Não foi possível conectar ao servidor multiplayer${err ? ` (${esc(err)})` : ''}.<br>Inicie <b>INICIAR_SERVIDOR_ONLINE.bat</b> neste PC (ou peça o endereço do servidor ao organizador) e tente novamente.</div>
      <div class="row"><label>Endereço do servidor</label><input id="mp-srv" class="mp-in" value="${esc(net.base)}" spellcheck="false"></div>
      <div class="btns"><button class="btn" data-nav data-action="main">Voltar</button><button class="btn primary" data-nav id="mp-retry">Tentar novamente</button></div>`, 720), { back: () => this.mainMenu('online'), focus: 1 });
    this.screen.querySelector('#mp-retry').onclick = () => { net.setServer(this.screen.querySelector('#mp-srv').value.trim()); this.onlineHub(); };
  };
  P.onlineLogin = function (mode = 'login', msg = '') {
    const net = this.game.net;
    this.show(scr(`<div class="desc" style="letter-spacing:.3em;margin:0">${esc(net.info?.name || 'SERVIDOR')} • ${esc(net.info?.region || '')}</div>
      <h1>${mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
      <div class="desc">Sua conta guarda carros, dinheiro, reputação, amigos e recordes no servidor.</div>
      <form id="mp-form" autocomplete="on">
        <div class="row"><label>Usuário</label><input id="mp-user" class="mp-in" maxlength="16" autocomplete="username" spellcheck="false" placeholder="3–16 letras/números"></div>
        <div class="row"><label>Senha</label><input id="mp-pass" class="mp-in" type="password" maxlength="128" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" placeholder="mínimo 8 caracteres"></div>
        ${mode === 'register' ? '<div class="row"><label>Confirmar senha</label><input id="mp-pass2" class="mp-in" type="password" maxlength="128" autocomplete="new-password"></div>' : ''}
        <div class="mp-err">${esc(msg)}</div>
        <div class="btns"><button type="button" class="btn" data-nav id="mp-switch">${mode === 'login' ? 'Criar conta' : 'Já tenho conta'}</button><button type="submit" class="btn primary" data-nav id="mp-go">${mode === 'login' ? 'Entrar' : 'Criar e entrar'}</button></div>
      </form>
      <div class="desc small">Servidor: ${esc(net.base)} • <a href="#" id="mp-chsrv">trocar</a></div>`, 640), { back: () => this.mainMenu('online'), focus: 1 });
    const $ = s => this.screen.querySelector(s);
    setTimeout(() => $('#mp-user') && $('#mp-user').focus(), 50);
    $('#mp-switch').onclick = () => this.onlineLogin(mode === 'login' ? 'register' : 'login');
    $('#mp-chsrv').onclick = (e) => { e.preventDefault(); this.onlineNoServer(); };
    const submit = async (e) => {
      e && e.preventDefault();
      const u = $('#mp-user').value.trim(), p = $('#mp-pass').value;
      if (mode === 'register' && p !== $('#mp-pass2').value) { $('.mp-err').textContent = 'As senhas não conferem'; return; }
      $('.mp-err').textContent = 'Aguarde…';
      try { if (mode === 'login') await net.login(u, p); else await net.register(u, p); this.onlineLobby(); }
      catch (err) { $('.mp-err').textContent = err.message; }
    };
    $('#mp-form').onsubmit = submit; $('#mp-go').onclick = submit;
  };

  // ------------------------------------------------------------------ lobby
  P.onlineLobby = async function () {
    const g = this.game, net = g.net, pr = net.profile;
    let servers = { rooms: [] };
    try { servers = await net.api('/api/servers'); } catch { }
    const next = xpForLevel(pr.level + 1), cur = xpForLevel(pr.level);
    const rooms = servers.rooms.map(r => `<div class="mp-room" data-nav data-action="mpJoin" data-arg="${esc(r.id)}"><b>${esc(r.name)}</b><span>${r.players}/${r.capacity} pilotos</span><i>${esc(r.region)}</i></div>`).join('') || '<div class="desc">Nenhuma sala aberta: uma será criada ao entrar.</div>';
    this.show(scr(`<div class="mp-lobby-top"><div class="avatar" style="background:${esc(pr.avatar)}">${esc(pr.username.slice(0, 2).toUpperCase())}</div>
        <div><div class="pn">${esc(pr.username)}${pr.crew ? ` <small>[${esc(pr.crew.name)}]</small>` : ''}</div><div class="lv">Nível ${pr.level} • ${fmtN(pr.rep)} REP • ${fmtN(pr.money)} CR</div>
        <div class="xpbar"><i style="width:${Math.min(100, (pr.xp - cur) / Math.max(1, next - cur) * 100).toFixed(0)}%"></i></div></div>
        <div class="mp-stats"><span>Vitórias <b>${pr.wins}</b></span><span>Derrotas <b>${pr.losses}</b></span><span>Corridas <b>${pr.races}</b></span><span>Melhor drift <b>${fmtN(pr.best_drift)}</b></span></div></div>
      <div class="mp-cols">
        <div><h2>Mundo aberto</h2>
          <button class="btn primary big" data-nav data-action="mpJoin" data-arg="">Entrar no mundo (matchmaking)</button>
          <h2 style="margin-top:16px">Salas — ${esc(servers.name || '')} (${esc(servers.region || '')})</h2><div class="mp-rooms">${rooms}</div>
          <div class="row"><label>Sala privada (código)</label><input id="mp-code" class="mp-in" maxlength="12" placeholder="opcional" spellcheck="false"></div></div>
        <div><h2>Conta</h2>
          <button class="btn" data-nav data-action="mpGarage">Garagem online e concessionária</button>
          <button class="btn" data-nav data-action="mpBoard" data-arg="all">Ranking global</button>
          <button class="btn" data-nav data-action="mpBoard" data-arg="week">Ranking semanal</button>
          <button class="btn" data-nav data-action="mpMyProfile">Meu perfil e histórico</button>
          <button class="btn" data-nav data-action="mpLogout">Sair da conta</button>
          <button class="btn" data-nav data-action="main">Voltar ao menu</button></div>
      </div>
      <div class="desc small">Carro ativo online: <b>${esc(carById(pr.active_car).make)} ${esc(carById(pr.active_car).short)}</b> • Pings e corridas são validados pelo servidor.</div>`, 1100), { back: () => this.mainMenu('online') });
  };
  P.onlineGarage = async function (msg = '') {
    const g = this.game, net = g.net;
    let pr; try { pr = await net.me(); } catch (e) { return this.onlineHub(); }
    const owned = new Set(pr.cars.map(c => c.id));
    const cards = CARS.map(c => {
      const price = CAR_PRICES[c.id] ?? null, own = owned.has(c.id), active = pr.active_car === c.id;
      const thumb = g.carThumb(c.id);
      return `<div class="mp-car ${active ? 'active' : ''}"><div class="th">${thumb ? `<img src="${thumb}">` : ''}</div>
        <div class="cls"><b style="background:${CLASS_COLORS[c.cls]}">${c.cls}</b><i>${c.pi}</i></div><div class="nm">${c.year} ${esc(c.make)} <b>${esc(c.short)}</b></div>
        ${active ? '<div class="tag">ATIVO</div>' : own ? `<button class="btn" data-nav data-action="mpUseCar" data-arg="${c.id}">Usar online</button>` : price === null ? '<div class="desc">Indisponível online</div>' : `<button class="btn ${pr.money >= price ? 'primary' : ''}" data-nav data-action="mpBuy" data-arg="${c.id}">Comprar • ${fmtN(price)} CR</button>`}</div>`;
    }).join('');
    this.show(scr(`<h1>Garagem online</h1><div class="desc">Saldo: <b>${fmtN(pr.money)} CR</b> • A propriedade dos carros e a pintura são salvas no servidor e vistas pelos outros jogadores. A pintura/rodas usadas online são as da sua garagem local para o carro escolhido.</div>
      <div class="mp-err">${esc(msg)}</div><div class="mp-cars">${cards}</div>
      <div class="btns"><button class="btn primary" data-nav data-action="mpLobby">Voltar</button></div>`, 1150), { back: () => this.onlineLobby() });
  };
  P.onlineBoard = async function (period = 'all') {
    let d = { rows: [] }; try { d = await this.game.net.api('/api/leaderboard?period=' + period); } catch { }
    const rows = d.rows.map((r, i) => `<tr class="${r.id === this.game.net.profile?.id ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.username)}</td><td>${fmtN(r.rep)}</td><td>${period === 'week' ? fmtN(r.money) + ' CR' : 'Nv ' + r.level}</td><td>${period === 'week' ? r.events : r.wins + '/' + r.races}</td></tr>`).join('');
    this.show(scr(`<h1>Ranking ${period === 'week' ? 'semanal' : 'global'}</h1><div class="desc">Calculado no servidor a partir das recompensas validadas.</div>
      <table class="t"><tr><th>#</th><th>Piloto</th><th>Reputação</th><th>${period === 'week' ? 'Ganhos' : 'Nível'}</th><th>${period === 'week' ? 'Eventos' : 'Vitórias/Corridas'}</th></tr>${rows || '<tr><td colspan=5>Sem dados ainda</td></tr>'}</table>
      <div class="btns"><button class="btn primary" data-nav data-action="${this.game.state === 'paused' ? 'mpPause' : 'mpLobby'}">Voltar</button></div>`, 820), { back: () => this.game.state === 'paused' ? this.onlinePause() : this.onlineLobby() });
  };
  P.onlineMyProfile = async function () {
    const net = this.game.net;
    let h = { rows: [], tx: [] }, pr = net.profile; try { [h, pr] = await Promise.all([net.api('/api/history'), net.me()]); } catch { }
    this.show(scr(`<h1>${esc(pr.username)}</h1><div class="desc">Nível ${pr.level} • ${fmtN(pr.xp)} XP • ${fmtN(pr.rep)} REP • ${fmtN(pr.money)} CR • desde ${new Date(pr.created_at).toLocaleDateString('pt-BR')}</div>
      <div class="statgrid"><div class="stat"><span>Vitórias</span><b>${pr.wins}</b></div><div class="stat"><span>Derrotas</span><b>${pr.losses}</b></div><div class="stat"><span>Corridas</span><b>${pr.races}</b></div><div class="stat"><span>Drift total</span><b>${fmtN(pr.drift_total)}</b></div><div class="stat"><span>Melhor drift</span><b>${fmtN(pr.best_drift)}</b></div><div class="stat"><span>Distância</span><b>${(pr.distance / 1000).toFixed(1)} km</b></div></div>
      <h2>Conquistas</h2><div class="desc">${pr.achievements.length ? pr.achievements.map(a => `<span class="tag">${esc(ACH[a.code] || a.code)}</span>`).join(' ') : 'Nenhuma ainda'}</div>
      <h2>Corridas recentes</h2><table class="t"><tr><th>Tipo</th><th>Posição</th><th>Tempo / pontos</th><th>Status</th><th>Data</th></tr>${h.rows.slice(0, 10).map(r => `<tr><td>${esc(CHALLENGE_TYPES[r.kind]?.label || r.kind)}</td><td>${r.place ?? '-'}</td><td>${r.time_ms ? fmtTime(r.time_ms / 1000) : fmtN(r.score)}</td><td>${esc(r.status)}</td><td>${new Date(r.created_at).toLocaleString('pt-BR')}</td></tr>`).join('') || '<tr><td colspan=5>—</td></tr>'}</table>
      <h2>Extrato</h2><table class="t"><tr><th>Valor</th><th>Saldo</th><th>Origem</th><th>Data</th></tr>${h.tx.slice(0, 8).map(t => `<tr><td>${t.amount > 0 ? '+' : ''}${fmtN(t.amount)}</td><td>${fmtN(t.balance)}</td><td>${esc(t.kind)}</td><td>${new Date(t.created_at).toLocaleString('pt-BR')}</td></tr>`).join('')}</table>
      <div class="btns"><button class="btn primary" data-nav data-action="${this.game.state === 'paused' ? 'mpPause' : 'mpLobby'}">Voltar</button></div>`, 1000), { back: () => this.game.state === 'paused' ? this.onlinePause() : this.onlineLobby() });
  };

  // ------------------------------------------------------------------ in-world menus (game paused locally, world keeps running)
  P.onlinePause = function () {
    const m = this.game.mode, ev = m.event && (m.event.startsIn - (performance.now() - m.event.at)) > 0 ? m.event : null;
    const joined = ev && ev.joined.includes(m.me.id);
    this.show(scr(`<h1>Mundo online</h1><div class="desc">${esc(this.game.net.room || '')} • o mundo continua rodando enquanto este menu está aberto</div>
      <div class="menu-list" style="margin-top:10px">
        <button class="mbtn" data-nav data-action="resume">Continuar</button>
        ${ev ? `<button class="mbtn hot" data-nav data-action="mpEvent">${joined ? 'Sair do evento' : 'Participar'}: ${esc(ev.label)} (${Math.round((ev.startsIn - (performance.now() - m.event.at)) / 1000)} s • ${ev.joined.length} inscritos)</button>` : ''}
        <button class="mbtn" data-nav data-action="mpMap">Mapa</button>
        <button class="mbtn" data-nav data-action="mpPlayers">Jogadores (${m.remotes.size + 1})</button>
        <button class="mbtn" data-nav data-action="mpFriends">Amigos e equipe${m.pendingFriend || m.crewInvite ? ' •' : ''}</button>
        <button class="mbtn" data-nav data-action="mpPauseGarage">Garagem (trocar carro)</button>
        <button class="mbtn" data-nav data-action="mpMyProfile">Estatísticas</button>
        <button class="mbtn" data-nav data-action="mpBoard" data-arg="all">Ranking</button>
        <button class="mbtn" data-nav data-action="pauseSettings">Configurações</button>
        <button class="mbtn" data-nav data-action="pauseHelp">Controles</button>
        <button class="mbtn" data-nav data-action="quit">Sair do mundo</button>
      </div>`, 520), { back: () => this.game.resume() });
  };
  P.onlinePlayers = function () {
    const m = this.game.mode, me = m.player.veh;
    const rows = [...m.remotes.values()].sort((a, b) => (a.dist || 0) - (b.dist || 0)).map(r => {
      const d = Math.hypot(r.veh.x - me.x, r.veh.z - me.z), c = carById(r.info.car);
      return `<div class="mp-pl" data-nav data-action="mpProfile" data-arg="${r.id}"><b style="background:${esc(r.info.avatar || '#16c5b8')}">${r.info.level}</b><span class="n">${esc(r.info.name)}${r.info.crew ? ` <small>[${esc(r.info.crew)}]</small>` : ''}</span><span>${esc(c.short)}</span><span>${d.toFixed(0)} m</span><span class="${r.online ? 'on' : 'off'}">${r.online ? (r.info.busy ? 'em corrida' : 'online') : 'reconectando'}</span></div>`;
    }).join('');
    const far = (m.far || []).length;
    this.show(scr(`<h1>Jogadores na sala</h1><div class="desc">Você + ${m.remotes.size} por perto${far ? ` • ${far} mais longe (no mapa)` : ''}. Selecione para ver o perfil, adicionar amigo, desafiar, bloquear ou denunciar.</div>
      <div class="mp-pls">${rows || '<div class="desc">Ninguém por perto no momento. Abra o mapa para encontrar pilotos.</div>'}</div>
      <div class="btns"><button class="btn primary" data-nav data-action="mpPause">Voltar</button></div>`, 900), { back: () => this.onlinePause() });
  };
  P.onlineProfile = function (id) {
    this._profileFor = +id;
    this.show(scr(`<h1>Perfil</h1><div class="desc">Carregando…</div>`, 720), { back: () => this.onlinePlayers() });
    this.game.net.send({ t: 'profile', id: +id });
  };
  P.onlineProfileUpdate = function (msg) {
    if (!this.screen || !this._profileFor || this.game.state !== 'paused') return;
    const p = msg.profile; if (!p || p.id !== this._profileFor) return;
    const m = this.game.mode, near = m.remotes.get(p.id), d = near ? Math.hypot(near.veh.x - m.player.veh.x, near.veh.z - m.player.veh.z) : null;
    const c = carById(p.active_car);
    this.show(scr(`<div class="mp-lobby-top"><div class="avatar" style="background:${esc(p.avatar)}">${esc(p.username.slice(0, 2).toUpperCase())}</div><div><div class="pn">${esc(p.username)}${p.crew ? ` <small>[${esc(p.crew.name)}]</small>` : ''}</div>
      <div class="lv">Nível ${p.level} • ${fmtN(p.rep)} REP • ${p.online ? 'online' : 'offline'}${d !== null ? ` • ${d.toFixed(0)} m` : ''}</div></div>
      <div class="mp-stats"><span>Vitórias <b>${p.wins}</b></span><span>Derrotas <b>${p.losses}</b></span><span>Corridas <b>${p.races}</b></span><span>Melhor drift <b>${fmtN(p.best_drift)}</b></span></div></div>
      <div class="desc">Carro: <b>${esc(c.make)} ${esc(c.model)}</b> • Garagem: ${p.cars.map(x => esc(carById(x.id).short)).join(', ')}</div>
      <div class="desc">${p.achievements.map(a => `<span class="tag">${esc(ACH[a.code] || a.code)}</span>`).join(' ')}</div>
      <div class="menu-list">
        ${near && d < 80 ? `<button class="mbtn hot" data-nav data-action="mpChallenge" data-arg="${p.id}">Desafiar para corrida (Sprint)</button>` : `<button class="mbtn" disabled>Desafiar (chegue a menos de 80 m)</button>`}
        ${p.friend === 'accepted' ? `<button class="mbtn" data-nav data-action="mpFriendOp" data-arg="remove:${p.id}">Remover amigo</button>` : p.friend === 'pending' ? `<button class="mbtn" disabled>Pedido de amizade pendente</button>` : `<button class="mbtn" data-nav data-action="mpFriendOp" data-arg="request:${p.id}">Adicionar amigo</button>`}
        <button class="mbtn" data-nav data-action="mpCrewInvite" data-arg="${p.id}">Convidar para minha equipe</button>
        <button class="mbtn" data-nav data-action="mpPm" data-arg="${esc(p.username)}">Mensagem privada</button>
        <button class="mbtn" data-nav data-action="mpBlock" data-arg="${p.blocked ? 'off' : 'on'}:${p.id}">${p.blocked ? 'Desbloquear' : 'Bloquear'}</button>
        <button class="mbtn" data-nav data-action="mpReport" data-arg="${p.id}">Denunciar</button>
        <button class="mbtn" data-nav data-action="mpPlayers">Voltar</button>
      </div>`, 820), { back: () => this.onlinePlayers() });
  };
  P.onlineFriends = function () {
    this._socialOpen = true;
    this.game.net.send({ t: 'friends' });
    const m = this.game.mode;
    this.onlineSocialUpdate(m.social || { friends: [], recent: [], crew: null, blocked: [] });
  };
  P.onlineSocialUpdate = function (s) {
    if (!this._socialOpen || this.game.state !== 'paused' || !this.screen) return;
    const m = this.game.mode;
    const fr = s.friends.map(f => `<div class="mp-pl"><span class="n">${esc(f.username)}</span><span>${f.status === 'accepted' ? (f.online ? `<i class="dot on"></i>online${f.room === this.game.net.room ? ' • nesta sala' : ''}` : 'offline') : f.dir === 'in' ? 'quer ser seu amigo' : 'pedido enviado'}</span>
      ${f.status === 'pending' && f.dir === 'in' ? `<button class="btn primary" data-nav data-action="mpFriendOp" data-arg="accept:${f.id}">Aceitar</button><button class="btn" data-nav data-action="mpFriendOp" data-arg="decline:${f.id}">Recusar</button>` : `<button class="btn" data-nav data-action="mpProfile" data-arg="${f.id}">Perfil</button>`}</div>`).join('');
    const crew = s.crew ? `<h2>Equipe: ${esc(s.crew.name)}</h2>${s.crew.members.map(x => `<div class="mp-pl"><span class="n">${esc(x.username)}${x.id === s.crew.leader ? ' ★ líder' : ''}</span><span>${x.online ? '<i class="dot on"></i>online' : 'offline'}</span>${s.crew.leader === m.me.id && x.id !== m.me.id ? `<button class="btn" data-nav data-action="mpCrewKick" data-arg="${x.id}">Expulsar</button>` : ''}</div>`).join('')}<button class="btn" data-nav data-action="mpCrewLeave">Sair da equipe</button>`
      : `<h2>Equipe</h2><div class="row"><label>Nome da nova equipe</label><input id="mp-crew" class="mp-in" maxlength="16"></div><button class="btn" data-nav id="mp-crew-new">Criar equipe</button>`;
    const inv = m.crewInvite ? `<div class="mp-card hot inline">Convite de <b>${esc(m.crewInvite.fromName)}</b> para a equipe <b>${esc(m.crewInvite.name)}</b> <button class="btn primary" data-nav data-action="mpCrewAccept">Aceitar</button></div>` : '';
    const recent = s.recent.slice(0, 8).map(r => `<div class="mp-pl" data-nav data-action="mpProfile" data-arg="${r.id}"><span class="n">${esc(r.username)}</span><span>${new Date(r.seen_at).toLocaleString('pt-BR')}</span></div>`).join('');
    this.show(scr(`<h1>Amigos e equipe</h1>${inv}<div class="mp-cols"><div><h2>Amigos</h2>${fr || '<div class="desc">Adicione amigos pelo perfil de um jogador (TAB).</div>'}<h2>Jogadores recentes</h2>${recent || '<div class="desc">—</div>'}</div><div>${crew}<div class="desc small">Membros da equipe aparecem em verde no mapa e no radar. Chat da equipe: <b>/e mensagem</b></div></div></div>
      <div class="btns"><button class="btn primary" data-nav data-action="mpPause">Voltar</button></div>`, 1000), { back: () => { this._socialOpen = false; this.onlinePause(); } });
    const nb = this.screen.querySelector('#mp-crew-new');
    if (nb) nb.onclick = () => { const n = this.screen.querySelector('#mp-crew').value.trim(); if (n) this.game.net.send({ t: 'crew', op: 'create', name: n }); };
  };
  P.onlineMap = function () {
    this.show(scr(`<h1>Mapa</h1><canvas id="mp-map" width="1100" height="640" style="width:100%;border-radius:8px;background:#0c1a1f"></canvas>
      <div class="mp-legend"><span><i style="background:#16c5b8"></i>Você</span><span><i style="background:#ffc940"></i>Pilotos</span><span><i style="background:#3bff7a"></i>Equipe</span><span><i style="background:#ff4dd2"></i>Amigos</span><span><i style="background:#ffffff"></i>Pontos de interesse</span></div>
      <div class="btns"><button class="btn primary" data-nav data-action="mpPause">Voltar</button></div>`, 1180), { back: () => this.onlinePause() });
    const draw = () => { if (!this.screen || !this.screen.querySelector('#mp-map')) return; drawWorldMap(this.screen.querySelector('#mp-map'), this.game); this._mapRaf = requestAnimationFrame(draw); };
    draw();
  };
  P.onlinePauseGarage = async function () {
    const g = this.game, net = g.net;
    let pr; try { pr = await net.me(); } catch { return this.onlinePause(); }
    const items = pr.cars.map(c => `<button class="mbtn ${pr.active_car === c.id ? 'hot' : ''}" data-nav data-action="mpUseCarLive" data-arg="${c.id}">${esc(carById(c.id).make)} ${esc(carById(c.id).short)}${pr.active_car === c.id ? ' • ATIVO' : ''}</button>`).join('');
    this.show(scr(`<h1>Trocar carro</h1><div class="desc">Somente carros que você possui. Compre novos na concessionária (lobby online).</div><div class="menu-list">${items}<button class="mbtn" data-nav data-action="mpPause">Voltar</button></div>`, 560), { back: () => this.onlinePause() });
  };
  P.onlineRaceResult = function (m) {
    const you = m.you || {};
    const rows = m.results.map(r => `<tr class="${r.id === this.game.mode.me.id ? 'me' : ''}"><td>${r.place}</td><td>${esc(r.name)}</td><td>${r.status === 'finished' ? (m.scoring === 'time' ? fmtTime(r.ms / 1000) : fmtN(r.score) + ' pts') : { dnf: 'não terminou', dq: 'desclassificado' }[r.status] || r.status}</td>${m.kind === 'bo3' ? `<td>${r.wins} rodadas</td>` : ''}<td>${r.reward ? `+${fmtN(r.reward.money)} CR / +${r.reward.xp} XP / +${r.reward.rep} REP` : '—'}</td></tr>`).join('');
    const el = document.createElement('div'); el.className = 'mp-result ' + (you.win ? 'win' : 'lose');
    el.innerHTML = `<div class="t">${you.win ? 'VITÓRIA' : 'DERROTA'}</div><div class="k">${esc(m.label)} • resultado validado pelo servidor</div><table class="t">${rows}</table><div class="desc small">Continue dirigindo — fecha em 10 s</div>`;
    document.getElementById('mp')?.appendChild(el);
    setTimeout(() => el.remove(), 10000);
  };

  // ------------------------------------------------------------------ actions
  const A = Object.getOwnPropertyDescriptor(P, 'actions').get;
  Object.defineProperty(P, 'actions', {
    get() {
      const g = this.game, net = g.net, base = A.call(this);
      return Object.assign(base, {
        online: () => this.onlineHub(),
        mpLobby: () => this.onlineLobby(),
        mpJoin: (room) => { const code = this.screen?.querySelector('#mp-code')?.value.trim(); g.goOnline(room || code || null); },
        mpGarage: () => this.onlineGarage(),
        mpBoard: (p) => this.onlineBoard(p),
        mpMyProfile: () => this.onlineMyProfile(),
        mpLogout: async () => { await net.logout(); this.mainMenu('online'); },
        mpBuy: async (id) => { try { await net.api('/api/buy', { car: id }); g.audio.ui('medal'); this.onlineGarage(`${carById(id).short} comprado!`); } catch (e) { this.onlineGarage(e.message); } },
        mpUseCar: async (id) => { try { await g.syncOnlineCar(id); this.onlineGarage(`${carById(id).short} ativo online`); } catch (e) { this.onlineGarage(e.message); } },
        mpUseCarLive: async (id) => { try { await g.syncOnlineCar(id, true); this.toast(`${carById(id).short} ativo`); g.resume(); } catch (e) { this.toast(e.message, 3000); } },
        mpPause: () => { this._socialOpen = false; this._profileFor = null; cancelAnimationFrame(this._mapRaf); this.onlinePause(); },
        mpPauseGarage: () => this.onlinePauseGarage(),
        mpMap: () => this.onlineMap(),
        mpPlayers: () => { this._profileFor = null; this.onlinePlayers(); },
        mpFriends: () => this.onlineFriends(),
        mpProfile: (id) => { this._socialOpen = false; this.onlineProfile(id); },
        mpChallenge: (id) => { g.mode.challenge(+id, 'sprint'); g.resume(); },
        mpFriendOp: (arg) => { const [op, id] = arg.split(':'); net.send({ t: 'friend', op, id: +id }); if (this._profileFor) setTimeout(() => net.send({ t: 'profile', id: this._profileFor }), 300); },
        mpBlock: (arg) => { const [on, id] = arg.split(':'); net.send({ t: 'block', id: +id, on: on === 'on' }); setTimeout(() => net.send({ t: 'profile', id: +id }), 300); },
        mpReport: (id) => { const reason = prompt('Motivo da denúncia (comportamento, nome ofensivo, trapaça…):'); if (reason) net.send({ t: 'report', id: +id, reason }); },
        mpPm: (name) => { g.resume(); setTimeout(() => { g.mode.openChat(); g.mode.chatInput.value = `/w ${name} `; }, 50); },
        mpCrewInvite: (id) => net.send({ t: 'crew', op: 'invite', id: +id }),
        mpCrewAccept: () => { net.send({ t: 'crew', op: 'accept' }); g.mode.crewInvite = null; },
        mpCrewLeave: () => net.send({ t: 'crew', op: 'leave' }),
        mpCrewKick: (id) => net.send({ t: 'crew', op: 'kick', id: +id }),
        mpEvent: () => { const m = g.mode; const joined = m.event.joined.includes(m.me.id); m.joinEvent(joined); g.resume(); },
      });
    }, configurable: true,
  });
}

// world map (all regions) with players, friends, crew, POIs, event route
function drawWorldMap(cv, game) {
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, m = game.mode;
  const x0 = -340, x1 = 800, z0 = -320, z1 = 340;
  const s = Math.min(W / (x1 - x0), H / (z1 - z0));
  const tx = x => (x - x0) * s + (W - (x1 - x0) * s) / 2, tz = z => (z - z0) * s + (H - (z1 - z0) * s) / 2;
  g.clearRect(0, 0, W, H);
  // regions
  for (const r of REGIONS) { g.fillStyle = 'rgba(22,197,184,0.06)'; g.fillRect(tx(r.x0), tz(r.z0), (r.x1 - r.x0) * s, (r.z1 - r.z0) * s); g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '600 13px sans-serif'; g.fillText(r.name.toUpperCase(), tx(r.x0) + 6, tz(r.z0) + 16); }
  // circuit
  const t = game.world.track; g.strokeStyle = '#3a4a52'; g.lineWidth = 9; g.beginPath();
  for (let i = 0; i <= t.N; i += 4) { const k = i % t.N; i ? g.lineTo(tx(t.x[k]), tz(t.z[k])) : g.moveTo(tx(t.x[k]), tz(t.z[k])); } g.stroke();
  // access road + park
  g.strokeStyle = '#3a4a52'; g.lineWidth = 7; g.beginPath(); g.moveTo(tx(130), tz(250)); g.lineTo(tx(704), tz(250)); g.lineTo(tx(700), tz(110)); g.stroke();
  const pk = game.world.park;
  if (pk && pk.surf) { g.fillStyle = '#3a4a52'; const step = 6; for (let j = 0; j < pk.gh; j += step) for (let i = 0; i < pk.gw; i += step) if (pk.surf[j * pk.gw + i]) g.fillRect(tx(pk.gx0 + 600 + i * 0.4), tz(pk.gz0 + j * 0.4), Math.max(1, step * 0.4 * s), Math.max(1, step * 0.4 * s)); }
  // POIs
  g.font = '12px sans-serif';
  for (const p of POIS) { g.fillStyle = '#fff'; g.beginPath(); g.arc(tx(p.x), tz(p.z), 4, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.75)'; g.fillText(p.name, tx(p.x) + 7, tz(p.z) - 6); }
  if (!m || !m.remotes) return;
  const friends = new Set((m.social?.friends || []).filter(f => f.status === 'accepted').map(f => f.id));
  const dot = (x, z, c, r = 5, label) => { g.fillStyle = c; g.beginPath(); g.arc(tx(x), tz(z), r, 0, 7); g.fill(); if (label) { g.fillStyle = c; g.font = '600 12px sans-serif'; g.fillText(label, tx(x) + 8, tz(z) + 4); } };
  if (m.far) for (const f of m.far) dot(f[1], f[2], friends.has(f[0]) ? '#ff4dd2' : f[3] ? '#3bff7a' : '#ffc940', 4);
  for (const r of m.remotes.values()) dot(r.veh.x, r.veh.z, friends.has(r.id) ? '#ff4dd2' : r.info.crewId && r.info.crewId === m.me.crewId ? '#3bff7a' : '#ffc940', 5, r.info.name);
  if (m.race && m.race.gates) { g.strokeStyle = '#fff'; g.setLineDash([6, 6]); g.beginPath(); m.race.gates.forEach((q, i) => i ? g.lineTo(tx(q.x), tz(q.z)) : g.moveTo(tx(q.x), tz(q.z))); g.stroke(); g.setLineDash([]); }
  const v = m.player.veh; dot(v.x, v.z, '#16c5b8', 7, 'VOCÊ');
}
