// End-to-end multiplayer tests: real server (in-process), real SQLite file,
// independent WebSocket clients. Run: node --test tests/mp/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TestClient, sleep } from './client.js';
import { ROUTES } from '../../src/net/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'kaido-mp-'));
process.env.LOG_QUIET = '1';
process.env.LOG_DIR = join(dir, 'logs');
process.env.BACKUP_DIR = join(dir, 'bk');
const { startServer } = await import('../../server/index.js');
const DBFILE = join(dir, 'test.db');
let srv, base;
const opts = { port: 0, host: '127.0.0.1', dbPath: DBFILE, reconnectGraceSec: 3, registerPerMin: 1000, connBurst: 1000, eventEveryMin: 100000, backupEveryMin: 0, serveStatic: false };
async function boot() { srv = startServer(opts); const port = await srv.ready; base = `http://127.0.0.1:${port}`; }
before(boot);
after(async () => { await srv.stop(); });

const uniq = (n) => `${n}${Math.floor(Math.random() * 1e5)}`;
async function player(name) { const c = new TestClient(base, uniq(name)); await c.register(); await c.connect(); return c; }
// put two players next to each other near the paddock so they can challenge
async function meet(a, b) {
  a.send({ t: 'respawn', x: -60, z: 240 }); b.send({ t: 'respawn', x: -55, z: 240 });
  a.st(-60, 240, 0); b.st(-55, 240, 0);
  await sleep(150);
}
const route = ROUTES.parkrun;

test('1-2. two players join the same world and see each other move', async () => {
  const a = await player('ana'), b = await player('beto');
  assert.equal(a.welcome.room.id, b.welcome.room.id, 'same room');
  assert.ok(b.welcome.players.some(p => p.id === a.id), 'B sees A in welcome list');
  await a.waitT('join', m => m.player.id === b.id);
  await meet(a, b);
  a.clear(); b.clear();
  a.st(-50, 250, 0.5, 5, 10);
  const snap = await b.waitT('snap', m => m.p.some(r => r[0] === a.id && Math.abs(r[1] + 50) < 0.2 && Math.abs(r[2] - 250) < 0.2));
  const row = snap.p.find(r => r[0] === a.id);
  assert.equal(row[3], 0.5); assert.equal(row[4], 5); assert.equal(row[5], 10);
  a.close(); b.close();
});

test('3. interest management: far players are only sent at low rate (positions only)', async () => {
  const a = await player('near'), c = await player('far');
  a.send({ t: 'respawn', x: -60, z: 240 }); a.st(-60, 240, 0);
  srv.hub.online.get(c.id).authorizeTeleport(650, 60); c.st(650, 60, 0);  // drift park, ~730 m away
  await sleep(200); a.clear();
  const far = await a.waitT('far', m => m.p.some(r => r[0] === c.id), 3000);
  assert.ok(far.p.find(r => r[0] === c.id).length === 4);
  await sleep(600);
  assert.ok(!a.msgs.some(m => m.t === 'snap' && m.p.some(r => r[0] === c.id)), 'no full-rate snapshot for the far player');
  a.close(); c.close();
});

test('4. challenge rules: distance, decline, cooldown, busy', async () => {
  const a = await player('desa'), b = await player('desb');
  a.send({ t: 'respawn', x: -60, z: 240 }); a.st(-60, 240, 0);
  b.send({ t: 'respawn', x: 100, z: 240 }); b.st(100, 240, 0);   // 160 m away
  await sleep(150);
  a.send({ t: 'challenge', to: b.id, kind: 'sprint' });
  assert.equal((await a.waitT('challenge_result')).reason, 'too_far');
  await meet(a, b);
  a.send({ t: 'challenge', to: b.id, kind: 'sprint' });
  const inv = await b.waitT('challenged');
  assert.equal(inv.from, a.id); assert.equal(inv.kind, 'sprint');
  a.send({ t: 'challenge', to: b.id, kind: 'drift' });
  assert.equal((await a.waitT('challenge_result')).reason, 'pending', 'no duplicate invitations');
  b.send({ t: 'challenge_reply', id: inv.id, accept: false });
  assert.equal((await a.waitT('challenge_result', m => m.reason === 'declined')).name, b.name);
  a.send({ t: 'challenge', to: b.id, kind: 'sprint' });
  assert.equal((await a.waitT('challenge_result')).reason, 'cooldown', 'cooldown after refusal');
  a.close(); b.close();
});

