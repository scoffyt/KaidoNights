// Password hashing (scrypt), session tokens (random, stored hashed), rate limiting.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { LIMITS, sanitizeName } from '../src/net/shared.js';

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scryptP = (pw, salt) => new Promise((res, rej) => scrypt(pw, salt, 64, SCRYPT, (e, k) => e ? rej(e) : res(k)));

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scryptP(pw, salt);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, , s, k] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scryptP(pw, Buffer.from(s, 'base64'));
  const ref = Buffer.from(k, 'base64');
  return ref.length === key.length && timingSafeEqual(ref, key);
}
export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = t => createHash('sha256').update(String(t)).digest('hex');

export function validateCredentials(username, password) {
  const name = sanitizeName(username);
  if (name !== String(username || '').trim()) return 'Nome contém caracteres inválidos';
  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) return `Nome deve ter ${LIMITS.nameMin}–${LIMITS.nameMax} caracteres`;
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return 'Senha deve ter 8–128 caracteres';
  return null;
}

/** Token bucket keyed by an arbitrary string. */
export class RateLimiter {
  constructor(capacity, perSec) { this.cap = capacity; this.rate = perSec; this.b = new Map(); }
  take(key, n = 1) {
    const now = Date.now() / 1000;
    let e = this.b.get(key);
    if (!e) { e = { t: this.cap, at: now }; this.b.set(key, e); }
    e.t = Math.min(this.cap, e.t + (now - e.at) * this.rate); e.at = now;
    if (e.t < n) return false;
    e.t -= n; return true;
  }
  check(key) { const now = Date.now() / 1000; const e = this.b.get(key); if (!e) return true; return Math.min(this.cap, e.t + (now - e.at) * this.rate) >= 1; }
  sweep() { const now = Date.now() / 1000; for (const [k, e] of this.b) if (now - e.at > 600) this.b.delete(k); }
}
