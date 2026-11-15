// Progressive load test against a running server (real WebSocket clients).
// Each simulated client registers, joins and drives in circles at 15 Hz,
// drifting part of the time; measures server tick time, CPU and traffic.
//   node tests/mp/load.mjs http://localhost:8090 10,25,50,100 30
import { TestClient, sleep } from './client.js';
const base = process.argv[2] || 'http://localhost:8090';
const steps = (process.argv[3] || '10,25,50').split(',').map(Number);
const holdSec = +(process.argv[4] || 20);
const clients = [];
async function addClient(i) {
  const c = new TestClient(base, `load${Date.now() % 1e6}_${i}`.slice(0, 16));
  await c.register(); await c.connect();
  // spread players over the paddock / circuit / road
  const cx = -120 + (i % 10) * 26, cz = 200 + Math.floor(i / 10) % 8 * 14;
  c.loop = { cx, cz, r: 10 + (i % 5) * 3, a: Math.random() * 6.28, w: 0.9 + (i % 3) * 0.3 };
  c.send({ t: 'respawn', x: cx + Math.cos(c.loop.a) * c.loop.r, z: cz + Math.sin(c.loop.a) * c.loop.r });
  return c;
}
function stepAll(dt) {
  for (const c of clients) {
    if (c.closed) continue;
    const L = c.loop; L.a += L.w * dt;
    const x = L.cx + Math.cos(L.a) * L.r, z = L.cz + Math.sin(L.a) * L.r;
    const vx = -Math.sin(L.a) * L.r * L.w, vz = Math.cos(L.a) * L.r * L.w;
    const h = Math.atan2(vx, vz) + (Math.sin(L.a * 0.5) > 0 ? 0.5 : 0); // drifting half of the lap
    c.st(x, z, h, vx, vz);
  }
}
const results = [];
for (const N of steps) {
  while (clients.length < N) {
    const batch = []; for (let k = 0; k < 10 && clients.length + batch.length < N; k++) batch.push(addClient(clients.length + batch.length));
    clients.push(...await Promise.all(batch));
  }
  await sleep(1000);
  await fetch(base + '/metrics').then(r => r.json());
  const cpu0 = process.cpuUsage();
  const m0 = await fetch(base + '/metrics?reset=1').then(r => r.json());
  const in0 = clients.reduce((a, c) => a + c.msgs.length, 0); clients.forEach(c => c.msgs.length = 0);
  const t0 = Date.now();
  while (Date.now() - t0 < holdSec * 1000) { stepAll(1 / 15); await sleep(1000 / 15); clients.forEach(c => { if (c.msgs.length > 200) c.msgs.length = 0; }); }
  const m1 = await fetch(base + '/metrics').then(r => r.json());
  const secs = (Date.now() - t0) / 1000;
  const bytes = m1.bytesOutLive - m0.bytesOutLive;
  const corr = clients.reduce((a, c) => a + (c.corrections || 0), 0);
  const r = { clients: N, rooms: m1.rooms.length, tickAvgMs: m1.tickAvgMs, tickMaxMs: m1.tickMaxMs, serverOutKBps: +(bytes / secs / 1024).toFixed(1), perClientKBps: +(bytes / secs / 1024 / N).toFixed(2), rssMB: +(m1.mem / 1048576).toFixed(0), falseCorrections: corr };
  results.push(r); console.log(JSON.stringify(r));
  void cpu0; void in0;
}
clients.forEach(c => c.close());
console.table(results);
process.exit(0);
