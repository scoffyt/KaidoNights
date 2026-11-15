// Two independent browser clients (separate browser contexts = separate
// localStorage/cookies, like two computers) join the dedicated server,
// see each other, exchange chat, and start a street challenge.
// Usage: node tests/browser/two-clients.cjs http://localhost:8099
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://localhost:8099';
const OUT = process.env.OUT || '/tmp/t';
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const mk = async (tag) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log(`[${tag} pageerror]`, e.message));
    p.on('console', m => { if (m.type() === 'error') console.log(`[${tag}]`, m.text().slice(0, 200)); });
    await p.addInitScript(() => { try { const k = 'kaido-nights-save-v1'; const s = JSON.parse(localStorage.getItem(k) || '{}'); s.settings = Object.assign(s.settings || {}, { quality: 'low' }); localStorage.setItem(k, JSON.stringify(s)); } catch { } });
    await p.goto(BASE + '/index.html');
    await p.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 240000 });
    await p.evaluate(() => { const g = window.__game; g.audio.init(); g.toMenu('online'); });
    return p;
  };
  const [A, B] = await Promise.all([mk('A'), mk('B')]);
  const name = (t) => t + Math.floor(Math.random() * 1e5);
  for (const [p, n] of [[A, name('Ana')], [B, name('Beto')]]) {
    await p.evaluate(async (n) => { const g = window.__game; await g.net.detect(); await g.net.register(n, 'senha-forte-123'); await g.goOnline(); }, n);
  }
  await Promise.all([A, B].map(p => p.waitForFunction(() => window.__game.mode && window.__game.mode.key === 'online', null, { timeout: 60000 })));
  console.log('both online');
  // put them side by side near the paddock (respawn is server-authorised)
  for (const [p, x] of [[A, -60], [B, -52]]) await p.evaluate((x) => { const g = window.__game; g.player.place(x, 240, Math.PI / 2); g.mode.onRespawn(); }, x);
  await A.waitForFunction(() => window.__game.mode.remotes.size === 1 && [...window.__game.mode.remotes.values()][0].visual, null, { timeout: 60000 });
  await B.waitForFunction(() => window.__game.mode.remotes.size === 1 && [...window.__game.mode.remotes.values()][0].visual, null, { timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));
  const seen = await B.evaluate(() => { const r = [...window.__game.mode.remotes.values()][0]; return { name: r.info.name, x: r.veh.x.toFixed(1), z: r.veh.z.toFixed(1) }; });
  console.log('B sees A at', seen);
  // A drives forward a bit: B must see the movement
  await A.evaluate(() => { const g = window.__game; g.input.update = function () { Object.assign(this.state, { throttle: 0.6, brake: 0, steer: 0, handbrake: 0, analog: true }); }; });

  await A.waitForFunction(() => window.__game.player.veh.speed > 3, null, { timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  const seen2 = await B.evaluate(() => { const r = [...window.__game.mode.remotes.values()][0]; return { x: r.veh.x.toFixed(1), z: r.veh.z.toFixed(1), speed: (r.veh.speed * 3.6).toFixed(0) }; });
  const aPos = await A.evaluate(() => { const v = window.__game.player.veh; return { x: v.x.toFixed(1), z: v.z.toFixed(1) }; });
  console.log('A real position', aPos, '— B sees', seen2);
  await A.evaluate(() => { const g = window.__game; delete g.input.update; });
  // chat
  await A.evaluate(() => window.__game.mode.submitChat('/g olá do cliente A'));
  await B.waitForFunction(() => window.__game.mode.chatLog.some(c => c.msg.includes('cliente A')), null, { timeout: 10000 });
  console.log('chat delivered');
  await B.screenshot({ path: OUT + '/mp_b_sees_a.png' });
  // street challenge from B to A
  await B.evaluate(() => { const g = window.__game; g.player.place(g.mode.remotes.values().next().value.veh.x - 8, g.mode.remotes.values().next().value.veh.z, Math.PI / 2); g.mode.onRespawn(); });
  await new Promise(r => setTimeout(r, 800));
  // A auto-accepts inside the page as soon as the invitation arrives (the software-rendered test browser is slow)
  const accepted = A.evaluate(() => new Promise((res, rej) => { const m = window.__game.mode; const t0 = Date.now(); const iv = setInterval(() => { if (m.incoming) { const label = m.incoming.label; m.replyChallenge(true); clearInterval(iv); res(label); } else if (Date.now() - t0 > 30000) { clearInterval(iv); rej(new Error('no invite')); } }, 50); }));
  await B.evaluate(() => { const g = window.__game; const id = g.mode.remotes.keys().next().value; g.mode.challenge(id, 'sprint'); });
  console.log('A received and accepted challenge:', await accepted);
  try { await Promise.all([A, B].map(p => p.waitForFunction(() => window.__game.mode.race && window.__game.mode.race.phase === 'running', null, { timeout: 45000 }))); }
  catch (e) { for (const p of [A, B]) console.log(await p.evaluate(() => JSON.stringify({ race: window.__game.mode.race && window.__game.mode.race.phase, notes: window.__game.mode.notes.map(n => n.msg) }))); throw e; }
  console.log('race running on both clients');
  await A.screenshot({ path: OUT + '/mp_a_race.png' });
  const gate = await A.evaluate(() => ({ gates: window.__game.mode.race.gates.length, arch: !!window.__game.mode.gateMesh }));
  console.log('race info', gate);
  await A.evaluate(() => window.__game.net.send({ t: 'race_leave' }));
  await B.waitForFunction(() => !!window.__game.mode.lastResult || window.__game.mode.notes.some(n => /saiu da corrida/.test(n.msg)), null, { timeout: 15000 });
  console.log('B notified that A left the race');
  await b.close();
  console.log('OK');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