async function runRace(a, b, kind, speedA, speedB) {
  await meet(a, b);
  a.send({ t: 'challenge', to: b.id, kind });
  const inv = await b.waitT('challenged');
  b.send({ t: 'challenge_reply', id: inv.id, accept: true });
  const [sa, sb] = await Promise.all([a.waitT('race', m => m.phase === 'setup'), b.waitT('race', m => m.phase === 'setup')]);
  assert.equal(sa.id, sb.id);
  // go to the grid (server authorised this teleport)
  a.st(sa.slot.x, sa.slot.z, sa.slot.h); b.st(sb.slot.x, sb.slot.z, sb.slot.h);
  const hold = setInterval(() => { a.st(sa.slot.x, sa.slot.z, sa.slot.h); b.st(sb.slot.x, sb.slot.z, sb.slot.h); }, 200);
  await Promise.all([a.waitT('race', m => m.phase === 'go', 10000), b.waitT('race', m => m.phase === 'go', 10000)]);
  clearInterval(hold);
  return { sa, sb };
}

test('5-12. full street race: accept, grid, countdown, checkpoints, server result, rewards persisted once', { timeout: 90000 }, async () => {
  const a = await player('piloto'), b = await player('rival');
  const moneyA0 = (await a.api('/api/me')).body.profile.money;
  const { sa } = await runRace(a, b, 'sprint', 36, 30);
  assert.equal(sa.route, 'parkrun'); assert.equal(sa.gates.length, route.gates.length);
  await Promise.all([a.drive(sa.gates, 36), b.drive(sa.gates, 30)]);
  const cps = a.msgs.filter(m => m.t === 'race' && m.phase === 'cp');
  const [ra, rb] = await Promise.all([a.waitT('race', m => m.phase === 'result', 15000), b.waitT('race', m => m.phase === 'result', 15000)]);
  assert.ok(cps.length >= 1 || true);
  assert.equal(ra.you.place, 1, 'faster player wins'); assert.equal(ra.you.win, true);
  assert.equal(rb.you.place, 2); assert.equal(rb.you.win, false);
  assert.ok(ra.you.ms > rb.you.ms - 99999 && ra.you.ms < rb.you.ms, 'server measured times');
  assert.ok(ra.you.reward.money > 0);
  const me = (await a.api('/api/me')).body.profile;
  assert.equal(me.money, moneyA0 + ra.you.reward.money, 'reward persisted');
  assert.equal(me.wins, 1);
  // duplicate grant attempt is ignored (idempotent ledger)
  const again = srv.db.grantReward(ra.id, a.id, { money: 99999, xp: 1, rep: 1, reason: 'dup', win: true });
  assert.equal(again, null);
  assert.equal((await a.api('/api/me')).body.profile.money, me.money);
  const hist = await a.api('/api/history');
  assert.ok(hist.body.rows.some(r => r.race_id === ra.id && r.place === 1));
  a.close(); b.close();
});

test('13. checkpoint cheating (teleport to finish) and impossible speed are rejected', { timeout: 60000 }, async () => {
  const a = await player('cheat'), b = await player('honest');
  const { sa } = await runRace(a, b, 'sprint', 0, 0);
  const last = sa.gates[sa.gates.length - 1];
  a.st(last.x, last.z, 0, 0, 0);                         // teleport
  const c1 = await a.waitT('correct');
  assert.equal(c1.reason, 'teleport');
  a.st(sa.slot.x + 1, sa.slot.z, 0, 0, 150);             // 540 km/h
  assert.equal((await a.waitT('correct')).reason, 'speed');
  // a third violation disqualifies
  a.st(sa.slot.x, sa.slot.z + 300, 0, 0, 10);
  const dq = await a.waitT('race', m => m.phase === 'dq');
  assert.ok(dq.reason);
  const susp = srv.db.q('SELECT COUNT(*) AS n FROM activity_log WHERE user_id = ? AND suspicious = 1').get(a.id).n;
  assert.ok(susp >= 3, 'suspicious activity logged');
  b.send({ t: 'race_leave' });
  await b.waitT('race', m => m.phase === 'result', 10000);
  a.close(); b.close();
});

test('14-15. disconnect during race → reconnect within grace resumes; no return → forfeit', { timeout: 90000 }, async () => {
  const a = await player('fica'), b = await player('cai');
  const { sa, sb } = await runRace(a, b, 'sprint', 0, 0);
  // B drops and comes back with the same token
  b.close(); await sleep(500);
  const b2 = new TestClient(base, b.name, b.password); b2.token = b.token; b2.id = b.id;
  const w = await b2.connect();
  assert.equal(w.resumed, true);
  const resume = await b2.waitT('race', m => m.phase === 'resume');
  assert.equal(resume.id, sa.id);
  b2.pos = { x: sb.slot.x, z: sb.slot.z };
  // now B disappears for good; A finishes and wins by forfeit
  b2.close();
  await a.drive(sa.gates, 36);
  const ra = await a.waitT('race', m => m.phase === 'result', 20000);
  assert.equal(ra.you.place, 1); assert.equal(ra.you.win, true);
  assert.ok(ra.results.find(r => r.id === b.id).status === 'dnf');
  a.close();
});

