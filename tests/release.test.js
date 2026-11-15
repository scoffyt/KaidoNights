// Update channel: the manifest signature must verify with the public key shipped to players
// (launcher/update-key.xml, the same XML the PowerShell launcher loads), the Node server must
// publish release/ at /updates/, and every object must match its SHA-256.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { createPublicKey, verify, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const has = existsSync(join(ROOT, 'release', 'manifest.json'));
const b64url = s => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function keyFromXml(xml) {
  const n = /<Modulus>(.*?)<\/Modulus>/.exec(xml)[1], e = /<Exponent>(.*?)<\/Exponent>/.exec(xml)[1];
  return createPublicKey({ key: { kty: 'RSA', n: b64url(n), e: b64url(e) }, format: 'jwk' });
}

test('manifest signature verifies with launcher/update-key.xml and tampering is detected', { skip: !has && 'run tools/release.mjs first' }, () => {
  const key = keyFromXml(readFileSync(join(ROOT, 'launcher', 'update-key.xml'), 'utf8'));
  const bytes = readFileSync(join(ROOT, 'release', 'manifest.json'));
  const sig = Buffer.from(readFileSync(join(ROOT, 'release', 'manifest.json.sig'), 'utf8').trim(), 'base64');
  assert.equal(verify('sha256', bytes, key, sig), true);
  const evil = Buffer.from(bytes.toString('utf8').replace('"version":"', '"version":"9'), 'utf8');
  assert.equal(verify('sha256', evil, key, sig), false);
});

test('server publishes the update channel and every object matches its hash', { skip: !has && 'run tools/release.mjs first', timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kaido-upd-'));
  process.env.LOG_QUIET = '1'; process.env.LOG_DIR = join(dir, 'logs'); process.env.BACKUP_DIR = join(dir, 'bk');
  const { startServer } = await import('../server/index.js');
  const s = startServer({ port: 0, host: '127.0.0.1', dbPath: join(dir, 'u.db'), backupEveryMin: 0, serveStatic: true });
  const base = `http://127.0.0.1:${await s.ready}`;
  try {
    const m = await (await fetch(base + '/updates/manifest.json')).json();
    assert.equal(m.app, 'kaido-nights');
    assert.ok(m.files.length > 100);
    assert.ok(m.files.some(f => f.p === 'launcher/Launcher.ps1') && m.files.some(f => f.p === 'launcher/update-key.xml'));
    assert.ok(!m.files.some(f => /^(keys|release|data|logs|tests)\//.test(f.p)), 'private folders are never published');
    for (const f of m.files) {
      const r = await fetch(base + '/updates/objects/' + f.h);
      assert.equal(r.status, 200, f.p);
      const buf = Buffer.from(await r.arrayBuffer());
      assert.equal(buf.length, f.s, f.p);
      assert.equal(createHash('sha256').update(buf).digest('hex'), f.h, f.p);
    }
    assert.equal((await fetch(base + '/updates/../keys/release-private.pem')).status, 404);
    assert.equal((await fetch(base + '/keys/release-private.pem')).status, 404, 'private key is never served');
    assert.equal((await fetch(base + '/release/manifest.json')).status, 404);
    assert.equal((await fetch(base + '/updates/objects/notahash')).status, 404);
  } finally { await s.stop(); }
});
