// =====================================================================
//  Persistence: SQLite through Node's built-in node:sqlite (WAL mode).
//  Versioned migrations, foreign keys, indices, transactions for every
//  money/xp operation, idempotent rewards (UNIQUE(race_id, user_id)),
//  online backups.
// =====================================================================
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { CAR_PRICES, STARTER_CARS, levelForXp } from '../src/net/shared.js';

const MIGRATIONS = [
  // 1 — core schema
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL,
     username_lc TEXT NOT NULL UNIQUE,
     pass_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_login INTEGER,
     banned INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     ip TEXT
   );
   CREATE INDEX idx_sessions_user ON sessions(user_id);
   CREATE TABLE profiles (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     money INTEGER NOT NULL DEFAULT 10000 CHECK (money >= 0),
     xp INTEGER NOT NULL DEFAULT 0,
     rep INTEGER NOT NULL DEFAULT 0,
     wins INTEGER NOT NULL DEFAULT 0,
     losses INTEGER NOT NULL DEFAULT 0,
     races INTEGER NOT NULL DEFAULT 0,
     drift_total INTEGER NOT NULL DEFAULT 0,
     best_drift INTEGER NOT NULL DEFAULT 0,
     distance REAL NOT NULL DEFAULT 0,
     active_car TEXT NOT NULL DEFAULT 'r34',
     avatar TEXT NOT NULL DEFAULT '#16c5b8',
     title TEXT NOT NULL DEFAULT ''
   );
   CREATE TABLE vehicles (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     car_id TEXT NOT NULL,
     look TEXT NOT NULL DEFAULT '{}',
     tune TEXT NOT NULL DEFAULT '{}',
     acquired_at INTEGER NOT NULL,
     UNIQUE(user_id, car_id)
   );
   CREATE TABLE friends (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     status TEXT NOT NULL CHECK (status IN ('pending','accepted')),
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, friend_id)
   );
   CREATE INDEX idx_friends_friend ON friends(friend_id);
   CREATE TABLE blocks (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, blocked_id)
   );
   CREATE TABLE crews (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     leader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE crew_members (
     crew_id INTEGER NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
     joined_at INTEGER NOT NULL,
     PRIMARY KEY (crew_id, user_id)
   );
   CREATE TABLE races (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL,
     route TEXT NOT NULL,
     room TEXT NOT NULL,
     status TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     started_at INTEGER,
     finished_at INTEGER,
     winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL
   );
   CREATE INDEX idx_races_created ON races(created_at);
   CREATE TABLE race_results (
     race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     place INTEGER,
     time_ms INTEGER,
     score INTEGER,
     status TEXT NOT NULL,
     car_id TEXT,
     PRIMARY KEY (race_id, user_id)
   );
   CREATE INDEX idx_results_user ON race_results(user_id);
   CREATE TABLE rewards (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     race_id TEXT NOT NULL,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     money INTEGER NOT NULL, xp INTEGER NOT NULL, rep INTEGER NOT NULL,
     reason TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     UNIQUE(race_id, user_id)
   );
   CREATE INDEX idx_rewards_time ON rewards(created_at);
   CREATE TABLE transactions (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     amount INTEGER NOT NULL,
     balance INTEGER NOT NULL,
     kind TEXT NOT NULL,
     ref TEXT,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_tx_user ON transactions(user_id, created_at);
   CREATE TABLE achievements (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     code TEXT NOT NULL,
     at INTEGER NOT NULL,
     PRIMARY KEY (user_id, code)
   );
   CREATE TABLE reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     target_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     reason TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     handled INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
     kind TEXT NOT NULL,
     detail TEXT,
     suspicious INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX idx_activity_user ON activity_log(user_id, created_at);
   CREATE INDEX idx_activity_susp ON activity_log(suspicious, created_at);`,
  // 2 — recent players
  `CREATE TABLE recent_players (
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     other_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     seen_at INTEGER NOT NULL,
     PRIMARY KEY (user_id, other_id)
   );`,
];

export class DB {
  constructor(path = config.dbPath) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA synchronous = NORMAL;');
    this.migrate();
    this._stmts = new Map();
  }
  migrate() {
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
    let v = this.db.prepare('SELECT v FROM schema_version').get()?.v;
    if (v === undefined) { this.db.prepare('INSERT INTO schema_version (v) VALUES (0)').run(); v = 0; }
    for (let i = v; i < MIGRATIONS.length; i++) {
      this.tx(() => { this.db.exec(MIGRATIONS[i]); this.db.prepare('UPDATE schema_version SET v = ?').run(i + 1); });
      log.info('db migration applied', { version: i + 1 });
    }
  }
  q(sql) { let s = this._stmts.get(sql); if (!s) { s = this.db.prepare(sql); this._stmts.set(sql, s); } return s; }
  tx(fn) {
    if (this._inTx) return fn();
    this.db.exec('BEGIN IMMEDIATE'); this._inTx = true;
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { } throw e; }
    finally { this._inTx = false; }
  }
  close() { this.db.close(); }

  // ---------------------------------------------------------------- users
  createUser(username, passHash) {
    const now = Date.now();
    return this.tx(() => {
      const r = this.q('INSERT INTO users (username, username_lc, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(username, username.toLowerCase(), passHash, now);
      const id = Number(r.lastInsertRowid);
      this.q('INSERT INTO profiles (user_id) VALUES (?)').run(id);
      for (const c of STARTER_CARS) this.q('INSERT INTO vehicles (user_id, car_id, acquired_at) VALUES (?, ?, ?)').run(id, c, now);
      this.q('INSERT INTO transactions (user_id, amount, balance, kind, created_at) VALUES (?, 10000, 10000, ?, ?)').run(id, 'starter', now);
      return id;
    });
  }
  userByName(name) { return this.q('SELECT * FROM users WHERE username_lc = ?').get(String(name).toLowerCase()); }
  userById(id) { return this.q('SELECT id, username, created_at, banned FROM users WHERE id = ?').get(id); }
  touchLogin(id) { this.q('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), id); }

  // ---------------------------------------------------------------- sessions
  addSession(hash, userId, ip) { const now = Date.now(); this.q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?)').run(hash, userId, now, now + config.sessionDays * 86400e3, ip || null); }
  sessionUser(hash) {
    const s = this.q('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hash);
    if (!s || s.expires_at < Date.now()) return null;
    return s.user_id;
  }
  dropSession(hash) { this.q('DELETE FROM sessions WHERE token_hash = ?').run(hash); }
  purgeSessions() { this.q('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()); }

  // ---------------------------------------------------------------- profiles / garage
  profile(id) {
    const p = this.q(`SELECT u.id, u.username, u.created_at, p.* FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?`).get(id);
    if (!p) return null;
    p.level = levelForXp(p.xp);
    p.cars = this.q('SELECT car_id, look FROM vehicles WHERE user_id = ? ORDER BY acquired_at').all(id).map(v => ({ id: v.car_id, look: safeJson(v.look) }));
    p.achievements = this.q('SELECT code, at FROM achievements WHERE user_id = ?').all(id);
    p.crew = this.q('SELECT c.id, c.name, c.leader_id FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE m.user_id = ?').get(id) || null;
    delete p.user_id;
    return p;
  }
  publicProfile(id) {
    const p = this.profile(id); if (!p) return null;
    const { money, ...pub } = p; // money is private
    pub.recent = this.q('SELECT r.race_id, r.place, r.time_ms, r.score, r.status, ra.kind, ra.created_at FROM race_results r JOIN races ra ON ra.id = r.race_id WHERE r.user_id = ? ORDER BY ra.created_at DESC LIMIT 8').all(id);
    return pub;
  }
  ownsCar(userId, carId) { return !!this.q('SELECT 1 FROM vehicles WHERE user_id = ? AND car_id = ?').get(userId, carId); }
  carLook(userId, carId) { const v = this.q('SELECT look FROM vehicles WHERE user_id = ? AND car_id = ?').get(userId, carId); return v ? safeJson(v.look) : null; }
  setActiveCar(userId, carId, look) {
    return this.tx(() => {
      if (!this.ownsCar(userId, carId)) throw new Error('not_owned');
      if (look) this.q('UPDATE vehicles SET look = ? WHERE user_id = ? AND car_id = ?').run(JSON.stringify(look), userId, carId);
      this.q('UPDATE profiles SET active_car = ? WHERE user_id = ?').run(carId, userId);
      return true;
    });
  }
  buyCar(userId, carId) {
    const price = CAR_PRICES[carId];
    if (price === undefined) throw new Error('unknown_car');
    return this.tx(() => {
      if (this.ownsCar(userId, carId)) throw new Error('already_owned');
      const p = this.q('SELECT money FROM profiles WHERE user_id = ?').get(userId);
      if (!p || p.money < price) throw new Error('insufficient_funds');
      this.q('UPDATE profiles SET money = money - ? WHERE user_id = ?').run(price, userId);
      this.q('INSERT INTO vehicles (user_id, car_id, acquired_at) VALUES (?, ?, ?)').run(userId, carId, Date.now());
      this.q('INSERT INTO transactions (user_id, amount, balance, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, -price, p.money - price, 'buy_car', carId, Date.now());
      this.grantAchievement(userId, 'first_purchase');
      return p.money - price;
    });
  }

  // ---------------------------------------------------------------- races / rewards
  createRace(id, kind, route, room) { this.q('INSERT INTO races (id, kind, route, room, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, kind, route, room, 'setup', Date.now()); }
  setRaceStatus(id, status, extra = {}) {
    if (status === 'running') this.q('UPDATE races SET status = ?, started_at = ? WHERE id = ?').run(status, Date.now(), id);
    else if (status === 'finished' || status === 'aborted') this.q('UPDATE races SET status = ?, finished_at = ?, winner_id = ? WHERE id = ?').run(status, Date.now(), extra.winner ?? null, id);
    else this.q('UPDATE races SET status = ? WHERE id = ?').run(status, id);
  }
  saveResult(raceId, userId, r) {
    this.q('INSERT OR REPLACE INTO race_results (race_id, user_id, place, time_ms, score, status, car_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(raceId, userId, r.place ?? null, r.timeMs ?? null, r.score ?? null, r.status, r.car ?? null);
  }
  /** Idempotent: a (raceId, userId) pair is rewarded at most once. Returns the granted reward or null. */
  grantReward(raceId, userId, { money = 0, xp = 0, rep = 0, reason, win = null }) {
    return this.tx(() => {
      const r = this.q('INSERT OR IGNORE INTO rewards (race_id, user_id, money, xp, rep, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(raceId, userId, money, xp, rep, reason, Date.now());
      if (!r.changes) return null;
      this.q(`UPDATE profiles SET money = money + ?, xp = xp + ?, rep = rep + ?,
              wins = wins + ?, losses = losses + ?, races = races + ? WHERE user_id = ?`)
        .run(money, xp, rep, win === true ? 1 : 0, win === false ? 1 : 0, win === null ? 0 : 1, userId);
      const bal = this.q('SELECT money, xp, wins FROM profiles WHERE user_id = ?').get(userId);
      if (money) this.q('INSERT INTO transactions (user_id, amount, balance, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, money, bal.money, reason, raceId, Date.now());
      if (win === true) { this.grantAchievement(userId, 'first_win'); if (bal.wins >= 10) this.grantAchievement(userId, 'ten_wins'); }
      if (levelForXp(bal.xp) >= 5) this.grantAchievement(userId, 'level_5');
      return { money, xp, rep, balance: bal.money, xpTotal: bal.xp, level: levelForXp(bal.xp) };
    });
  }
  addDriftStats(userId, points, distance) {
    this.q('UPDATE profiles SET drift_total = drift_total + ?, best_drift = MAX(best_drift, ?), distance = distance + ? WHERE user_id = ?').run(Math.round(points), Math.round(points), distance, userId);
    if (points >= 10000) this.grantAchievement(userId, 'drift_10k');
  }
  grantAchievement(userId, code) { return this.q('INSERT OR IGNORE INTO achievements (user_id, code, at) VALUES (?, ?, ?)').run(userId, code, Date.now()).changes > 0; }

  leaderboard(period = 'all', limit = 20) {
    if (period === 'week') {
      const since = Date.now() - 7 * 86400e3;
      return this.q(`SELECT u.id, u.username, SUM(r.rep) AS rep, SUM(r.money) AS money, COUNT(*) AS events
                     FROM rewards r JOIN users u ON u.id = r.user_id WHERE r.created_at > ? GROUP BY u.id ORDER BY rep DESC LIMIT ?`).all(since, limit);
    }
    return this.q(`SELECT u.id, u.username, p.rep, p.xp, p.wins, p.races, p.best_drift FROM profiles p JOIN users u ON u.id = p.user_id
                   WHERE u.banned = 0 ORDER BY p.rep DESC, p.xp DESC LIMIT ?`).all(limit).map(r => ({ ...r, level: levelForXp(r.xp) }));
  }

  // ---------------------------------------------------------------- social
  friendsOf(id) {
    return this.q(`SELECT u.id, u.username, f.status, 'out' AS dir FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?
                   UNION ALL SELECT u.id, u.username, f.status, 'in' AS dir FROM friends f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending'`).all(id, id);
  }
  friendRequest(a, b) {
    return this.tx(() => {
      if (a === b) throw new Error('self');
      if (this.isBlocked(b, a)) throw new Error('blocked');
      const rev = this.q('SELECT status FROM friends WHERE user_id = ? AND friend_id = ?').get(b, a);
      if (rev) { // they already asked us → accept both ways
        this.q("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ?").run(b, a);
        this.q("INSERT OR REPLACE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)").run(a, b, Date.now());
        return 'accepted';
      }
      this.q("INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(a, b, Date.now());
      return 'pending';
    });
  }
  friendAccept(a, b) { // a accepts b's request
    return this.tx(() => {
      const r = this.q("UPDATE friends SET status = 'accepted' WHERE user_id = ? AND friend_id = ? AND status = 'pending'").run(b, a);
      if (!r.changes) throw new Error('no_request');
      this.q("INSERT OR REPLACE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'accepted', ?)").run(a, b, Date.now());
      return 'accepted';
    });
  }
  friendRemove(a, b) { this.tx(() => { this.q('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(a, b); this.q('DELETE FROM friends WHERE user_id = ? AND friend_id = ?').run(b, a); }); }
  areFriends(a, b) { return !!this.q("SELECT 1 FROM friends WHERE user_id = ? AND friend_id = ? AND status = 'accepted'").get(a, b); }
  block(a, b, on) { if (on) { this.q('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)').run(a, b, Date.now()); this.friendRemove(a, b); } else this.q('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(a, b); }
  isBlocked(a, b) { return !!this.q('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(a, b); }
  blockedBy(a) { return this.q('SELECT blocked_id FROM blocks WHERE user_id = ?').all(a).map(r => r.blocked_id); }
  report(a, b, reason) { this.q('INSERT INTO reports (reporter_id, target_id, reason, created_at) VALUES (?, ?, ?, ?)').run(a, b, String(reason).slice(0, 300), Date.now()); }
  seen(a, b) { this.q('INSERT OR REPLACE INTO recent_players (user_id, other_id, seen_at) VALUES (?, ?, ?)').run(a, b, Date.now()); }
  recentPlayers(a) { return this.q('SELECT u.id, u.username, r.seen_at FROM recent_players r JOIN users u ON u.id = r.other_id WHERE r.user_id = ? ORDER BY r.seen_at DESC LIMIT 20').all(a); }

  // crews (persistent groups)
  crewOf(userId) { return this.q('SELECT c.* FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE m.user_id = ?').get(userId) || null; }
  crewMembers(crewId) { return this.q('SELECT u.id, u.username FROM crew_members m JOIN users u ON u.id = m.user_id WHERE m.crew_id = ?').all(crewId); }
  createCrew(leader, name) {
    return this.tx(() => {
      if (this.crewOf(leader)) throw new Error('already_in_crew');
      const r = this.q('INSERT INTO crews (name, leader_id, created_at) VALUES (?, ?, ?)').run(name, leader, Date.now());
      const id = Number(r.lastInsertRowid);
      this.q('INSERT INTO crew_members (crew_id, user_id, joined_at) VALUES (?, ?, ?)').run(id, leader, Date.now());
      return id;
    });
  }
  joinCrew(crewId, userId) {
    return this.tx(() => {
      if (this.crewOf(userId)) throw new Error('already_in_crew');
      if (this.crewMembers(crewId).length >= 8) throw new Error('crew_full');
      this.q('INSERT INTO crew_members (crew_id, user_id, joined_at) VALUES (?, ?, ?)').run(crewId, userId, Date.now());
    });
  }
  leaveCrew(userId) {
    return this.tx(() => {
      const c = this.crewOf(userId); if (!c) throw new Error('no_crew');
      this.q('DELETE FROM crew_members WHERE user_id = ?').run(userId);
      const rest = this.crewMembers(c.id);
      if (!rest.length) this.q('DELETE FROM crews WHERE id = ?').run(c.id);
      else if (c.leader_id === userId) this.q('UPDATE crews SET leader_id = ? WHERE id = ?').run(rest[0].id, c.id);
      return c.id;
    });
  }

  // ---------------------------------------------------------------- free-roam earnings / logs
  payFreeRoam(userId, money, xp, ref) {
    return this.tx(() => {
      this.q('UPDATE profiles SET money = money + ?, xp = xp + ? WHERE user_id = ?').run(money, xp, userId);
      const p = this.q('SELECT money, xp FROM profiles WHERE user_id = ?').get(userId);
      this.q('INSERT INTO transactions (user_id, amount, balance, kind, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(userId, money, p.money, 'free_drift', ref, Date.now());
      return { balance: p.money, xpTotal: p.xp, level: levelForXp(p.xp) };
    });
  }
  activity(userId, kind, detail, suspicious = false) {
    try { this.q('INSERT INTO activity_log (user_id, kind, detail, suspicious, created_at) VALUES (?, ?, ?, ?, ?)').run(userId ?? null, kind, detail ? JSON.stringify(detail).slice(0, 1000) : null, suspicious ? 1 : 0, Date.now()); } catch (e) { log.warn('activity log failed', { e: e.message }); }
  }

  // ---------------------------------------------------------------- backups
  async backup(dir = config.backupDir) {
    const file = join(dir, `kaido-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await sqliteBackup(this.db, file);
    const files = readdirSync(dir).filter(f => f.startsWith('kaido-') && f.endsWith('.db')).sort();
    while (files.length > config.backupKeep) { try { unlinkSync(join(dir, files.shift())); } catch { } }
    log.info('db backup', { file, bytes: statSync(file).size });
    return file;
  }
}
function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
