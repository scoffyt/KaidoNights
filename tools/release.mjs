// =====================================================================
//  Publishes a new version for the installer/launcher update channel.
//
//    node tools/release.mjs                    # bump patch version (2.0.0 -> 2.0.1)
//    node tools/release.mjs --version 2.1.0 --notes "Novo mapa e correções"
//
//  Output (upload the whole folder to any static host, or let the Node
//  server publish it at /updates/):
//    release/manifest.json       list of files {p: path, s: size, h: sha256} + version + notes
//    release/manifest.json.sig   RSA-SHA256 signature (PKCS#1 v1.5) of manifest.json
//    release/objects/<sha256>    file contents, content-addressed (unchanged files are reused)
//    release/versions/<v>.json   archived manifests
//
//  GitHub channel (used by .github/workflows/release.yml on every push to main):
//    node tools/release.mjs --channel github          → channel/manifest.json(.sig)
//    files are downloaded straight from raw.githubusercontent.com/<repo>/<commit>/<path>;
//    version = <major>.<minor> from package.json + number of commits; key from $RELEASE_PRIVATE_KEY.
//
//  Keys: keys/release-private.pem (KEEP SECRET, never upload) is created on first run;
//  its public half is written to launcher/update-key.xml, which ships with the game.
// =====================================================================
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GITHUB = arg('--channel') === 'github';
const OUT = resolve(ROOT, arg('--out') || (GITHUB ? 'channel' : 'release'));
const KEY = resolve(ROOT, 'keys', 'release-private.pem');

// what players receive (everything needed to play offline, host the online server and update)
const INCLUDE = ['index.html', 'R34.glb', 'servidor.ps1', 'INICIAR_JOGO.bat', 'INICIAR_SERVIDOR_ONLINE.bat', 'INSTALAR.bat', 'package.json', '.env.example',
  'README.md', 'MULTIPLAYER.md', 'ATUALIZACOES.md', 'css', 'src', 'lib', 'assets', 'server', 'launcher'];
const EXCLUDE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|\.(log|db|db-wal|db-shm)$/i;

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }
function walk(p, out = []) {
  if (!existsSync(p)) return out;
  const st = statSync(p);
  if (st.isDirectory()) for (const f of readdirSync(p).sort()) walk(join(p, f), out);
  else out.push(p);
  return out;
}
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const b64urlToB64 = s => s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);

// ---- keys
mkdirSync(dirname(KEY), { recursive: true });
if (process.env.RELEASE_PRIVATE_KEY) writeFileSync(KEY, process.env.RELEASE_PRIVATE_KEY.replace(/\\n/g, '\n'), { mode: 0o600 });
if (GITHUB && !existsSync(KEY)) throw new Error('RELEASE_PRIVATE_KEY não definido (segredo do repositório no GitHub).');
if (!existsSync(KEY)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
  writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(join(dirname(KEY), 'LEIA-ME.txt'), 'release-private.pem assina as atualizações do jogo.\r\nNUNCA envie este arquivo para o servidor, repositório ou jogadores.\r\nFaça backup: sem ela você não consegue publicar atualizações para quem já instalou.\r\n');
  console.log('nova chave de assinatura criada em', KEY);
}
const priv = createPrivateKey(readFileSync(KEY));
const jwk = createPublicKey(priv).export({ format: 'jwk' });
const keyXml = `<RSAKeyValue><Modulus>${b64urlToB64(jwk.n)}</Modulus><Exponent>${b64urlToB64(jwk.e)}</Exponent></RSAKeyValue>`;
mkdirSync(join(ROOT, 'launcher'), { recursive: true });
if (GITHUB) {
  // the public key players already have must match the signing key
  const shipped = existsSync(join(ROOT, 'launcher', 'update-key.xml')) ? readFileSync(join(ROOT, 'launcher', 'update-key.xml'), 'utf8').trim() : '';
  if (shipped !== keyXml) throw new Error('launcher/update-key.xml não corresponde ao segredo RELEASE_PRIVATE_KEY.');
} else writeFileSync(join(ROOT, 'launcher', 'update-key.xml'), keyXml);

