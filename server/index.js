// =====================================================================
//  Kaido Nights dedicated server: HTTP (static game + REST API) and
//  WebSocket realtime on the same port.
//    node server/index.js           (Node >= 22.13, no npm install needed)
// =====================================================================
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { DB } from './db.js';
import { Hub, cleanLook } from './hub.js';
import { acceptUpgrade } from './ws.js';
import { hashPassword, verifyPassword, newToken, hashToken, validateCredentials, RateLimiter } from './auth.js';
import { PROTOCOL_VERSION, CAR_PRICES, POIS, CHALLENGE_TYPES } from '../src/net/shared.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const STATIC_DENY = /^\/(server|data|logs|tests|keys|release|tools|\.kaido|\.env|node_modules|\.git)(\/|$)|\.db$|\.log$|\.pem$/i;

export function startServer(overrides = {}) {
  Object.assign(config, overrides);
  const db = new DB(config.dbPath);
  const hub = new Hub(db, config);
  hub.createRoom(); // the first public world instance always exists
  const apiLimit = new RateLimiter(config.apiBurst, config.apiPerSec);
  const regLimit = new RateLimiter(config.registerPerMin, config.registerPerMin / 60);
  const loginFail = new RateLimiter(config.loginFailPer5Min, config.loginFailPer5Min / 300);

  const json = (res, code, obj, headers = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(body);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 16 * 1024) { reject(new Error('too_big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('bad_json')); } });
    req.on('error', reject);
  });
  const ipOf = (req) => (config.trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
  const authUser = (req) => { const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : ''; return t ? db.sessionUser(hashToken(t)) : null; };

  async function api(req, res, url) {
    const ip = ipOf(req);
    if (!apiLimit.take(ip)) return json(res, 429, { error: 'Muitas requisições' });
    const p = url.pathname, M = req.method;
    if (p === '/api/info' && M === 'GET') return json(res, 200, { name: config.serverName, region: config.region, protocol: PROTOCOL_VERSION, carPrices: CAR_PRICES, pois: POIS, challenges: Object.fromEntries(Object.entries(CHALLENGE_TYPES).map(([k, v]) => [k, { label: v.label, desc: v.desc }])) });
    if (p === '/api/servers' && M === 'GET') return json(res, 200, { region: config.region, name: config.serverName, rooms: hub.roomList(), online: hub.online.size, capacity: config.roomCapacity * config.maxRooms });
    if ((p === '/api/register' || p === '/api/login') && M === 'POST') {
      let b; try { b = await readBody(req); } catch { return json(res, 400, { error: 'Requisição inválida' }); }
      const username = String(b.username || '').trim(), password = b.password;
      const failKey = ip + '|' + username.toLowerCase();
      if (p === '/api/register') {
        if (!regLimit.take(ip)) return json(res, 429, { error: 'Muitas contas criadas. Aguarde um minuto.' });
        const err = validateCredentials(username, password); if (err) return json(res, 400, { error: err });
        if (db.userByName(username)) return json(res, 409, { error: 'Nome de usuário já existe' });
        const id = db.createUser(username, await hashPassword(password));
        db.activity(id, 'register', { ip });
        const token = newToken(); db.addSession(hashToken(token), id, ip);
        log.info('user registered', { id, username });
        return json(res, 201, { token, profile: db.profile(id) });
      }
      if (!loginFail.check(failKey)) return json(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
      const u = db.userByName(username);
      const ok = u && typeof password === 'string' && await verifyPassword(password, u.pass_hash);
      if (!ok) { loginFail.take(failKey); db.activity(u ? u.id : null, 'login_failed', { ip, username: username.slice(0, 20) }, !!u); return json(res, 401, { error: 'Usuário ou senha incorretos' }); }
      if (u.banned) return json(res, 403, { error: 'Conta suspensa' });
      const token = newToken(); db.addSession(hashToken(token), u.id, ip);
      db.activity(u.id, 'login', { ip });
      return json(res, 200, { token, profile: db.profile(u.id) });
    }
    if (p === '/api/leaderboard' && M === 'GET') return json(res, 200, { period: url.searchParams.get('period') === 'week' ? 'week' : 'all', rows: db.leaderboard(url.searchParams.get('period') === 'week' ? 'week' : 'all') });
    if (p.startsWith('/api/profile/') && M === 'GET') { const pr = db.publicProfile(+p.split('/').pop()); return pr ? json(res, 200, pr) : json(res, 404, { error: 'Não encontrado' }); }
    // ---- authenticated
    const uid = authUser(req);
    if (!uid) return json(res, 401, { error: 'Não autenticado', auth: true });
    if (p === '/api/me' && M === 'GET') return json(res, 200, { profile: db.profile(uid) });
    if (p === '/api/logout' && M === 'POST') { db.dropSession(hashToken((req.headers.authorization || '').slice(7))); return json(res, 200, { ok: true }); }
    if (p === '/api/buy' && M === 'POST') {
      let b; try { b = await readBody(req); } catch { return json(res, 400, { error: 'Requisição inválida' }); }
      try { const bal = db.buyCar(uid, String(b.car)); db.activity(uid, 'buy_car', { car: b.car }); return json(res, 200, { ok: true, money: bal, profile: db.profile(uid) }); }
      catch (e) { return json(res, 400, { error: { unknown_car: 'Carro desconhecido', already_owned: 'Você já possui este carro', insufficient_funds: 'Dinheiro insuficiente' }[e.message] || 'Falha na compra' }); }
    }
    if (p === '/api/garage' && M === 'POST') {
      let b; try { b = await readBody(req); } catch { return json(res, 400, { error: 'Requisição inválida' }); }
      const car = String(b.car || '');
      if (!db.ownsCar(uid, car)) { db.activity(uid, 'car_not_owned', { car }, true); return json(res, 403, { error: 'Você não possui este carro' }); }
      const pl = hub.online.get(uid);
      if (pl && pl.race) return json(res, 409, { error: 'Em corrida' });
      const look = cleanLook(b.look);
      db.setActiveCar(uid, car, Object.keys(look).length ? look : null);
      if (pl) { pl.car = car; pl.look = db.carLook(uid, car) || {}; pl.room && pl.room.broadcast({ t: 'look', id: uid, car: pl.car, look: pl.look }); }
      return json(res, 200, { ok: true, profile: db.profile(uid) });
    }
    if (p === '/api/history' && M === 'GET') return json(res, 200, { rows: db.q('SELECT r.*, ra.kind, ra.route, ra.created_at FROM race_results r JOIN races ra ON ra.id = r.race_id WHERE r.user_id = ? ORDER BY ra.created_at DESC LIMIT 30').all(uid), tx: db.q('SELECT amount, balance, kind, ref, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(uid) });
    return json(res, 404, { error: 'Rota não encontrada' });
  }

  // update channel for the installer/launcher (folder produced by tools/release.mjs)
  function serveUpdate(req, res, url) {
    const rel = decodeURIComponent(url.pathname.slice('/updates/'.length));
    if (!/^(manifest\.json(\.sig)?|objects\/[0-9a-f]{64}|versions\/\d+\.\d+\.\d+\.json)$/.test(rel)) { res.writeHead(404); return res.end('not found'); }
    const file = join(config.updatesDir, rel);
    if (!existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const st = statSync(file);
    const immutable = rel.startsWith('objects/') || rel.startsWith('versions/');
    res.writeHead(200, { 'Content-Type': rel.endsWith('.json') ? 'application/json' : rel.endsWith('.sig') ? 'text/plain' : 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  function serveStatic(req, res, url) {
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    if (STATIC_DENY.test(path)) { res.writeHead(404); return res.end('not found'); }
    const file = normalize(join(config.root, path));
    if (!file.startsWith(config.root) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    const st = statSync(file); if (!st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const big = /\.(glb|bin|png|jpg|wav|ogg)$/i.test(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': big ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (config.corsOrigin) { res.setHeader('Access-Control-Allow-Origin', config.corsOrigin); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); } }
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true, uptime: Math.round(process.uptime()), online: hub.online.size, rooms: hub.rooms.size, db: !!db.q('SELECT 1 AS ok').get() });
      if (url.pathname === '/metrics') {
        if (config.isProd && config.adminToken && req.headers.authorization !== 'Bearer ' + config.adminToken) return json(res, 401, { error: 'unauthorized' });
        return json(res, 200, hub.metrics(url.searchParams.get('reset') === '1'));
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname.startsWith('/updates/') && (req.method === 'GET' || req.method === 'HEAD')) return serveUpdate(req, res, url);
      if (config.serveStatic && (req.method === 'GET' || req.method === 'HEAD')) return serveStatic(req, res, url);
      res.writeHead(404); res.end();
    } catch (e) { log.error('http error', { path: url.pathname, e: e.message }); if (!res.headersSent) json(res, 500, { error: 'Erro interno' }); }
  });
  server.on('upgrade', (req, socket) => {
    if (!req.url.startsWith('/ws')) return socket.destroy();
    const conn = acceptUpgrade(req, socket, { maxPayload: 32 * 1024 });
    if (conn) hub.onConnection(conn);
  });
  // keepalive / dead connection detection
  const ka = setInterval(() => { for (const p of hub.online.values()) if (p.conn && p.online) { if (Date.now() - p.conn.lastSeen > 20000) p.conn.close(4010, 'timeout'); else p.conn.ping(); } }, 5000);
  const bk = config.backupEveryMin > 0 ? setInterval(() => db.backup().catch(e => log.error('backup failed', { e: e.message })), config.backupEveryMin * 60e3) : null;
  const sweep = setInterval(() => { apiLimit.sweep(); regLimit.sweep(); loginFail.sweep(); hub.connLimit.sweep(); db.purgeSessions(); }, 300e3);

  const ready = new Promise(res => server.listen(config.port, config.host, () => { log.info('server listening', { host: config.host, port: server.address().port, env: config.env, db: config.dbPath, region: config.region }); res(server.address().port); }));
  async function stop() {
    clearInterval(ka); clearInterval(sweep); bk && clearInterval(bk);
    hub.stop();
    await new Promise(r => server.close(r));
    server.closeAllConnections?.();
    db.close();
  }
  return { server, hub, db, ready, stop };
}

// run directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const s = startServer();
  const shutdown = async (sig) => { log.info('shutting down', { sig }); try { await s.db.backup(); } catch (e) { log.error('final backup failed', { e: e.message }); } await s.stop(); process.exit(0); };
  process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', e => log.error('uncaught', { e: e.message, stack: e.stack }));
  process.on('unhandledRejection', e => log.error('unhandled rejection', { e: String(e) }));
}
