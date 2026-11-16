// =====================================================================
//  Configuration from environment variables (+ optional .env file).
//  Never commit real secrets: copy .env.example to .env.
// =====================================================================
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(process.env.ENV_FILE || resolve(ROOT, '.env'));

const env = (k, d) => process.env[k] ?? d;
const int = (k, d) => { const v = parseInt(env(k, ''), 10); return Number.isFinite(v) ? v : d; };

export const config = {
  root: ROOT,
  env: env('NODE_ENV', 'development'),
  host: env('HOST', '0.0.0.0'),
  port: int('PORT', 8090),
  publicUrl: env('PUBLIC_URL', ''),
  serverName: env('SERVER_NAME', 'Kaido Nights — Servidor 1'),
  region: env('REGION', 'sa-east'),
  dbPath: resolve(ROOT, env('DB_PATH', 'data/kaido.db')),
  backupDir: resolve(ROOT, env('BACKUP_DIR', 'data/backups')),
  backupEveryMin: int('BACKUP_EVERY_MIN', 60),
  backupKeep: int('BACKUP_KEEP', 24),
  logDir: resolve(ROOT, env('LOG_DIR', 'logs')),
  updatesDir: resolve(ROOT, env('UPDATES_DIR', 'release')),
  logLevel: env('LOG_LEVEL', 'info'),
  roomCapacity: int('ROOM_CAPACITY', 24),
  maxRooms: int('MAX_ROOMS', 8),
  tickHz: int('TICK_HZ', 15),
  sessionDays: int('SESSION_DAYS', 30),
  eventEveryMin: int('EVENT_EVERY_MIN', 8),
  eventJoinSec: int('EVENT_JOIN_SEC', 60),
  serveStatic: env('SERVE_STATIC', '1') === '1',
  corsOrigin: env('CORS_ORIGIN', ''),
  trustProxy: env('TRUST_PROXY', '0') === '1',
  reconnectGraceSec: int('RECONNECT_GRACE_SEC', 25),
  registerPerMin: int('REGISTER_PER_MIN', 5),
  connBurst: int('CONN_PER_MIN_PER_IP', 30),
  apiBurst: int('API_BURST', 40),
  apiPerSec: int('API_PER_SEC', 2),
  loginFailPer5Min: int('LOGIN_FAIL_PER_5MIN', 8),
  adminToken: env('ADMIN_TOKEN', ''),   // optional: protects /metrics in production
};
config.isProd = config.env === 'production';
for (const d of [dirname(config.dbPath), config.backupDir, config.logDir]) mkdirSync(d, { recursive: true });