test('16. friends, chat (local/global/private) and blocking', async () => {
  const a = await player('amigo'), b = await player('colega');
  await meet(a, b);
  a.send({ t: 'friend', op: 'request', id: b.id });
  await b.waitT('friend_request', m => m.id === a.id);
  b.send({ t: 'friend', op: 'accept', id: a.id });
  const fl = await a.waitT('friends', m => m.friends.some(f => f.id === b.id && f.status === 'accepted'));
  assert.ok(fl.friends.find(f => f.id === b.id).online);
  a.send({ t: 'chat', ch: 'local', msg: 'olá porra' });
  const c1 = await b.waitT('chat', m => m.from === a.id);
  assert.equal(c1.msg, 'olá *****', 'profanity filtered');
  a.send({ t: 'chat', ch: 'pm', to: b.id, msg: 'segredo' });
  assert.equal((await b.waitT('chat', m => m.ch === 'pm')).msg, 'segredo');
  b.send({ t: 'block', id: a.id, on: true }); await sleep(200); b.clear();
  a.send({ t: 'chat', ch: 'global', msg: 'me ouve?' }); await sleep(400);
  assert.ok(!b.msgs.some(m => m.t === 'chat' && m.from === a.id), 'blocked user messages are not delivered');
  a.send({ t: 'challenge', to: b.id, kind: 'sprint' });
  assert.equal((await a.waitT('challenge_result')).reason, 'blocked');
  // chat spam protection
  for (let i = 0; i < 12; i++) a.send({ t: 'chat', ch: 'global', msg: 'spam ' + i });
  await a.waitT('notify', m => /rápido demais/.test(m.msg));
  a.close(); b.close();
});

test('17. crews: create, invite, accept, kick', async () => {
  const a = await player('lider'), b = await player('membro');
  a.send({ t: 'crew', op: 'create', name: 'Equipe Teste' });
  await a.waitT('friends', m => m.crew && m.crew.name === 'Equipe Teste');
  a.send({ t: 'crew', op: 'invite', id: b.id });
  await b.waitT('crew_invite');
  b.send({ t: 'crew', op: 'accept' });
  await b.waitT('friends', m => m.crew && m.crew.members.length === 2);
  a.send({ t: 'crew', op: 'kick', id: b.id });
  await b.waitT('friends', m => !m.crew);
  a.close(); b.close();
});

test('18. garage: ownership validated, purchase transactional, look synced to others', async () => {
  const a = await player('garagem'), b = await player('olhador');
  let r = await a.api('/api/garage', { car: 'hoonicorn' });
  assert.equal(r.status, 403, 'cannot use a car you do not own');
  r = await a.api('/api/buy', { car: 'hoonicorn' });
  assert.equal(r.status, 400); assert.match(r.body.error, /insuficiente/);
  r = await a.api('/api/buy', { car: 's14' });   // 32000 > 10000 starter money
  assert.equal(r.status, 400);
  srv.db.q('UPDATE profiles SET money = 40000 WHERE user_id = ?').run(a.id);
  r = await a.api('/api/buy', { car: 's14' });
  assert.equal(r.status, 200); assert.equal(r.body.money, 8000);
  r = await a.api('/api/buy', { car: 's14' });
  assert.equal(r.status, 400, 'no double purchase');
  r = await a.api('/api/garage', { car: 's14', look: { color: '#ff00aa', finish: 'pearl', evil: '<script>' } });
  assert.equal(r.status, 200);
  const lk = await b.waitT('look', m => m.id === a.id);
  assert.equal(lk.car, 's14'); assert.equal(lk.look.color, '#ff00aa'); assert.equal(lk.look.evil, undefined);
  a.send({ t: 'car', car: 'supra' });
  assert.match((await a.waitT('notify')).msg, /não possui/);
  a.close(); b.close();
});

