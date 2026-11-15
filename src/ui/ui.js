// =====================================================================
//  UI: menus (keyboard/mouse/gamepad navigation), HUD, popups, results
// =====================================================================
import { CHALLENGES, fmtTime } from '../modes/modes.js';
import { QUALITY } from '../core/renderer.js';
import { TIMES } from '../world/environment.js';
import { AI_LEVELS } from '../car/ai.js';
import { CAM_LABELS } from '../core/camera.js';
import { CARS, carById, CLASS_COLORS } from '../car/cars.js';

const $ = (sel, root = document) => root.querySelector(sel);
const fmtN = n => Math.round(n).toLocaleString('pt-BR');


// simple line icons for the hub tiles
const svg = (body, vb = '0 0 100 100') => `<svg class="ico" viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,.9)">${body}</svg>`;
const ICONS = {
  drift: svg('<path d="M14 62 L24 44 Q30 36 42 35 L64 34 Q74 34 80 42 L88 52 L88 64 L14 64 Z"/><circle cx="30" cy="66" r="8"/><circle cx="72" cy="66" r="8"/><path d="M40 36 L46 26 L64 26 L70 35"/><path d="M4 80 Q20 74 34 82 T64 82 T96 78" stroke-width="3" opacity=".7"/><path d="M2 70 Q8 66 14 70" stroke-width="3" opacity=".6"/>'),
  trophy: svg('<path d="M30 16 H70 V36 Q70 58 50 60 Q30 58 30 36 Z"/><path d="M30 22 H16 Q16 42 32 44"/><path d="M70 22 H84 Q84 42 68 44"/><path d="M50 60 V74"/><path d="M34 84 H66 L62 74 H38 Z"/>'),
  tandem: svg('<path d="M8 50 L18 38 H38 L46 50 Z"/><circle cx="18" cy="52" r="5"/><circle cx="38" cy="52" r="5"/><path d="M52 70 L62 58 H82 L90 70 Z"/><circle cx="62" cy="72" r="5"/><circle cx="82" cy="72" r="5"/><path d="M6 36 Q14 30 22 34" stroke-width="3"/><path d="M50 56 Q58 50 66 54" stroke-width="3"/>'),
  flag: svg('<path d="M22 88 V12"/><path d="M22 14 H78 V54 H22"/><path d="M22 14 H36 V28 H22 M36 28 H50 V41 H36 M50 14 H64 V28 H50 M64 28 H78 V41 H64 M22 41 H36 V54 M50 41 H64 V54" stroke-width="3"/>'),
  clock: svg('<circle cx="50" cy="54" r="32"/><path d="M50 54 V34"/><path d="M50 54 L64 62"/><path d="M42 14 H58"/><path d="M50 14 V22"/>'),
  paint: svg('<path d="M20 44 L50 14 L82 46 L52 76 Z"/><path d="M20 44 Q30 58 52 76"/><path d="M84 58 Q92 72 84 80 Q76 72 84 58 Z"/>'),
  wheel: svg('<circle cx="50" cy="50" r="36"/><circle cx="50" cy="50" r="10"/><path d="M50 14 V40 M50 60 V86 M14 50 H40 M60 50 H86 M24 24 L43 43 M57 57 L76 76 M76 24 L57 43 M43 57 L24 76" stroke-width="4"/>'),
  wrench: svg('<path d="M64 14 Q50 14 46 28 Q44 36 48 42 L16 74 Q14 82 22 84 Q26 86 30 82 L60 52 Q66 56 74 54 Q86 50 86 36 L74 46 L64 42 L60 30 L70 20 Z"/>'),
  smoke: svg('<path d="M20 70 Q8 70 8 58 Q8 46 22 46 Q22 30 40 30 Q50 18 64 26 Q80 22 84 38 Q96 42 92 56 Q92 70 78 70 Z"/><path d="M30 82 H70" stroke-width="3"/>'),
  chart: svg('<path d="M14 86 H88"/><path d="M22 86 V60 H34 V86 M44 86 V40 H56 V86 M66 86 V22 H78 V86"/>'),
  medal: svg('<path d="M32 12 L44 40 M68 12 L56 40"/><circle cx="50" cy="62" r="24"/><path d="M50 50 L54 60 L64 60 L56 66 L60 76 L50 70 L40 76 L44 66 L36 60 L46 60 Z" stroke-width="3"/>'),
  pad: svg('<path d="M26 34 H74 Q90 34 92 58 Q94 78 80 78 Q72 78 66 66 H34 Q28 78 20 78 Q6 78 8 58 Q10 34 26 34 Z"/><path d="M28 48 V60 M22 54 H34" stroke-width="4"/><circle cx="68" cy="50" r="3"/><circle cx="76" cy="58" r="3"/>'),
  eye: svg('<path d="M8 50 Q50 10 92 50 Q50 90 8 50 Z"/><circle cx="50" cy="50" r="14"/>'),
  audio: svg('<path d="M16 40 H32 L52 22 V78 L32 60 H16 Z"/><path d="M64 36 Q72 50 64 64 M74 28 Q88 50 74 72"/>'),
  hud: svg('<path d="M14 64 A36 36 0 1 1 86 64"/><path d="M50 64 L70 38"/><circle cx="50" cy="64" r="5"/>'),
};

export const PAINTS = [
  ['#c8102e', 'Active Red'], ['#f4f4f4', 'White Pearl'], ['#111214', 'Black Pearl'], ['#1e3fae', 'Bayside Blue'], ['#9aa1a8', 'Sonic Silver'], ['#7a1fa2', 'Midnight Purple'], ['#f2c200', 'Lightning Yellow'], ['#ff6a00', 'Sunset Orange'],
  ['#0f7a4a', 'Millennium Jade'], ['#2b2f36', 'Gun Metal'], ['#00b7d4', 'Neon Cyan'], ['#ff2d95', 'Hot Pink'], ['#6b0f1a', 'Wine'], ['#c0a062', 'Champagne'], ['#3a5f2a', 'Army'], ['#e8e2d0', 'Cream'],
];
export const FINISHES = [['metallic', 'Metálico', 0], ['matte', 'Fosco', 0], ['pearl', 'Perolado', 3000], ['chrome', 'Cromado', 6000]];
export const SMOKES = [['#eeeeee', 'Branca', 0], ['#ff3b5c', 'Vermelha', 1500], ['#3bb7ff', 'Azul', 1500], ['#ffd23b', 'Amarela', 1500], ['#b03bff', 'Roxa', 2500], ['#3bff7a', 'Verde', 2500]];
export const RIMS = [['#c9ccd1', 'Prata'], ['#1a1a1c', 'Preto'], ['#c69a3c', 'Bronze'], ['#e8e8e8', 'Branco'], ['#b31b1b', 'Vermelho'], ['#555b63', 'Grafite']];

export class UI {
  constructor(game) {
    this.game = game;
    this.root = $('#ui');
    this.screen = null;
    this.nav = []; this.navIdx = 0;
    this.back = null;
    this.hudEl = null;
    this.toastT = null;
    window.addEventListener('keydown', e => this.onKey(e));
    this.padPrev = {};
  }