// ---- version
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
let prev = null; try { prev = JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')); } catch { }
let version = arg('--version');
if (GITHUB && !version) {
  const [a, b] = pkg.version.split('.').map(Number);
  version = `${a}.${b}.${execSync('git rev-list --count HEAD', { cwd: ROOT }).toString().trim()}`;
  prev = null;
}
if (!version) {
  const base = prev ? prev.version : pkg.version;
  const [a, b, c] = base.split('.').map(Number);
  version = prev ? `${a}.${b}.${c + 1}` : base;
}
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('versão inválida: ' + version);
if (prev && cmp(version, prev.version) <= 0) throw new Error(`a versão ${version} precisa ser maior que a publicada (${prev.version})`);
function cmp(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
let notes = arg('--notes') || '';
if (GITHUB && !notes) { try { notes = execSync('git log -1 --pretty=%s', { cwd: ROOT }).toString().trim().slice(0, 300); } catch { } }
if (!GITHUB) {
  pkg.version = version;
  writeFileSync(join(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  writeFileSync(join(ROOT, 'version.json'), JSON.stringify({ version, released: new Date().toISOString(), notes }, null, 2) + '\n');
}
// GitHub channel: only files committed in git exist at raw.githubusercontent.com/<repo>/<commit>/
const tracked = GITHUB ? new Set(execSync('git ls-files -z', { cwd: ROOT }).toString().split('\0').filter(Boolean)) : null;
const repo = arg('--repo') || process.env.GITHUB_REPOSITORY || 'scoffyt/KaidoNights';
const commit = arg('--sha') || process.env.GITHUB_SHA || (GITHUB ? execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim() : '');

// ---- files → objects
mkdirSync(join(OUT, 'objects'), { recursive: true }); mkdirSync(join(OUT, 'versions'), { recursive: true });
const files = [];
let newBytes = 0, total = 0;
for (const inc of INCLUDE) for (const abs of walk(join(ROOT, inc))) {
  const rel = relative(ROOT, abs).split(sep).join('/');
  if (EXCLUDE.test(rel)) continue;
  if (tracked && !tracked.has(rel)) continue;
  const buf = readFileSync(abs);
  const h = sha(buf);
  if (!GITHUB) { const obj = join(OUT, 'objects', h); if (!existsSync(obj)) { copyFileSync(abs, obj); newBytes += buf.length; } }
  total += buf.length;
  files.push({ p: rel, s: buf.length, h });
}
// native app (dist/native from tools/build-native.ps1): KaidoNights.exe + WebView2 DLLs at the install root.
// They are build outputs (not in git), so on the GitHub channel they travel as objects in the update-channel branch.
const nativeDir = arg('--native');
if (nativeDir) {
  const nd = resolve(ROOT, nativeDir);
  if (!existsSync(join(nd, 'KaidoNights.exe'))) throw new Error('KaidoNights.exe não encontrado em ' + nd);
  mkdirSync(join(OUT, 'objects'), { recursive: true });
  for (const name of readdirSync(nd).sort()) {
    const buf = readFileSync(join(nd, name)); const h = sha(buf);
    const obj = join(OUT, 'objects', h);
    if (!existsSync(obj)) { copyFileSync(join(nd, name), obj); newBytes += buf.length; }
    total += buf.length;
    const entry = { p: name, s: buf.length, h };
    if (GITHUB && !process.argv.includes('--native-in-tree')) entry.u = `https://raw.githubusercontent.com/${repo}/update-channel/objects/${h}`;
    files.push(entry);
  }
}
const manifest = { app: 'kaido-nights', version, released: new Date().toISOString(), notes, minLauncher: 1, files };
if (GITHUB) { manifest.fileBase = `https://raw.githubusercontent.com/${repo}/${commit}/`; manifest.commit = commit; manifest.repo = repo; }
const text = JSON.stringify(manifest);
const sig = sign('sha256', Buffer.from(text, 'utf8'), priv).toString('base64');
writeFileSync(join(OUT, 'manifest.json'), text);
writeFileSync(join(OUT, 'manifest.json.sig'), sig);
writeFileSync(join(OUT, 'versions', version + '.json'), text);
if (!GITHUB) {
  // local copy so an install made from this folder knows its own version
  mkdirSync(join(ROOT, '.kaido'), { recursive: true });
  writeFileSync(join(ROOT, '.kaido', 'manifest.json'), text);
}
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`, { flag: 'a' });

const changed = prev ? files.filter(f => !prev.files.some(o => o.p === f.p && o.h === f.h)) : files;
console.log(`versão ${version} publicada em ${OUT}`);
console.log(`${files.length} arquivos, ${(total / 1048576).toFixed(1)} MB no total; ${changed.length} alterados desde ${prev ? prev.version : '—'} (${(newBytes / 1048576).toFixed(2)} MB novos para baixar)`);
