// Test client: a real, independent network client (REST + WebSocket) that
// talks to the dedicated server exactly like the browser game does.
// Used only by the automated tests and the load test.
import { PROTOCOL_VERSION } from '../../src/net/shared.js';

export class TestClient {
  constructor(base, name, password = 'senha-forte-123') { this.base = base; this.name = name; this.password = password; this.msgs = []; this.waiters = []; this.state = null; }
  async api(path, body, method = body ? 'POST' : 'GET') {
    const r = await fetch(this.base + path, { method, headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  }
  async register() { const r = await this.api('/api/register', { username: this.name, password: this.password }); if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.body)); this.token = r.body.token; this.profile = r.body.profile; this.id = r.body.profile.id; return r; }
  async login() { const r = await this.api('/api/login', { username: this.name, password: this.password }); if (r.status !== 200) throw new Error('login failed ' + JSON.stringify(r.body)); this.token = r.body.token; this.profile = r.body.profile; this.id = r.body.profile.id; return r; }
  connect(room) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.base.replace('http', 'ws') + '/ws');
      this.ws = ws; this.closed = false;
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, token: this.token, room }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data); this.msgs.push(m);
        if (m.t === 'welcome') { this.welcome = m; this.pos = { ...m.spawn }; resolve(m); }
        if (m.t === 'fatal') reject(new Error(m.msg));
        if (m.t === 'correct') this.corrections = (this.corrections || 0) + 1;
        for (const w of [...this.waiters]) if (w.pred(m)) { this.waiters.splice(this.waiters.indexOf(w), 1); w.res(m); }
      };
      ws.onclose = (e) => { this.closed = true; this.closeCode = e.code; if (!this.welcome) reject(new Error('closed before welcome: ' + e.code)); };
      ws.onerror = () => { };
    });
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  wait(pred, ms = 8000, label = '') {
    const found = this.msgs.find(pred); if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((res, rej) => {
      const w = { pred, res: (m) => { clearTimeout(to); const i = this.msgs.indexOf(m); if (i >= 0) this.msgs.splice(i, 1); res(m); } };
      const to = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); rej(new Error(`${this.name}: timeout waiting ${label}`)); }, ms);
      this.waiters.push(w);
    });
  }
  waitT(t, extra = () => true, ms) { return this.wait(m => m.t === t && extra(m), ms, t); }
  clear() { this.msgs.length = 0; }
  st(x, z, h, vx = 0, vz = 0) { this.pos = { x, z, h }; this.send({ t: 'st', x, z, h, vx, vz, s: 0, r: 3000, g: 3, f: 0 }); }
  close() { try { this.ws.close(); } catch { } }
  /** drive through a list of points at constant speed, sending 15 Hz states in real time */
  async drive(points, speed, { hz = 15, stopIf } = {}) {
    let { x, z } = this.pos;
    for (const p of points) {
      while (true) {
        const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
        const step = speed / hz;
        const h = Math.atan2(dx, dz);
        if (d <= step) { x = p.x; z = p.z; this.st(x, z, h, Math.sin(h) * speed, Math.cos(h) * speed); await sleep(1000 / hz); break; }
        x += dx / d * step; z += dz / d * step;
        this.st(x, z, h, Math.sin(h) * speed, Math.cos(h) * speed);
        await sleep(1000 / hz);
        if (stopIf && stopIf()) return;
      }
    }
  }
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