  // ------------------------------------------------------------ framework
  show(html, { back = null, cls = '', focus = 0 } = {}) {
    this.clearScreen();
    this.keyHook = null; this.onHighlight = null;
    const el = document.createElement('div');
    el.className = 'screen ' + cls;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.screen = el;
    this.back = back;
    this.nav = [...el.querySelectorAll('[data-nav]')];
    this.navIdx = Math.min(focus, this.nav.length - 1);
    this.highlight(false);
    this.nav.forEach((n, i) => {
      n.addEventListener('mouseenter', () => { if (this.navIdx !== i) { this.navIdx = i; this.highlight(false); this.game.audio.ui('move'); } });
      n.addEventListener('click', (ev) => { if (ev.target.tagName === 'INPUT') return; this.activate(n); });
    });
    return el;
  }
  clearScreen() { if (this.screen) { this.screen.remove(); this.screen = null; } this.nav = []; }
  highlight(scroll = true) { this.nav.forEach((n, i) => n.classList.toggle('sel', i === this.navIdx)); const n = this.nav[this.navIdx]; if (scroll && n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' }); this.onHighlight && this.onHighlight(); }
  activate(n) {
    const a = n.dataset.action;
    if (!a) return;
    this.game.audio.ui('select');
    const fn = this.actions[a];
    fn && fn(n.dataset.arg, n);
  }
  onKey(e) {
    if (!this.screen || this.game.state === 'playing') return;
    if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (this.keyHook && this.keyHook(e) === true) { e.preventDefault && e.preventDefault(); return; }
    const n = this.nav[this.navIdx];
    if (this.screen.querySelector('[data-geo]') && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      const dir = { ArrowDown: [0, 1], KeyS: [0, 1], ArrowUp: [0, -1], KeyW: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] }[e.code];
      this.geoMove(dir); e.preventDefault && e.preventDefault(); return;
    }
    const grid = this.screen.querySelector('.cards');
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.move(grid ? this.gridCols() : 1); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.move(grid ? -this.gridCols() : -1); e.preventDefault(); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { if (n && n.dataset.opt) this.cycleOpt(n, -1); else if (grid) this.move(-1); e.preventDefault(); }
    else if (e.code === 'ArrowRight' || e.code === 'KeyD') { if (n && n.dataset.opt) this.cycleOpt(n, 1); else if (grid) this.move(1); e.preventDefault(); }
    else if (e.code === 'Enter' || e.code === 'Space') { if (n) { if (n.dataset.opt) this.cycleOpt(n, 1); else this.activate(n); } e.preventDefault(); }
    else if (e.code === 'Escape' || e.code === 'Backspace') { if (this.back) { this.game.audio.ui('back'); this.back(); } e.preventDefault(); }
  }
  gridCols() { const g = this.screen.querySelector('.cards'); if (!g) return 1; const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length; return cols || 1; }
  move(d) {
    if (!this.nav.length) return;
    this.navIdx = (this.navIdx + d + this.nav.length) % this.nav.length; this.highlight(); this.game.audio.ui('move');
  }
  // move selection to the nearest navigable element in a screen direction (tile grids)
  geoMove([dx, dy]) {
    const cur = this.nav[this.navIdx]; if (!cur) return;
    const a = cur.getBoundingClientRect(); const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = -1, bestS = Infinity;
    this.nav.forEach((n, i) => {
      if (i === this.navIdx) return;
      const b = n.getBoundingClientRect(); const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const vx = bx - ax, vy = by - ay; const along = vx * dx + vy * dy; if (along <= 4) return;
      const across = Math.abs(vx * dy - vy * dx);
      const sc = along + across * 2.2; if (sc < bestS) { bestS = sc; best = i; }
    });
    if (best >= 0) { this.navIdx = best; this.highlight(); this.game.audio.ui('move'); }
  }
  cycleOpt(n, d) {
    const range = n.querySelector('input[type=range]');
    if (range) { const step = +range.step || 0.05; range.value = Math.min(+range.max, Math.max(+range.min, +range.value + d * step)); range.dispatchEvent(new Event('input')); this.game.audio.ui('move'); return; }
    const btns = [...n.querySelectorAll('.opt button')];
    if (!btns.length) return;
    let i = btns.findIndex(b => b.classList.contains('on'));
    i = (i + d + btns.length) % btns.length;
    btns[i].click();
  }
  pollPad() {
    const p = this.game.input.pad(); if (!p || !this.screen || this.game.state === 'playing') return;
    const hit = (i) => p.buttons[i]?.pressed && !this.padPrev[i];
    const ax = p.axes[1] || 0, axx = p.axes[0] || 0;
    const now = performance.now();
    if (!this._padT || now - this._padT > 180) {
      const fake = (code) => { this.onKey({ code, preventDefault() { }, target: null }); this._padT = now; };
      if (hit(12) || ax < -0.6) fake('ArrowUp'); else if (hit(13) || ax > 0.6) fake('ArrowDown');
      else if (hit(14) || axx < -0.6) fake('ArrowLeft'); else if (hit(15) || axx > 0.6) fake('ArrowRight');
    }
    if (hit(4)) this.onKey({ code: 'KeyQ', preventDefault() { }, target: null });
    if (hit(5)) this.onKey({ code: 'KeyE', preventDefault() { }, target: null });
    if (hit(0)) this.onKey({ code: 'Enter', preventDefault() { }, target: null });
    if (hit(1) || hit(9)) this.onKey({ code: 'Escape', preventDefault() { }, target: null });
    p.buttons.forEach((b, i) => this.padPrev[i] = b.pressed);
  }

  toast(msg, ms = 2200) {
    let t = $('.toast'); if (t) t.remove();
    t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    clearTimeout(this.toastT); this.toastT = setTimeout(() => t.remove(), ms);
  }

  // ------------------------------------------------------------ screens
  get actions() {
    const g = this.game;
    return {
      play: () => this.playMenu(),
      free: () => g.startMode('free'),
      park: () => g.startMode('free', { spawn: 'park' }),
      challenges: () => this.challengesMenu(),
      challenge: (id) => g.startMode('challenge', { def: CHALLENGES.find(c => c.id === id) }),
      race: () => this.setupMenu('race'),
      battle: () => this.setupMenu('battle'),
      timeattack: () => g.startMode('timeattack'),
      garage: (tab) => g.openGarage(tab || 'paint'),
      carselect: () => g.openCarSelect(),
      settingsCat: (cat) => this.settingsMenu(null, cat),
      cycleTime: () => { const keys = Object.keys(TIMES); const i = keys.indexOf(g.save.s.time); g.setTime(keys[(i + 1) % keys.length]); this.mainMenu(this.hubTab); },
      settings: () => this.settingsMenu(),
      stats: () => this.statsMenu(),
      help: () => this.helpMenu(),
      main: () => this.mainMenu(this.hubTab),
      startSetup: (type) => g.startMode(type, { ...this.setup }),
      resume: () => g.resume(),
      restart: () => g.restart(),
      quit: () => g.quitToMenu(),
      retry: () => g.retry(),
      results_ok: () => g.quitToMenu(),
      resetSave: () => { if (confirmReset()) { g.save.reset(); g.applySettings(); this.toast('Progresso apagado'); this.settingsMenu(); } },
      garageBack: () => g.closeGarage(),
      pauseSettings: () => this.settingsMenu(() => this.pauseMenu()),
      pauseHelp: () => this.helpMenu(() => this.pauseMenu()),
    };
  }

  title() {
    this.show(`<div class="title-screen screen" style="position:absolute;inset:0;display:flex">
      <div class="logo" style="text-align:center"><span class="k">KAIDO</span> <span class="n">NIGHTS</span><span class="sub">HAKONE BAY DRIFT CIRCUIT</span></div>
      <div class="jp">街道ナイツ</div>
      <div class="press">PRESSIONE QUALQUER TECLA</div></div>`, { cls: '' });
  }

  // ---------------------------------------------------------------- festival hub (tabs + tiles)
  hubHeader() {
    const g = this.game, d = g.save.data, def = carById(d.car.id);
    const thumb = g.carThumb(def.id);
    const level = 1 + Math.floor(Math.sqrt(d.stats.totalScore / 20000));
    return `<div class="hub-top">
      <div class="hub-car">${thumb ? `<img src="${thumb}">` : '<div style="width:210px"></div>'}
        <div><div class="cls"><b style="background:${CLASS_COLORS[def.cls]}">${def.cls}</b><i>${def.pi}</i></div>
        <div class="yr"><span>${def.year}</span>${def.make}</div><div class="nm">${def.model}</div></div></div>
      <div class="hub-player"><div class="avatar">KN</div><div><span class="lvl">${level}</span><div class="pn">Piloto Kaido</div><div class="cr">${fmtN(d.credits)}</div></div></div>
    </div>`;
  }

  mainMenu(tab) {
    const g = this.game, d = g.save.data;
    const TABS = [['campaign', 'Campanha'], ['online', 'Online'], ['cars', 'Carros'], ['profile', 'Meu Kaido'], ['settings', 'Configurações']];
    tab = tab || this.hubTab || 'campaign';
    this.hubTab = tab;
    const medals = Object.values(d.challenges).reduce((a, c) => a + (c.medal || 0), 0);
    const pending = CHALLENGES.filter(c => !(d.challenges[c.id] && d.challenges[c.id].medal >= 3)).length;
    const T = TIMES[g.save.s.time];
    const def = carById(d.car.id);
    const thumb = g.carThumb(def.id);
    let tiles = '';
    if (tab === 'campaign') {
      tiles = `
        <div class="tile mag" data-nav data-action="free" style="grid-column:1;grid-row:1">${ICONS.drift}<h3>Drift<br>Livre</h3><p>Circuito e paddock sem limite de tempo</p></div>
        <div class="tile mag" data-nav data-action="park" style="grid-column:1;grid-row:2">${ICONS.drift}<h3>Drift<br>Park</h3><p>Pista técnica com guard-rails • ligada ao paddock</p></div>
        <div class="tile map" data-nav data-action="cycleTime" style="grid-column:2/4;grid-row:1"><canvas id="hub-map" width="760" height="300"></canvas><h3>Hakone Bay</h3>
          <div class="chips"><div class="chip"><span class="${T.night ? 'moon' : 'sun'}"></span>${T.label}</div><div class="chip"><span class="pin"></span>Circuito de Drift • 2,4 km</div></div></div>
        <div class="tile" data-nav data-action="challenges" style="grid-column:2;grid-row:2">${pending ? `<span class="badge">${pending}</span>` : ''}${ICONS.trophy}<h3>Desafios</h3><p>${medals} de ${CHALLENGES.length * 3} medalhas</p></div>
        <div class="tile" data-nav data-action="battle" style="grid-column:3;grid-row:2">${ICONS.tandem}<h3>Drift<br>Battle</h3><p>Tandem 1×1 contra a IA</p></div>
        <div class="tile dark" data-nav data-action="race" style="grid-column:4;grid-row:1">${ICONS.flag}<h3>Corrida</h3><p>Até 5 adversários</p></div>
        <div class="tile dark" data-nav data-action="timeattack" style="grid-column:4;grid-row:2">${ICONS.clock}<h3>Time<br>Attack</h3><p>Recorde ${fmtTime(d.records.timeAttack)}</p></div>`;
    } else if (tab === 'online') {
      const net = g.net, pr = net.profile;
      tiles = `
        <div class="tile mag big" data-nav data-action="online" style="grid-column:1/3;grid-row:1/3">${ICONS.flag}<h3>Mundo<br>Online</h3><p>${net.loggedIn ? (pr ? `Logado como ${pr.username} • nível ${pr.level}` : 'Conta salva neste navegador') : 'Entre ou crie sua conta'} • pilotos reais, desafios na rua, corridas validadas pelo servidor</p></div>
        <div class="tile" data-nav data-action="online" style="grid-column:3;grid-row:1">${ICONS.tandem}<h3>Desafios<br>na rua</h3><p>Chegue perto de outro piloto e pressione G</p></div>
        <div class="tile" data-nav data-action="online" style="grid-column:4;grid-row:1">${ICONS.trophy}<h3>Eventos</h3><p>Corridas públicas anunciadas no servidor</p></div>
        <div class="tile dark" data-nav data-action="online" style="grid-column:3;grid-row:2">${ICONS.chart}<h3>Rankings</h3><p>Global e semanal</p></div>
        <div class="tile dark" data-nav data-action="online" style="grid-column:4;grid-row:2">${ICONS.wrench}<h3>Garagem<br>online</h3><p>Compre carros com créditos</p></div>`;
    } else if (tab === 'cars') {
      tiles = `
        <div class="tile big mag" data-nav data-action="carselect" style="grid-column:1/3;grid-row:1/3">${thumb ? `<img class="ico" src="${thumb}" style="width:88%;top:40%;opacity:1;filter:drop-shadow(0 12px 18px rgba(0,0,0,.35))">` : ''}<h3>Meus Carros</h3><p>${CARS.length} carros na garagem • ${def.make} ${def.short} selecionado</p></div>
        <div class="tile" data-nav data-action="garage" data-arg="paint" style="grid-column:3;grid-row:1">${ICONS.paint}<h3>Pintura</h3><p>Cores e acabamentos</p></div>
        <div class="tile" data-nav data-action="garage" data-arg="wheels" style="grid-column:4;grid-row:1">${ICONS.wheel}<h3>Rodas</h3><p>Cor, altura e suspensão</p></div>
        <div class="tile dark" data-nav data-action="garage" data-arg="tune" style="grid-column:3;grid-row:2">${ICONS.wrench}<h3>Ajustes</h3><p>Potência, aderência, esterço</p></div>
        <div class="tile dark" data-nav data-action="garage" data-arg="smoke" style="grid-column:4;grid-row:2">${ICONS.smoke}<h3>Fumaça</h3><p>Cor da fumaça dos pneus</p></div>`;
    } else if (tab === 'profile') {
      const st = d.stats;
      tiles = `
        <div class="tile mag big" data-nav data-action="stats" style="grid-column:1/3;grid-row:1/3">${ICONS.chart}<h3>Estatísticas</h3><p>${fmtN(st.totalScore)} pontos • ${(st.distance / 1000).toFixed(1)} km • melhor sequência ${fmtN(st.bestChain)}</p></div>
        <div class="tile" data-nav data-action="challenges" style="grid-column:3;grid-row:1">${ICONS.medal}<h3>Medalhas</h3><p>${medals}/${CHALLENGES.length * 3}</p></div>
        <div class="tile" data-nav data-action="stats" style="grid-column:4;grid-row:1">${ICONS.clock}<h3>Recordes</h3><p>Time Attack ${fmtTime(d.records.timeAttack)}</p></div>
        <div class="tile dark" data-nav data-action="stats" style="grid-column:3;grid-row:2">${ICONS.flag}<h3>Vitórias</h3><p>${st.wins} corridas • ${st.battleWins} batalhas</p></div>
        <div class="tile dark" data-nav data-action="help" style="grid-column:4;grid-row:2">${ICONS.pad}<h3>Controles</h3><p>Teclado e controle</p></div>`;
    } else {
      tiles = `
        <div class="tile mag big" data-nav data-action="settingsCat" data-arg="video" style="grid-column:1;grid-row:1/3">${ICONS.eye}<h3>Gráficos</h3><p>Qualidade ${QUALITY[g.save.s.quality].label} • ${T.label}</p></div>
        <div class="tile" data-nav data-action="settingsCat" data-arg="driving" style="grid-column:2;grid-row:1">${ICONS.wheel}<h3>Direção</h3><p>Câmbio, assistências</p></div>
        <div class="tile" data-nav data-action="settingsCat" data-arg="audio" style="grid-column:3;grid-row:1">${ICONS.audio}<h3>Áudio</h3><p>Volumes e música</p></div>
        <div class="tile dark" data-nav data-action="settingsCat" data-arg="hud" style="grid-column:4;grid-row:1">${ICONS.hud}<h3>HUD e<br>Câmera</h3><p>Unidades, FPS, campo de visão</p></div>
        <div class="tile dark" data-nav data-action="help" style="grid-column:2/4;grid-row:2">${ICONS.pad}<h3>Controles</h3><p>Lista de comandos do teclado e do controle</p></div>
        <div class="tile dark" data-nav data-action="resetSave" style="grid-column:4;grid-row:2"><div class="lockring"></div><h3>Apagar<br>progresso</h3><p>Recomeçar do zero</p></div>`;
    }
    this.show(`<div class="hub fz-bg screen" style="position:absolute;inset:0;display:flex" data-geo>
      ${this.hubHeader()}
      <div class="hub-tabs"><div class="tabrow"><div class="tabbar-fill"></div><span class="lb l">Q / LB</span>
        ${TABS.map(([k, l]) => `<button class="tab ${k === tab ? 'on' : ''}" data-tab="${k}">${k === 'campaign' && pending ? `<span class="dot">${pending}</span>` : ''}${l}</button>`).join('')}
        <span class="lb r">E / RB</span></div></div>
      <div class="tiles">${tiles}</div>
      <div class="hints"><button class="hint"><span class="kb a">A</span>Selecionar</button><button class="hint" id="h-tabs"><span class="kb">Q</span><span class="kb">E</span>Trocar aba</button><button class="hint" id="h-help"><span class="kb">F1</span>Controles</button></div>
    </div>`, { focus: (this._hubFocus && this._hubFocus[tab]) || 0 });
    const sc = this.screen;
    sc.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { this.game.audio.ui('move'); this.mainMenu(b.dataset.tab); });
    sc.querySelector('#h-help').onclick = () => this.helpMenu();
    sc.querySelector('#h-tabs').onclick = () => this.switchTab(1);
    this.nav.forEach((n, i) => n.addEventListener('click', () => { this._hubFocus = this._hubFocus || {}; this._hubFocus[tab] = i; }));
    this.keyHook = (e) => {
      if (e.code === 'KeyQ' || e.code === 'PageUp') { this.switchTab(-1); return true; }
      if (e.code === 'KeyE' || e.code === 'PageDown') { this.switchTab(1); return true; }
      if (e.code === 'Enter' || e.code === 'Space') { this._hubFocus = this._hubFocus || {}; this._hubFocus[tab] = this.navIdx; }
      return false;
    };
    const cv = sc.querySelector('#hub-map'); if (cv) this.drawHubMap(cv);
    if (!thumb) setTimeout(() => { if (this.game.state === 'menu' && this.game.carThumb(def.id)) this.mainMenu(this.hubTab); }, 400);
  }
  switchTab(d) {
    const keys = ['campaign', 'online', 'cars', 'profile', 'settings'];
    const i = keys.indexOf(this.hubTab || 'campaign');
    this.game.audio.ui('move');
    this.mainMenu(keys[(i + d + keys.length) % keys.length]);
  }
  drawHubMap(cv) {
    const g = cv.getContext('2d'), t = this.game.world.track, W = cv.width, H = cv.height;
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#2e6f58'); gr.addColorStop(1, '#22524b');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y < H; y += 28) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    // scattered forest blobs
    const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(20,60,40,${0.25 + rnd() * 0.3})`; g.beginPath(); g.arc(rnd() * W, rnd() * H, 6 + rnd() * 18, 0, 7); g.fill(); }
    const sc = 0.42, ox = W * 0.62, oy = H * 0.55;
    const P = (x, z) => [ox + x * sc, oy + z * sc];
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const [w, c] of [[16, 'rgba(0,0,0,0.25)'], [11, '#e9f2ef'], [4, '#5ad8e8']]) {
      g.strokeStyle = c; g.lineWidth = w; g.beginPath();
      for (let i = 0; i <= t.N; i += 3) { const k = i % t.N; const [x, y] = P(t.x[k], t.z[k]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath(); g.stroke();
    }
    const [px, py] = P(-130, 176); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(px, py, 260 * sc, 146 * sc);
    // pins
    const pin = (x, z, col) => { const [a, b] = P(x, z); g.fillStyle = col; g.beginPath(); g.arc(a, b - 10, 9, 0, 7); g.fill(); g.beginPath(); g.moveTo(a - 6, b - 6); g.lineTo(a + 6, b - 6); g.lineTo(a, b + 4); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(a, b - 10, 3.5, 0, 7); g.fill(); };
    const sp = t.pointAt(40); pin(sp.x, sp.z, '#ccff00'); pin(62, 250, '#ff1aa0'); pin(262, -245, '#ffffff');
  }

  playMenu() {
    const modes = [
      ['free', 'Drift Livre', 'Explore o circuito e o paddock à vontade com pontuação em tempo real.', 'SEM TEMPO'],
      ['challenges', 'Drift Challenge', 'Desafios com metas, medalhas e recompensas.', `${CHALLENGES.length} DESAFIOS`],
      ['battle', 'Drift Battle', 'Tandem contra a IA: persiga e lidere. Ângulo, linha e proximidade.', '1 vs 1'],
      ['race', 'Corrida', 'Largada com contagem regressiva, voltas, posições e checkpoints.', 'ATÉ 5 IA'],
      ['timeattack', 'Time Attack', 'Contra o relógio e o seu fantasma. Melhores tempos salvos.', 'FANTASMA'],
    ];
    this.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="width:1000px">
      <h1>Jogar</h1><div class="desc">Escolha um modo de jogo</div>
      <div class="cards">${modes.map(([a, n, d, tag], i) => `<div class="card" data-nav data-action="${a}"><div class="num">0${i + 1}</div><h3>${n}</h3><p>${d}</p><span class="tag">${tag}</span></div>`).join('')}</div>
      <div class="btns"><button class="btn" data-action="main" onclick="">Voltar (ESC)</button></div>
    </div></div>`, { back: () => this.mainMenu('campaign') });
    this.screen.querySelector('.btns .btn').onclick = () => this.mainMenu('campaign');
  }

  challengesMenu() {
    const d = this.game.save.data.challenges;
    const medalHtml = (m) => [1, 2, 3].map(k => `<span class="medal ${m >= k ? ['', 'b', 's', 'g'][k] : ''}"></span>`).join('');
    this.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="width:1100px">
      <h1>Drift Challenge</h1><div class="desc">Conquiste medalhas para ganhar créditos e desbloquear acabamentos e fumaças na garagem.</div>
      <div class="cards">${CHALLENGES.map((c, i) => { const r = d[c.id] || { medal: 0, best: 0 }; return `<div class="card" data-nav data-action="challenge" data-arg="${c.id}"><div class="num">${String(i + 1).padStart(2, '0')}</div><h3>${c.name}</h3><p>${c.desc}</p><span class="tag">${c.tag} • ${c.time}s</span><div class="medals">${medalHtml(r.medal)}<span style="margin-left:auto;color:var(--muted)">${r.best ? 'Recorde ' + (c.unit ? r.best + ' ' + c.unit : fmtN(r.best)) : ''}</span></div></div>`; }).join('')}</div>
    </div></div>`, { back: () => this.mainMenu(this.hubTab) });
  }

  setupMenu(type) {
    const s = this.game.save.s;
    this.setup = this.setup || {};
    this.setup.level = this.setup.level || s.aiLevel || 'normal';
    this.setup.laps = this.setup.laps || 3;
    this.setup.opponents = this.setup.opponents ?? 3;
    this.setup.time = s.time;
    const lv = Object.entries(AI_LEVELS).map(([k, v]) => `<button class="${this.setup.level === k ? 'on' : ''}" data-k="level" data-v="${k}">${v.label}</button>`).join('');
    const tm = Object.entries(TIMES).map(([k, v]) => `<button class="${this.setup.time === k ? 'on' : ''}" data-k="time" data-v="${k}">${v.label}</button>`).join('');
    const raceRows = type === 'race' ? `
      <div class="row" data-nav data-opt><label>Voltas</label><div class="opt">${[1, 2, 3, 5].map(n => `<button class="${this.setup.laps === n ? 'on' : ''}" data-k="laps" data-v="${n}">${n}</button>`).join('')}</div></div>
      <div class="row" data-nav data-opt><label>Adversários</label><div class="opt">${[1, 2, 3, 4, 5].map(n => `<button class="${this.setup.opponents === n ? 'on' : ''}" data-k="opponents" data-v="${n}">${n}</button>`).join('')}</div></div>` : '';
    this.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel">
      <h1>${type === 'race' ? 'Corrida' : 'Drift Battle'}</h1>
      <div class="desc">${type === 'race' ? 'Corrida contra adversários controlados pela IA no circuito Hakone Bay.' : 'Duas baterias de tandem contra Kenji "Ryu" Takeda. Na 1ª você persegue, na 2ª você lidera. Juízes avaliam ângulo, tempo em drift, proximidade e penalidades.'}</div>
      <div class="row" data-nav data-opt><label>Dificuldade da IA</label><div class="opt">${lv}</div></div>
      ${raceRows}
      <div class="row" data-nav data-opt><label>Horário</label><div class="opt">${tm}</div></div>
      <div class="btns"><button class="btn" data-nav data-action="main">Voltar</button><button class="btn primary" data-nav data-action="startSetup" data-arg="${type}">Largar ▶</button></div>
    </div></div>`, { back: () => this.mainMenu('campaign'), focus: 0 });
    this.screen.querySelectorAll('.opt button').forEach(b => b.onclick = () => {
      const k = b.dataset.k; let v = b.dataset.v; if (k === 'laps' || k === 'opponents') v = +v;
      this.setup[k] = v;
      if (k === 'time') { this.game.save.s.time = v; this.game.setTime(v); }
      if (k === 'level') this.game.save.s.aiLevel = v;
      b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      this.game.audio.ui('move');
    });
  }

  // ---------------------------------------------------------------- settings (category list / rows / description)
  settingsMenu(backFn, cat) {
    const g = this.game, s = g.save.s;
    const back = backFn || (() => this.mainMenu('settings'));
    this._setBack = back;
    cat = cat || this._setCat || 'video'; this._setCat = cat;
    const CATS = [['video', 'Gráficos e Desempenho'], ['driving', 'Direção e Assistências'], ['audio', 'Áudio'], ['hud', 'HUD e Câmera'], ['data', 'Progresso']];
    const onoff = [[true, 'Ligado'], [false, 'Desligado']];
    const DEF = {
      video: [
        { head: 'Qualidade' },
        { k: 'quality', l: 'Predefinição gráfica', o: Object.entries(QUALITY).map(([k, v]) => [k, v.label]), d: 'Baixa desliga sombras e pós-processamento para computadores mais simples. Alta liga sombras, bloom e motion blur. Ultra adiciona oclusão de ambiente (GTAO), sombras 4K e MSAA.' },
        { k: 'resScale', l: 'Escala de resolução', o: [[0.6, '60%'], [0.75, '75%'], [1, '100%'], [1.25, '125%']], d: 'Resolução interna de renderização. Valores menores aumentam muito o FPS.' },
        { k: 'motionBlur', l: 'Motion blur', o: onoff, d: 'Desfoque radial em alta velocidade e com nitro.' },
        { k: 'fpsLimit', l: 'Limite de FPS', o: [[0, 'Sem limite'], [30, '30'], [60, '60'], [72, '72'], [75, '75'], [90, '90'], [120, '120'], [144, '144']], d: 'Limita a taxa de quadros. Se o jogo não alcança a taxa do monitor, use metade dela (ex.: 72 num monitor de 144 Hz) para quadros sempre iguais e sem tremidas.' },
        { head: 'Ambiente' },
        { k: 'time', l: 'Horário', o: Object.entries(TIMES).map(([k, v]) => [k, v.label]), d: 'Noite com holofotes e faróis, pôr do sol ou dia com céu físico.' },
      ],
      driving: [
        { head: 'Transmissão' },
        { k: 'autoGear', l: 'Câmbio', o: [[true, 'Automático'], [false, 'Manual (Q/E)']], d: 'No manual, use Q e E (ou RB / D-pad) para trocar de marcha.' },
        { head: 'Assistências' },
        { k: 'tcs', l: 'Controle de tração', o: [[false, 'Desligado'], [true, 'Ligado']], d: 'Corta potência quando as rodas traseiras patinam. Desligue para fazer drift.' },
        { k: 'abs', l: 'ABS', o: onoff, d: 'Evita o travamento das rodas na frenagem.' },
        { k: 'steerAssist', l: 'Contra-esterço automático', r: [0, 1, 0.05], d: 'Alinha as rodas dianteiras com a direção do movimento quando o carro escorrega. Ajuda muito no teclado.' },
        { k: 'driftAssist', l: 'Estabilidade em drift', r: [0, 1, 0.05], d: 'Amortece a rotação do carro durante o drift para manter o ângulo. 0 = física pura.' },
        { head: 'Adversários' },
        { k: 'aiLevel', l: 'Dificuldade da IA', o: Object.entries(AI_LEVELS).map(([k, v]) => [k, v.label]), d: 'Ritmo dos pilotos da IA em corridas e batalhas.' },
      ],
      audio: [
        { head: 'Volumes' },
        { k: 'master', l: 'Volume geral', r: [0, 1, 0.05], d: 'Volume de todo o jogo.' },
        { k: 'music', l: 'Música', r: [0, 1, 0.05], d: 'Trilha synthwave procedural dos menus e das corridas.' },
        { k: 'sfx', l: 'Efeitos', r: [0, 1, 0.05], d: 'Motor, turbo, pneus, batidas e interface.' },
        { head: 'Música' },
        { k: 'raceMusic', l: 'Música durante a partida', o: [[true, 'Sim'], [false, 'Não']], d: 'Toca a trilha (mais baixa) enquanto você dirige.' },
      ],
      hud: [
        { head: 'Câmera' },
        { k: 'fov', l: 'Campo de visão', r: [50, 80, 1], d: 'Ângulo de visão das câmeras de perseguição e capô.' },
        { k: 'camera', l: 'Câmera inicial', o: Object.entries(CAM_LABELS), d: 'Câmera usada ao iniciar uma partida (C troca durante o jogo).' },
        { k: 'mouseSens', l: 'Sensibilidade do mouse', r: [0.3, 3, 0.1], d: 'Velocidade da câmera livre e do "olhar em volta" com o mouse.' },
        { head: 'HUD' },
        { k: 'units', l: 'Unidade de velocidade', o: [['kmh', 'km/h'], ['mph', 'mph']], d: 'Unidade exibida no velocímetro.' },
        { k: 'showFps', l: 'Mostrar FPS', o: [[true, 'Sim'], [false, 'Não']], d: 'Contador de quadros por segundo no canto da tela.' },
      ],
      data: [
        { head: 'Salvamento' },
        { act: 'resetSave', l: 'Apagar todo o progresso', v: 'Apagar', d: 'Remove recordes, créditos, medalhas, configurações e carros personalizados. Não pode ser desfeito.' },
      ],
    };
    const rows = DEF[cat];
    const val = (r) => { const v = s[r.k]; const o = r.o.find(x => x[0] === v); return o ? o[1] : String(v); };
    const rowHtml = (r, i) => {
      if (r.head) return `<div class="fz-head">${r.head}</div>`;
      if (r.act) return `<div class="fz-row" data-nav data-i="${i}" data-act="${r.act}"><span>${r.l}</span><div class="fz-ctrl"><span></span><span class="v">${r.v}</span><span></span></div></div>`;
      if (r.r) { const p = (s[r.k] - r.r[0]) / (r.r[1] - r.r[0]) * 100; return `<div class="fz-row" data-nav data-i="${i}"><span>${r.l}</span><div class="fz-slider"><input type="range" min="${r.r[0]}" max="${r.r[1]}" step="${r.r[2]}" value="${s[r.k]}" style="--p:${p}%"><span class="v">${r.r[2] >= 1 ? s[r.k] : Math.round(s[r.k] * 100)}</span></div></div>`; }
      const idx = r.o.findIndex(x => x[0] === s[r.k]);
      return `<div class="fz-row" data-nav data-i="${i}"><span>${r.l}</span><div class="fz-ctrl"><button class="arr ${idx <= 0 ? 'off' : ''}" data-d="-1">◀</button><span class="v">${val(r)}</span><button class="arr ${idx >= r.o.length - 1 ? 'off' : ''}" data-d="1">▶</button></div></div>`;
    };
    const keepIdx = this._setRow || 0;
    this.show(`<div class="fz-settings fz-bg screen" style="position:absolute;inset:0;display:flex">
      <div class="fz-set">
        <div class="fz-title">Configurações</div>
        <div class="fz-cats">${CATS.map(([k, l]) => `<button class="fz-cat ${k === cat ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>
        <div class="fz-rows">${rows.map(rowHtml).join('')}</div>
        <div class="fz-desc"><h4>Descrição</h4><div id="fz-desc"></div></div>
      </div>
      <div class="hints"><button class="hint" id="fz-back"><span class="kb">ESC</span>Voltar</button><button class="hint" id="fz-cat"><span class="kb">Q</span><span class="kb">E</span>Categoria</button><button class="hint"><span class="kb">←</span><span class="kb">→</span>Alterar</button></div>
    </div>`, { back, focus: keepIdx });
    this._setRow = 0;
    const sc = this.screen;
    const descEl = sc.querySelector('#fz-desc');
    const showDesc = () => { const n = this.nav[this.navIdx]; descEl.textContent = n ? rows[+n.dataset.i].d : ''; };
    this.onHighlight = showDesc;
    showDesc();
    const apply = () => { g.applySettings(); g.save.save(); };
    const change = (n, d) => {
      const r = rows[+n.dataset.i]; if (!r) return;
      if (r.act) { if (d === 0) this.actions[r.act](); return; }
      if (r.r) { const inp = n.querySelector('input'); const nv = Math.min(r.r[1], Math.max(r.r[0], +(s[r.k] + (d || 1) * r.r[2]).toFixed(3))); s[r.k] = nv; inp.value = nv; }
      else { const i = r.o.findIndex(x => x[0] === s[r.k]); let j = i + (d || 1); if (d === 0) j = (i + 1) % r.o.length; j = Math.max(0, Math.min(r.o.length - 1, j)); if (j === i && d) return; s[r.k] = r.o[j][0]; }
      if (r.k === 'camera') g.rig.mode = s.camera;
      if (r.k === 'mouseSens') g.rig.sens = s.mouseSens;
      apply(); this.game.audio.ui('move');
      this._setRow = this.navIdx;
      this.settingsMenu(backFn, cat);
    };
    this.nav.forEach(n => {
      n.querySelectorAll('.arr').forEach(b => b.onclick = (e) => { e.stopPropagation(); change(n, +b.dataset.d); });
      const inp = n.querySelector('input[type=range]');
      if (inp) inp.oninput = () => { const r = rows[+n.dataset.i]; s[r.k] = +inp.value; inp.style.setProperty('--p', ((s[r.k] - r.r[0]) / (r.r[1] - r.r[0]) * 100) + '%'); n.querySelector('.v').textContent = r.r[2] >= 1 ? s[r.k] : Math.round(s[r.k] * 100); apply(); };
      if (n.dataset.act) n.onclick = () => change(n, 0);
    });
    const goCat = (k) => this.settingsMenu(backFn, k);
    sc.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { this.game.audio.ui('move'); goCat(b.dataset.cat); });
    sc.querySelector('#fz-back').onclick = () => back();
    sc.querySelector('#fz-cat').onclick = () => { const i = CATS.findIndex(c => c[0] === cat); goCat(CATS[(i + 1) % CATS.length][0]); };
    this.keyHook = (e) => {
      const n = this.nav[this.navIdx];
      if (e.code === 'KeyQ' || e.code === 'KeyE' || e.code === 'PageUp' || e.code === 'PageDown') { const i = CATS.findIndex(c => c[0] === cat); const d = (e.code === 'KeyQ' || e.code === 'PageUp') ? -1 : 1; this.game.audio.ui('move'); goCat(CATS[(i + d + CATS.length) % CATS.length][0]); return true; }
      if (!n) return false;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') { change(n, -1); return true; }
      if (e.code === 'ArrowRight' || e.code === 'KeyD') { change(n, 1); return true; }
      if (e.code === 'Enter' || e.code === 'Space') { change(n, 0); return true; }
      return false;
    };
  }

  statsMenu() {
    const d = this.game.save.data, st = d.stats;
    const R = d.ranking;
    const rk = (list, fmt) => list && list.length ? `<table class="t"><tr><th>#</th><th>Resultado</th><th>Data</th></tr>${list.slice(0, 5).map((e, i) => `<tr><td>${i + 1}</td><td>${fmt(e)}</td><td>${new Date(e.date).toLocaleDateString('pt-BR')}</td></tr>`).join('')}</table>` : '<div class="desc">Sem resultados ainda.</div>';
    this.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="width:1050px">
      <h1>Estatísticas</h1>
      <div class="statgrid">
        <div class="stat"><span>Pontos totais</span><b>${fmtN(st.totalScore)}</b></div>
        <div class="stat"><span>Melhor sequência</span><b>${fmtN(st.bestChain)}</b></div>
        <div class="stat"><span>Melhor drift livre</span><b>${fmtN(st.bestFree)}</b></div>
        <div class="stat"><span>Distância</span><b>${(st.distance / 1000).toFixed(1)} km</b></div>
        <div class="stat"><span>Distância em drift</span><b>${(st.driftDistance / 1000).toFixed(1)} km</b></div>
        <div class="stat"><span>Tempo de jogo</span><b>${(st.playTime / 3600).toFixed(1)} h</b></div>
        <div class="stat"><span>Corridas / vitórias</span><b>${st.races} / ${st.wins}</b></div>
        <div class="stat"><span>Batalhas / vitórias</span><b>${st.battles} / ${st.battleWins}</b></div>
        <div class="stat"><span>Velocidade máxima</span><b>${st.maxSpeed.toFixed(0)} km/h</b></div>
        <div class="stat"><span>Ângulo máximo</span><b>${st.maxAngle.toFixed(0)}°</b></div>
        <div class="stat"><span>Melhor volta (TA)</span><b>${fmtTime(d.records.timeAttack)}</b></div>
        <div class="stat"><span>Batidas</span><b>${st.crashes}</b></div>
      </div>
      <h2>Ranking local — Drift Livre</h2>${rk(R.free, e => fmtN(e.score) + ' pts')}
      <h2>Ranking local — Time Attack</h2>${rk(R.timeattack, e => fmtTime(e.score))}
      <h2>Ranking local — Corridas</h2>${rk(R.race, e => fmtTime(e.score))}
      <h2>Histórico recente</h2>
      ${d.history.length ? `<table class="t"><tr><th>Modo</th><th>Resultado</th><th>Data</th></tr>${d.history.slice(0, 10).map(h => `<tr><td>${h.title}</td><td>${h.summary}</td><td>${new Date(h.date).toLocaleString('pt-BR')}</td></tr>`).join('')}</table>` : '<div class="desc">Nenhuma partida registrada.</div>'}
      <div class="btns"><button class="btn primary" data-nav data-action="main">Voltar</button></div>
    </div></div>`, { back: () => this.mainMenu(this.hubTab) });
  }

  helpMenu(backFn) {
    const back = backFn || (() => this.mainMenu(this.hubTab));
    const rows = [['Acelerar', 'W / ↑ / RT'], ['Frear / Ré', 'S / ↓ / LT'], ['Direção', 'A D / ← → / Analógico'], ['Freio de mão', 'ESPAÇO / A'], ['Nitro', 'SHIFT / X'], ['Embreagem (clutch kick)', 'F / LB'], ['Trocar marcha (manual)', 'Q / E'], ['Câmera', 'C / Y'], ['Câmera livre: girar', 'Mouse (clique p/ travar)'], ['Câmera livre: zoom', 'Roda do mouse'], ['Câmera livre: seguir carro / fixa', 'Botão direito'], ['Olhar em volta (perseguição)', 'Arrastar o mouse'], ['Olhar para trás', 'B'], ['Reposicionar', 'R / Select'], ['Faróis', 'L'], ['Pausa', 'ESC / Start']];
    this.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="width:820px">
      <h1>Controles</h1><div class="desc">Teclado e controle (XInput) são suportados.</div>
      <div class="help-grid">${rows.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('')}</div>
      <h2>Dicas de drift</h2>
      <div class="desc" style="line-height:1.7">• Entre na curva, puxe o <b>freio de mão</b> rapidamente ou dê um toque de <b>embreagem (F)</b> com o acelerador no fundo.<br>• Controle o ângulo com o <b>acelerador</b> e contra-esterce. Mais acelerador = mais ângulo.<br>• Mude de lado sem endireitar o carro para fazer <b>transições</b> (+bônus).<br>• Passe perto dos postes azuis (zonas de clipping) e dos muros para bônus.<br>• Batidas, sair da pista ou rodar perdem o combo atual.</div>
      <div class="btns"><button class="btn primary" data-nav id="help-back">Voltar</button></div>
    </div></div>`, { back });
    $('#help-back', this.screen).onclick = back;
  }

  pauseMenu() {
    const m = this.game.mode;
    if (m && m.key === 'online') return this.onlinePause();
    this.show(`<div class="panel-screen screen fz-bg" style="position:absolute;inset:0;display:flex;opacity:.97"><div class="panel" style="min-width:460px">
      <h1>Pausado</h1><div class="desc">${m ? m.name : ''}</div>
      <div class="menu-list" style="margin-top:10px">
        <button class="mbtn" data-nav data-action="resume">Continuar</button>
        <button class="mbtn" data-nav data-action="restart">Reiniciar</button>
        <button class="mbtn" data-nav data-action="pauseSettings">Configurações</button>
        <button class="mbtn" data-nav data-action="pauseHelp">Controles</button>
        <button class="mbtn" data-nav data-action="quit">${m && m.key === 'free' ? 'Encerrar sessão' : 'Sair para o menu'}</button>
      </div></div></div>`, { back: () => this.game.resume() });
  }

  results(r) {
    const medalCol = ['', 'var(--bronze)', 'var(--silver)', 'var(--gold)'];
    const medalName = ['', 'BRONZE', 'PRATA', 'OURO'];
    const big = r.mode === 'race' || r.mode === 'timeattack' ? fmtTime(r.score) : r.mode === 'battle' ? r.score.toFixed(1) : (typeof r.score === 'number' ? fmtN(r.score) : r.score);
    const table = r.table ? `<table class="t" style="margin-top:14px"><tr><th>#</th><th>Piloto</th><th>${r.mode === 'battle' ? 'Você × Adversário' : 'Tempo'}</th></tr>${r.table.map(row => `<tr class="${row.me ? 'me' : ''}"><td>${row.pos}</td><td>${row.name}</td><td>${typeof row.time === 'number' ? fmtTime(row.time) : row.time}</td></tr>`).join('')}</table>` : '';
    this.show(`<div class="panel-screen screen results fz-bg" style="position:absolute;inset:0;display:flex"><div class="panel" style="min-width:640px">
      <div class="desc" style="letter-spacing:.3em;margin:0">RESULTADO</div>
      <h1>${r.title}</h1>
      ${r.medal !== undefined ? `<div style="margin:16px 0">${r.medal ? `<span class="medal-big" style="background:${medalCol[r.medal]}">${medalName[r.medal][0]}</span> <b style="font-size:26px;margin-left:12px;letter-spacing:.2em">${medalName[r.medal]}</b>` : '<b style="color:#ff4d4d;letter-spacing:.2em">SEM MEDALHA</b>'}</div>` : ''}
      <div class="big">${big}</div>
      ${r.newRecord ? '<span class="newrec">NOVO RECORDE</span>' : ''}${r.rankPos && r.rankPos <= 10 ? ` <span class="tag">#${r.rankPos} NO RANKING LOCAL</span>` : ''}
      ${table}
      <div style="margin-top:14px">${(r.lines || []).map(([a, b]) => `<div class="row"><label>${a}</label><span class="val">${b}</span></div>`).join('')}</div>
      <div class="btns">${r.retry ? '<button class="btn" data-nav data-action="retry">Tentar de novo</button>' : ''}<button class="btn primary" data-nav data-action="results_ok">Continuar</button></div>
    </div></div>`, { back: () => this.game.quitToMenu(), focus: r.retry ? 1 : 0 });
    if (r.medal) this.game.audio.ui('medal');
  }

  // ---------------------------------------------------------------- car selection (3D stand behind)
  carSelect(idx = 0) {
    const g = this.game;
    this.csIdx = idx;
    const cur = g.save.data.car.id;
    const statNames = [['speed', 'Velocidade'], ['handling', 'Dirigibilidade'], ['accel', 'Aceleração'], ['launch', 'Largada'], ['braking', 'Frenagem'], ['drift', 'Drift']];
    const c = CARS[idx];
    this.show(`<div class="carsel screen" style="position:absolute;inset:0">
      <div class="cs-left"><div class="cs-title">Meus Carros</div>
        ${CARS.map((k, i) => `<div class="cs-card" data-nav data-i="${i}"><img data-thumb="${k.id}" src="${g.carThumb(k.id) || ''}"><div><div class="cls"><b style="background:${CLASS_COLORS[k.cls]}">${k.cls}</b><i>${k.pi}</i></div><div class="yr"><span>${k.year}</span> ${k.make}</div><div class="nm">${k.short}</div>${k.id === cur ? '<div class="own">● EM USO</div>' : ''}</div></div>`).join('')}
      </div>
      <div class="cs-info">
        <div class="cs-head"><div class="yr"><span>${c.year}</span> ${c.make}</div><div class="nm">${c.model}</div><p>${c.blurb}</p></div>
        <div class="cs-stats">${statNames.map(([k, l]) => `<div class="cs-stat"><span>${l}</span><i><b style="width:${c.stats[k] * 10}%"></b></i><span>${c.stats[k].toFixed(1)}</span></div>`).join('')}</div>
        <div class="cs-spec"><div><span>Motor</span><b>${c.engine}</b></div><div><span>Potência</span><b>${c.hp} cv • ${c.nm} Nm</b></div><div><span>Peso</span><b>${c.mass} kg</b></div><div><span>Tração</span><b>${c.drivetrain}</b></div></div>
      </div>
      <div class="cs-pi"><b style="background:${CLASS_COLORS[c.cls]}">${c.cls}</b><i>${c.pi}</i></div>
      <div class="cs-loading" id="cs-load" style="display:none">Carregando…</div>
      <div class="hints"><button class="hint" id="cs-ok"><span class="kb a">A</span>${c.id === cur ? 'Usar este carro' : 'Escolher carro'}</button><button class="hint" id="cs-gar"><span class="kb y">Y</span>Garagem</button><button class="hint" id="cs-back"><span class="kb b">B</span>Voltar</button><span class="hint" style="pointer-events:none"><span class="kb">↕</span>Arraste para girar</span></div>
    </div>`, { back: () => g.closeCarSelect(), focus: idx });
    const sc = this.screen;
    this.onHighlight = () => { if (this.navIdx !== this.csIdx) { const i = this.navIdx; this.carSelect(i); g.previewCar(CARS[i].id); } };
    this.nav.forEach((n, i) => n.onclick = () => { if (i === this.csIdx) g.selectCar(CARS[i].id); });
    sc.querySelector('#cs-ok').onclick = () => g.selectCar(CARS[this.csIdx].id);
    sc.querySelector('#cs-back').onclick = () => g.closeCarSelect();
    sc.querySelector('#cs-gar').onclick = async () => { await g.selectCar(CARS[this.csIdx].id); g.openGarage('paint'); };
    this.keyHook = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') { g.selectCar(CARS[this.csIdx].id); return true; }
      if (e.code === 'KeyY' || e.code === 'KeyG') { sc.querySelector('#cs-gar').onclick(); return true; }
      return false;
    };
    if (g._csLoading) this.carLoading(true);
  }
  refreshCarCards() {
    if (!this.screen || !this.screen.classList.contains('carsel')) return;
    this.screen.querySelectorAll('img[data-thumb]').forEach(im => { const u = this.game.carThumb(im.dataset.thumb); if (u && im.src !== u) im.src = u; });
  }
  carLoading(on) { this.game._csLoading = on; const el = this.screen && this.screen.querySelector('#cs-load'); if (el) el.style.display = on ? '' : 'none'; }

  // ------------------------------------------------------------ garage UI
  garage(tab = 'paint') {
    const g = this.game, c = g.save.data.car, credits = g.save.data.credits;
    const tune = g.garageTune;
    const tabs = [['paint', 'Pintura'], ['wheels', 'Rodas'], ['tune', 'Ajustes'], ['smoke', 'Fumaça']];
    let body = '';
    if (tab === 'paint') {
      body = `<h2>Cor</h2><div class="swatches">${PAINTS.map(([h, n]) => `<div class="sw ${c.color === h ? 'on' : ''}" title="${n}" data-color="${h}" style="background:${h}"></div>`).join('')}</div>
        <div class="row"><label>Cor personalizada</label><input type="color" id="cc" value="${c.color}"></div>
        <h2>Acabamento</h2><div class="opt" style="flex-wrap:wrap">${FINISHES.map(([k, n, cost]) => { const lock = cost && !g.save.data.unlocked.finishes.includes(k); return `<button class="${c.finish === k ? 'on' : ''}" data-finish="${k}" data-cost="${cost}">${n}${lock ? ` 🔒${fmtN(cost)}` : ''}</button>`; }).join('')}</div>`;
    } else if (tab === 'wheels') {
      body = `<h2>Cor das rodas</h2><div class="swatches">${RIMS.map(([h, n]) => `<div class="sw ${c.rim === h ? 'on' : ''}" title="${n}" data-rim="${h}" style="background:${h}"></div>`).join('')}</div>
        <div class="row"><label>Personalizada</label><input type="color" id="rc" value="${c.rim}"></div>
        <h2>Altura e suspensão</h2>
        ${this._slider('rideHeight', 'Altura (m)', -0.05, 0.04, 0.005, tune.rideHeight)}
        ${this._slider('suspension', 'Rigidez da suspensão', 0, 1, 0.05, tune.suspension)}`;
    } else if (tab === 'tune') {
      body = `<h2>Motor e transmissão</h2>
        ${this._slider('power', 'Potência', 0.7, 1.4, 0.05, tune.power)}
        ${this._slider('finalDrive', 'Relação final', 3.5, 4.6, 0.05, tune.finalDrive)}
        <h2>Chassi</h2>
        ${this._slider('grip', 'Aderência dos pneus', 0.85, 1.15, 0.01, tune.grip)}
        ${this._slider('balance', 'Equilíbrio (traseira solta ↔ presa)', -0.12, 0.12, 0.01, tune.balance)}
        ${this._slider('steerLock', 'Ângulo de esterço (°)', 30, 62, 1, tune.steerLock)}
        ${this._slider('handbrake', 'Força do freio de mão', 0.6, 1.6, 0.05, tune.handbrake)}
        <div class="btns" style="justify-content:flex-start"><button class="btn" id="tune-reset">Restaurar padrão</button><button class="btn" id="tune-drift">Preset Drift</button><button class="btn" id="tune-grip">Preset Grip</button></div>`;
    } else {
      body = `<h2>Cor da fumaça dos pneus</h2><div class="opt" style="flex-wrap:wrap">${SMOKES.map(([h, n, cost]) => { const lock = cost && !g.save.data.unlocked.colors.includes(h); return `<button class="${c.smoke === h ? 'on' : ''}" data-smoke="${h}" data-cost="${cost}" style="border-left:6px solid ${h}">${n}${lock ? ` 🔒${fmtN(cost)}` : ''}</button>`; }).join('')}</div>`;
    }
    const carDef = carById(c.id); const P = tune.power, hp = Math.round(carDef.hp * P), tq = Math.round(carDef.nm * P);
    this.show(`<div class="garage-screen screen" style="position:absolute;inset:0;display:flex">
      <div class="garage-title"><div class="model">${carDef.make.toUpperCase()}<br>${carDef.short.toUpperCase()}</div><div class="spec">${carDef.engine.toUpperCase()} • ${hp} CV • ${tq} NM • ${carDef.drivetrain.toUpperCase()}</div></div>
      <div class="credits-badge" style="left:46px;right:auto">CRÉDITOS <b>${fmtN(credits)}</b></div>
      <div class="garage-side">
        <h1>GARAGEM</h1>
        <div class="desc" style="margin-top:6px">Arraste para girar • roda do mouse para zoom</div>
        <div class="garage-tabs opt">${tabs.map(([k, n]) => `<button class="${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
        ${body}
        <h2>Desempenho</h2>
        <div class="bars">${[['POTÊNCIA', (P - 0.6) / 0.8], ['ADERÊNCIA', (tune.grip - 0.8) / 0.4], ['DRIFT', 0.5 - tune.balance * 3 + (tune.steerLock - 30) / 64], ['ESTABILIDADE', 0.3 + tune.balance * 2 + tune.suspension * 0.3]].map(([n, v]) => `<div class="bar"><span>${n}</span><i><b style="width:${Math.max(4, Math.min(100, v * 100))}%"></b></i></div>`).join('')}</div>
        <div class="btns"><button class="btn primary" data-nav data-action="garageBack">Salvar e voltar</button></div>
      </div></div>`, { back: () => g.closeGarage() });
    const sc = this.screen;
    sc.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { g.audio.ui('move'); this.garage(b.dataset.tab); });
    sc.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { g.setPaint({ color: b.dataset.color }); this.garage(tab); });
    sc.querySelectorAll('[data-rim]').forEach(b => b.onclick = () => { g.setPaint({ rim: b.dataset.rim }); this.garage(tab); });
    const cc = $('#cc', sc); if (cc) cc.oninput = () => g.setPaint({ color: cc.value });
    const rc = $('#rc', sc); if (rc) rc.oninput = () => g.setPaint({ rim: rc.value });
    sc.querySelectorAll('[data-finish]').forEach(b => b.onclick = () => {
      const k = b.dataset.finish, cost = +b.dataset.cost, un = g.save.data.unlocked.finishes;
      if (cost && !un.includes(k)) { if (g.save.data.credits < cost) { this.toast('Créditos insuficientes — complete desafios e corridas'); g.audio.ui('fail'); return; } g.save.data.credits -= cost; un.push(k); this.toast('Acabamento desbloqueado!'); }
      g.setPaint({ finish: k }); this.garage(tab);
    });
    sc.querySelectorAll('[data-smoke]').forEach(b => b.onclick = () => {
      const h = b.dataset.smoke, cost = +b.dataset.cost, un = g.save.data.unlocked.colors;
      if (cost && !un.includes(h)) { if (g.save.data.credits < cost) { this.toast('Créditos insuficientes'); g.audio.ui('fail'); return; } g.save.data.credits -= cost; un.push(h); this.toast('Fumaça desbloqueada!'); }
      g.setPaint({ smoke: h }); this.garage(tab);
    });
    sc.querySelectorAll('input[type=range][data-tune]').forEach(r => r.oninput = () => { g.garageTune[r.dataset.tune] = +r.value; r.nextElementSibling.textContent = (+r.value).toFixed(r.step < 0.01 ? 3 : 2); g.updateGarageTune(); });
    const tr = $('#tune-reset', sc); if (tr) tr.onclick = () => { g.resetTune(); this.garage(tab); };
    const td = $('#tune-drift', sc); if (td) td.onclick = () => { Object.assign(g.garageTune, { power: 1.15, grip: 0.97, balance: -0.06, steerLock: 58, handbrake: 1.3, suspension: 0.7, rideHeight: -0.03, finalDrive: 4.3 }); g.updateGarageTune(); this.garage(tab); };
    const tg = $('#tune-grip', sc); if (tg) tg.onclick = () => { Object.assign(g.garageTune, { power: 1.0, grip: 1.12, balance: 0.08, steerLock: 38, handbrake: 0.8, suspension: 0.8, rideHeight: -0.02, finalDrive: 4.0 }); g.updateGarageTune(); this.garage(tab); };
  }
  _slider(k, label, min, max, step, v) { return `<div class="row"><label>${label}</label><div><input type="range" data-tune="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val" style="min-width:50px;display:inline-block">${(+v).toFixed(step < 0.01 ? 3 : 2)}</span></div></div>`; }

  // ------------------------------------------------------------ HUD
  buildHud() {
    this.clearScreen();
    if (this.hudEl) this.hudEl.remove();
    const h = document.createElement('div'); h.id = 'hud';
    h.innerHTML = `
      <div class="hud-tl" id="hud-boxes"></div>
      <div class="hud-score" id="hud-score"><div class="total">PONTOS <b id="hud-total">0</b></div>
        <div class="chain" id="hud-chain" style="opacity:0"><div><span class="pts" id="hud-pts">0</span><span class="mult" id="hud-mult">x1</span></div><div class="q" id="hud-q"></div></div>
        <div class="anglebar"><i id="hud-ang"></i><div class="mk" style="left:25%"></div><div class="mk" style="left:75%"></div></div>
        <div class="angletxt" id="hud-angtxt">0°</div>
      </div>
      <div class="battle-bar" id="hud-battle" style="display:none"><div class="lbl" id="hud-battle-l">DISTÂNCIA</div><div class="meter"><i id="hud-battle-m"></i></div></div>
      <div class="hud-standings" id="hud-stand"></div>
      <div class="popups" id="hud-pop"></div>
      <div id="hud-center"></div>
      <div id="hud-warn"></div>
      <div class="hud-bl"><canvas id="hud-map" width="460" height="460"></canvas></div>
      <div class="hud-br"><canvas id="hud-tach" width="600" height="600"></canvas></div>
      <div class="hud-objective" id="hud-obj" style="display:none"></div>
      <div class="fps" id="hud-fps"></div>`;
    this.root.appendChild(h);
    this.hudEl = h;
    this.tach = $('#hud-tach', h).getContext('2d');
    this.map = $('#hud-map', h).getContext('2d');
    this._mapPath = null;
    this._chainShown = 0; this._totalShown = 0;
    this._boxCache = '';
  }
  hideHud() { if (this.hudEl) { this.hudEl.remove(); this.hudEl = null; } }

  objective(text) { const o = this.hudEl && $('#hud-obj', this.hudEl); if (!o) { this._pendingObj = text; return; } o.style.display = text ? '' : 'none'; o.textContent = text || ''; clearTimeout(this._objT); this._objT = setTimeout(() => { if (o) o.style.display = 'none'; }, 9000); }
  centerMsg(text, small = false) {
    const c = this.hudEl && $('#hud-center', this.hudEl); if (!c) return;
    c.innerHTML = `<div class="center-msg ${small ? 'small' : ''}">${text}</div>`;
    clearTimeout(this._cT); this._cT = setTimeout(() => { c.innerHTML = ''; }, small ? 2000 : 900);
  }
  warn(text) { const w = this.hudEl && $('#hud-warn', this.hudEl); if (!w) return; if ((text || '') === this._warn) return; this._warn = text || ''; w.innerHTML = text ? `<div class="center-msg warn" style="top:22%">${text}</div>` : ''; }
  popup(text, cls = 'zone') {
    const p = this.hudEl && $('#hud-pop', this.hudEl); if (!p) return;
    const d = document.createElement('div'); d.className = 'popup ' + cls; d.textContent = text; p.appendChild(d);
    setTimeout(() => d.remove(), 1850);
    while (p.children.length > 6) p.firstChild.remove();
  }
  chainState(state) { const c = this.hudEl && $('#hud-chain', this.hudEl); if (!c) return; c.classList.remove('fail', 'bank'); void c.offsetWidth; if (state) c.classList.add(state); clearTimeout(this._chT); this._chT = setTimeout(() => { c.classList.remove('fail', 'bank'); }, 1100); this._chainHold = 1.1; }

  updateHud(dt, car, info, fps) {
    if (!this.hudEl) return;
    const h = this.hudEl, s = this.game.save.s;
    // boxes
    const boxes = info.boxes || [];
    const html = boxes.map(b => `<div class="hud-box ${b.cls || ''}"><div class="l">${b.l}</div><div class="v">${b.v}</div></div>`).join('');
    if (html !== this._boxCache) { $('#hud-boxes', h).innerHTML = html; this._boxCache = html; }
    // score
    const sc = info.score;
    const scoreEl = $('#hud-score', h);
    scoreEl.style.display = sc ? '' : 'none';
    if (sc) {
      this._totalShown += (sc.total - this._totalShown) * Math.min(1, dt * 6);
      $('#hud-total', h).textContent = fmtN(this._totalShown);
      const chainVal = sc.chain * sc.mult;
      this._chainHold = Math.max(0, (this._chainHold || 0) - dt);
      const chainEl = $('#hud-chain', h);
      if (sc.active || chainVal > 0) { this._chainShown += (chainVal - this._chainShown) * Math.min(1, dt * 10); chainEl.style.opacity = 1; $('#hud-pts', h).textContent = fmtN(this._chainShown); $('#hud-mult', h).textContent = 'x' + (Math.floor(sc.mult * 2) / 2).toFixed(sc.mult % 1 ? 1 : 0); $('#hud-q', h).textContent = sc.quality + (sc.onLine ? ' • LINHA' : '') + (sc.prox ? ' • MURO' : ''); }
      else if (this._chainHold <= 0) { chainEl.style.opacity = 0; this._chainShown = 0; }
      const a = Math.min(90, sc.angle);
      const ang = $('#hud-ang', h);
      const side = car.veh.driftAngle > 0 ? 1 : -1;
      ang.style.width = (a / 90 * 50) + '%';
      ang.style.left = side > 0 ? '50%' : (50 - a / 90 * 50) + '%';
      $('#hud-angtxt', h).textContent = `${a.toFixed(0)}°`;
    }
    // battle meter
    const bb = $('#hud-battle', h);
    if (info.battle) { bb.style.display = ''; const g = info.battle.gap; $('#hud-battle-m', h).style.width = Math.max(0, Math.min(100, (1 - (g - 3) / 25) * 100)) + '%'; $('#hud-battle-l', h).textContent = (info.battle.chasing ? 'PROXIMIDADE DO LÍDER ' : 'DISTÂNCIA DO PERSEGUIDOR ') + g.toFixed(1) + ' m'; }
    else bb.style.display = 'none';
    // standings
    const st = $('#hud-stand', h);
    if (info.standings) { const sh = info.standings.map((r, i) => `<div class="${r.me ? 'me' : ''}"><b>${i + 1}</b>${r.name}</div>`).join(''); if (sh !== this._stCache) { st.innerHTML = sh; this._stCache = sh; } } else if (this._stCache) { st.innerHTML = ''; this._stCache = ''; }
    $('#hud-fps', h).textContent = s.showFps ? `${fps.toFixed(0)} FPS` : '';
    this.drawTach(car);
    this.drawMap(car, info.others || []);
    if (this._pendingObj) { const t = this._pendingObj; this._pendingObj = null; this.objective(t); }
  }

  drawTach(car) {
    const g = this.tach, v = car.veh, W = 600;
    g.clearRect(0, 0, W, W);
    const cx = 330, cy = 330, R = 230;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const redline = v.spec.redline, maxR = 9000;
    const ang = r => a0 + (a1 - a0) * Math.min(1, r / maxR);
    // backdrop
    g.beginPath(); g.arc(cx, cy, R + 26, 0, Math.PI * 2); g.fillStyle = 'rgba(8,9,16,0.55)'; g.fill();
    // arc
    g.lineWidth = 16; g.lineCap = 'butt';
    g.beginPath(); g.arc(cx, cy, R, a0, ang(redline)); g.strokeStyle = 'rgba(255,255,255,0.14)'; g.stroke();
    g.beginPath(); g.arc(cx, cy, R, ang(redline), a1); g.strokeStyle = 'rgba(255,45,85,0.5)'; g.stroke();
    // fill
    const grd = g.createLinearGradient(cx - R, cy, cx + R, cy); grd.addColorStop(0, '#00e5ff'); grd.addColorStop(0.75, '#ffffff'); grd.addColorStop(1, '#ff2d55');
    g.beginPath(); g.arc(cx, cy, R, a0, ang(v.rpm)); g.strokeStyle = v.rpm > redline - 400 ? '#ff2d55' : grd; g.lineWidth = 16; g.stroke();
    // ticks
    g.fillStyle = '#cfd4de'; g.font = 'italic 700 26px Bahnschrift, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r <= maxR; r += 1000) {
      const a = ang(r); g.strokeStyle = r >= redline ? '#ff2d55' : 'rgba(255,255,255,0.7)'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); g.lineTo(cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40)); g.stroke();
      g.fillText(String(r / 1000), cx + Math.cos(a) * (R - 64), cy + Math.sin(a) * (R - 64));
    }
    // needle
    const na = ang(v.rpm);
    g.strokeStyle = '#ff2d55'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx + Math.cos(na) * 40, cy + Math.sin(na) * 40); g.lineTo(cx + Math.cos(na) * (R - 10), cy + Math.sin(na) * (R - 10)); g.stroke();
    // speed
    const units = this.game.save.s.units;
    const spd = units === 'mph' ? v.speedKmh * 0.621 : v.speedKmh;
    g.fillStyle = '#fff'; g.font = 'italic 800 118px Bahnschrift, Arial'; g.fillText(Math.round(spd), cx, cy + 6);
    g.fillStyle = '#8d95a8'; g.font = '600 24px Bahnschrift, Arial'; g.fillText(units === 'mph' ? 'MPH' : 'KM/H', cx, cy + 76);
    // gear
    const gear = v.gear === -1 ? 'R' : v.gear === 0 ? 'N' : String(v.gear);
    g.fillStyle = v.limiterHit ? '#ff2d55' : '#00e5ff'; g.font = 'italic 800 76px Bahnschrift, Arial'; g.fillText(gear, cx, cy + 192);
    g.fillStyle = '#8d95a8'; g.font = '600 18px Bahnschrift, Arial'; g.fillText(`${Math.round(v.rpm)} RPM`, cx, cy - 70);
    // nitro bar
    const n = v.nitro / v.spec.nitroCapacity;
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(cx - 80, cy + 104, 160, 9);
    g.fillStyle = v.nitroActive ? '#7fb2ff' : '#3b6fff'; g.fillRect(cx - 80, cy + 104, 160 * n, 9);
    g.fillStyle = '#8d95a8'; g.font = '600 16px Bahnschrift, Arial'; g.textAlign = 'right'; g.fillText('N₂O', cx - 88, cy + 109);
    g.textAlign = 'left'; if (v.tcs) { g.fillStyle = v.throttleCut > 0.1 ? '#ffc940' : '#555'; g.fillText('TCS', cx + 88, cy + 109); }
  }

  drawMap(car, others) {
    const g = this.map, W = 460, world = this.game.world, t = world.track;
    if (!this._mapPath) {
      const p = new Path2D(); for (let i = 0; i <= t.N; i += 2) { const k = i % t.N; i === 0 ? p.moveTo(t.x[k], t.z[k]) : p.lineTo(t.x[k], t.z[k]); } p.closePath(); this._mapPath = p;
    }
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 4, 0, Math.PI * 2); g.clip();
    const scale = 0.55;
    g.translate(W / 2, W / 2);
    g.rotate(car.veh.heading + Math.PI);
    g.scale(scale, scale);
    g.translate(-car.veh.x, -car.veh.z);
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 34; g.stroke(this._mapPath);
    g.strokeStyle = 'rgba(230,235,245,0.75)'; g.lineWidth = 12; g.stroke(this._mapPath);
    // plaza
    g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(-130, 176, 260, 146);
    // start line
    const sp = t.pointAt(40); g.fillStyle = '#ff2d55'; g.fillRect(sp.x - 4, sp.z - 4, 8, 8);
    // clipping zones
    g.fillStyle = '#00e5ff'; for (const z of world.clipZones) if (z.kind === 'OUTER') { g.beginPath(); g.arc(z.x, z.z, 4, 0, 7); g.fill(); }
    for (const o of others) { g.fillStyle = o.color || '#ffc940'; g.beginPath(); g.arc(o.x, o.z, 7, 0, 7); g.fill(); }
    g.restore();
    // player arrow
    g.fillStyle = '#ff2d55'; g.beginPath(); g.moveTo(W / 2, W / 2 - 14); g.lineTo(W / 2 + 10, W / 2 + 10); g.lineTo(W / 2, W / 2 + 4); g.lineTo(W / 2 - 10, W / 2 + 10); g.closePath(); g.fill();
  }
}

function confirmReset() { return window.confirm('Apagar todo o progresso, recordes e configurações?'); }

// online screens (login, lobby, in-world menus) live in their own module
import { installOnlineUi } from './onlineUi.js';
installOnlineUi(UI);