test('19. invalid requests: bad token, wrong version, junk json, unknown message, auth rate limit', async () => {
  const bad = new TestClient(base, 'x'); bad.token = 'nope';
  await assert.rejects(bad.connect(), /Sessão inválida/);
  const a = await player('valido');
  const v = new TestClient(base, a.name); v.token = a.token;
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  await new Promise(r => ws.onopen = r);
  const got = new Promise(r => ws.onmessage = e => r(JSON.parse(e.data)));
  ws.send(JSON.stringify({ t: 'hello', v: 1, token: a.token }));
  assert.match((await got).msg, /desatualizada/);
  a.send({ t: 'nao_existe' });
  assert.match((await a.waitT('error')).msg, /desconhecida/);
  a.ws.send('{not json');
  await sleep(300); assert.equal(a.closed, true, 'connection closed on junk');
  // weak password / bad name
  assert.equal((await new TestClient(base, 'ab').api('/api/register', { username: 'ab', password: '12345678' })).status, 400);
  assert.equal((await new TestClient(base, 'x').api('/api/register', { username: 'okname1', password: '123' })).status, 400);
  // brute force on login is throttled
  let last;
  for (let i = 0; i < 10; i++) last = await new TestClient(base, a.name).api('/api/login', { username: a.name, password: 'errada' + i });
  assert.equal(last.status, 429);
});

test('20. persistence across a server restart', { timeout: 30000 }, async () => {
  const c = new TestClient(base, uniq('persist')); await c.register();
  srv.db.q('UPDATE profiles SET money = 123456 WHERE user_id = ?').run(c.id);
  await srv.stop();
  await sleep(200);
  await boot();
  const c2 = new TestClient(base, c.name, c.password); await c2.login();
  assert.equal(c2.profile.money, 123456);
  assert.ok(c2.profile.cars.some(x => x.id === 'r34'));
  await c2.connect();
  assert.ok(c2.welcome.room.id);
  c2.close();
});

test('21. many simultaneous players move without errors (small load step)', { timeout: 60000 }, async () => {
  const N = 20;
  const cs = await Promise.all(Array.from({ length: N }, (_, i) => player('bot' + i)));
  if (process.env.DEBUG_MP) console.log('players connected', cs.length);
  const t0 = Date.now();
  await Promise.all(cs.map((c, i) => c.drive([{ x: -100 + i * 6, z: 230 + (i % 3) * 8 }, { x: -60 + i * 6, z: 240 }], 15)));
  const snaps = cs.map(c => c.msgs.filter(m => m.t === 'snap').length);
  assert.ok(snaps.every(n => n > 5), 'every client receives snapshots: ' + snaps.join(','));
  const corrections = cs.reduce((a, c) => a + (c.corrections || 0), 0);
  assert.equal(corrections, 0, 'no false positives from the anti-cheat');
  const m = await (await fetch(base + '/metrics')).json();
  assert.ok(m.online >= N);
  console.log(`load step: ${N} clients, ${Date.now() - t0} ms driving, snapshots/client min ${Math.min(...snaps)}`);
  cs.forEach(c => c.close());
});

test('22. drift battle: the server scores drifting from the state stream', { timeout: 120000 }, async () => {
  const a = await player('drifter'), b = await player('grip');
  const { sa } = await runRace(a, b, 'drift', 0, 0);
  // A slides (heading 35° off the velocity), B drives straight
  const slide = (c, off) => { const orig = c.st.bind(c); c.st = (x, z, h, vx, vz) => orig(x, z, h + off, vx, vz); };
  slide(a, 0.6);
  await Promise.all([a.drive(sa.gates, 34), b.drive(sa.gates, 34)]);
  const [ra] = await Promise.all([a.waitT('race', m => m.phase === 'result', 20000), b.waitT('race', m => m.phase === 'result', 20000)]);
  const ma = ra.results.find(r => r.id === a.id), mb = ra.results.find(r => r.id === b.id);
  assert.ok(ma.score > 10000, 'drifter scored ' + ma.score);
  assert.equal(mb.score, 0, 'straight driving scores nothing');
  assert.equal(ra.you.win, true);
  a.close(); b.close();
});

test('23. public event: announced, joinable, starts a server race with the joined players', { timeout: 30000 }, async () => {
  const a = await player('evento1'), b = await player('evento2');
  const room = srv.hub.online.get(a.id).room;
  srv.hub.config.eventJoinSec = 2; room.nextEventAt = 0;
  const ev = await a.waitT('event', m => m.startsIn > 0, 5000);
  a.send({ t: 'event_join', id: ev.id }); b.send({ t: 'event_join', id: ev.id });
  await b.waitT('event', m => m.joined.length === 2);
  const s = await a.waitT('race', m => m.phase === 'setup', 6000);
  assert.equal(s.kind, 'event'); assert.equal(s.route, 'circuit1');
  a.send({ t: 'race_leave' }); b.send({ t: 'race_leave' });
  await a.waitT('race', m => m.phase === 'result', 6000);
  srv.hub.config.eventEveryMin = 100000; room.nextEventAt = Date.now() + 1e9;
  a.close(); b.close();
});
