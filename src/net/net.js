// =====================================================================
//  Network client: REST (auth, garage, leaderboards) + WebSocket realtime
//  with automatic reconnection (session resume) and RTT/clock estimate.
// =====================================================================
import { PROTOCOL_VERSION } from './shared.js';

const TOKEN_KEY = 'kaido-online-token';
const SERVER_KEY = 'kaido-online-server';

export class NetClient {
  constructor() {
    this.handlers = new Map();
    this.token = localStorage.getItem(TOKEN_KEY) || null;
    this.base = localStorage.getItem(SERVER_KEY) || defaultServer();
    this.ws = null; this.connected = false; this.wantOnline = false;
    this.rtt = 0; this.clockOffset = 0; this.retry = 0;
    this.profile = null;
  }
  /** find a reachable server: saved/same-origin first, then localhost:8090 */
  async detect() {
    const native = location.hostname === 'kaido.game';
    const cands = [...new Set([this.base, location.protocol.startsWith('http') && !native ? location.origin : null, native ? 'http://localhost:8090' : `http://${location.hostname || 'localhost'}:8090`].filter(Boolean))];
    for (const c of cands) {
      try { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500); const r = await fetch(c + '/api/info', { signal: ctl.signal }); clearTimeout(t); if (r.ok) { const info = await r.json(); if (info.protocol) { this.base = c; this.info = info; return info; } } } catch { }
    }
    return null;
  }
  setServer(url) { this.base = url.replace(/\/+$/, ''); localStorage.setItem(SERVER_KEY, this.base); }
  on(t, fn) { let a = this.handlers.get(t); if (!a) this.handlers.set(t, a = []); a.push(fn); return () => a.splice(a.indexOf(fn), 1); }
  emit(t, m) { const a = this.handlers.get(t); if (a) for (const f of [...a]) { try { f(m); } catch (e) { console.error('net handler', t, e); } } const all = this.handlers.get('*'); if (all) for (const f of all) f(m); }

  async api(path, body, method) {
    const r = await fetch(this.base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch { }
    if (r.status === 401 && data.auth) this.logout(true);
    if (!r.ok) { const e = new Error(data.error || `Erro ${r.status}`); e.status = r.status; throw e; }
    return data;
  }
  async register(username, password) { const d = await this.api('/api/register', { username, password }); this._setToken(d.token); this.profile = d.profile; return d.profile; }
  async login(username, password) { const d = await this.api('/api/login', { username, password }); this._setToken(d.token); this.profile = d.profile; return d.profile; }
  async me() { const d = await this.api('/api/me'); this.profile = d.profile; return d.profile; }
  async logout(local = false) { if (!local && this.token) { try { await this.api('/api/logout', {}); } catch { } } this.token = null; localStorage.removeItem(TOKEN_KEY); this.profile = null; this.disconnect(); }
  _setToken(t) { this.token = t; localStorage.setItem(TOKEN_KEY, t); }
  get loggedIn() { return !!this.token; }

  connect(room) {
    this.wantOnline = true; this.room = room || null;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const url = this.base.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => { ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, room: this.room })); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'welcome') { this.connected = true; this.retry = 0; this.room = m.room.id; this._pingT = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000); }
      if (m.t === 'pong') { this.rtt = performance.now() - m.c; this.clockOffset = m.s - (Date.now() - this.rtt / 2); }
      if (m.t === 'fatal') { this.wantOnline = false; if (m.auth) this.logout(true); }
      if (m.t === 'kicked') this.wantOnline = false;
      this.emit(m.t, m);
    };
    ws.onclose = (e) => {
      clearInterval(this._pingT);
      const was = this.connected; this.connected = false;
      this.emit('disconnected', { code: e.code, was });
      if (this.wantOnline && this.ws === ws && e.code !== 4005 && e.code !== 4004 && e.code !== 4006 && e.code !== 4007) {
        const delay = Math.min(10000, 500 * 2 ** this.retry++);
        this.emit('reconnecting', { delay, attempt: this.retry });
        this._reT = setTimeout(() => { if (this.wantOnline) this.connect(this.room); }, delay);
      }
    };
    ws.onerror = () => { };
  }
  disconnect() { this.wantOnline = false; clearTimeout(this._reT); clearInterval(this._pingT); if (this.ws) { try { this.send({ t: 'leave_world' }); this.ws.close(); } catch { } } this.ws = null; this.connected = false; }
  send(m) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }
  serverNow() { return Date.now() + this.clockOffset; }
}

function defaultServer() {
  // native Windows app (WebView2 virtual host): the online server is a separate machine/process
  if (location.hostname === 'kaido.game') return 'http://localhost:8090';
  // the dedicated server also serves the game: same origin by default
  if (location.protocol.startsWith('http')) return location.origin;
  return `${location.protocol === 'https:' ? 'https' : 'http'}://${location.hostname || 'localhost'}:8090`;
}
