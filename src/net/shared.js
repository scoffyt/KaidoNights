// =====================================================================
//  Shared multiplayer definitions — imported by BOTH the browser client
//  and the Node server (pure JS, no three.js / DOM).
//  Anything competitive (routes, checkpoints, prices, rewards, limits)
//  lives here so the server can validate with the same data the client
//  displays.
// =====================================================================
import { TrackData } from '../world/trackData.js';

export const PROTOCOL_VERSION = 3;

// ---- limits (server enforces them; the client uses them for UI hints)
export const LIMITS = {
  maxSpeed: 105,            // m/s (378 km/h) — above this a state update is rejected
  maxAccel: 60,             // m/s² between two updates (impacts included)
  teleportDist: 40,         // m jump between consecutive updates = teleport (only allowed after server-authorised respawn)
  stateHz: 15,              // client → server state rate
  challengeRadius: 80,      // m: you can only challenge someone this close
  challengeTimeout: 15,     // s to accept
  challengeCooldown: 20,    // s before re-challenging the same player after a refusal
  interestRadius: 450,      // m: full-rate updates for players inside this radius
  farRate: 1,               // Hz for players outside the interest radius (map dots only)
  chatMax: 200,             // chars
  chatPerMin: 20,
  nameMin: 3, nameMax: 16,
};

// ---- cars that can be owned online (ids from src/car/cars.js)
export const CAR_PRICES = { r34: 0, s13: 0, s14: 32000, supra: 55000, hoonicorn: 140000 };
export const STARTER_CARS = ['r34', 's13'];
export const CAR_IDS = Object.keys(CAR_PRICES);

// ---- progression
export function levelForXp(xp) { return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 250)); }
export function xpForLevel(l) { return (l - 1) ** 2 * 250; }

export const REWARDS = {
  // money, xp, rep per placement (index 0 = winner)
  sprint: { money: [2500, 800], xp: [300, 120], rep: [25, 5] },
  circuit: { money: [4000, 1200], xp: [450, 180], rep: [35, 8] },
  timeattack: { money: [2000, 700], xp: [260, 110], rep: [20, 5] },
  drift: { money: [3000, 1000], xp: [380, 150], rep: [30, 6] },
  tandem: { money: [3200, 1100], xp: [400, 160], rep: [32, 7] },
  bo3: { money: [6000, 1800], xp: [700, 260], rep: [60, 12] },
  event: { money: [5000, 2500, 1500, 800], xp: [600, 400, 300, 200], rep: [50, 30, 20, 10] },
  forfeitMoney: 0,
};

// ---- points of interest (world coordinates, see world.js / driftPark.js)
export const POIS = [
  { id: 'paddock', type: 'garage', name: 'Garagem do Paddock', x: 40, z: 290 },
  { id: 'meet', type: 'meet', name: 'Encontro Kaido (estacionamento)', x: -95, z: 225, r: 30 },
  { id: 'donut', type: 'drift', name: 'Donut Zone', x: 62, z: 250, r: 30 },
  { id: 'circuit', type: 'circuit', name: 'Circuito Hakone Bay', x: -40, z: 172 },
  { id: 'road', type: 'road', name: 'Estrada do Parque', x: 400, z: 250 },
  { id: 'park', type: 'drift', name: 'Drift Park', x: 650, z: 60, r: 120 },
  { id: 'parkpit', type: 'meet', name: 'Pátio do Drift Park', x: 690, z: 40, r: 25 },
];
export const REGIONS = [
  { id: 'hakone', name: 'Hakone Bay', x0: -320, x1: 330, z0: -300, z1: 330 },
  { id: 'road', name: 'Estrada do Parque', x0: 130, x1: 704, z0: 230, z1: 270 },
  { id: 'park', name: 'Drift Park', x0: 425, x1: 775, z0: -150, z1: 265 },
];
export function regionAt(x, z) { for (const r of REGIONS) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return r.id; return 'wild'; }

// ---- race routes. Checkpoints: {x, z, r} gates the car must pass in order.
let _track = null;
const track = () => (_track = _track || new TrackData());
export const START_S = 40;

function circuitGates(n = 12) {
  const t = track(); const out = [];
  for (let k = 1; k <= n; k++) { const p = t.pointAt((START_S + (t.length * k) / n) % t.length); out.push({ x: +p.x.toFixed(1), z: +p.z.toFixed(1), r: 14 }); }
  return out; // last gate = start/finish line
}
function circuitGrid() {
  const t = track(); const out = [];
  for (let k = 0; k < 8; k++) { const p = t.pointAt(START_S - 12 - k * 9, k % 2 ? -3.2 : 3.2); out.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), h: +Math.atan2(p.tx, p.tz).toFixed(4) }); }
  return out;
}

export const ROUTES = {
  circuit: { id: 'circuit', name: 'Circuito Hakone Bay', laps: 2, get gates() { return circuitGates(); }, get grid() { return circuitGrid(); }, minLapTime: 38 },
  circuit1: { id: 'circuit1', name: 'Volta lançada Hakone Bay', laps: 1, get gates() { return circuitGates(); }, get grid() { return circuitGrid(); }, minLapTime: 38 },
  parkrun: {
    id: 'parkrun', name: 'Sprint Paddock → Drift Park', laps: 1, minLapTime: 18,
    grid: [{ x: 150, z: 246.5, h: Math.PI / 2 }, { x: 150, z: 253.5, h: Math.PI / 2 }, { x: 140, z: 246.5, h: Math.PI / 2 }, { x: 140, z: 253.5, h: Math.PI / 2 }],
    gates: [{ x: 300, z: 250, r: 12 }, { x: 500, z: 250, r: 12 }, { x: 690, z: 250, r: 14 }, { x: 700, z: 180, r: 12 }, { x: 700, z: 110, r: 14 }],
  },
  sprint: {
    id: 'sprint', name: 'Sprint Reta Principal → Hairpin', laps: 1, minLapTime: 20,
    get grid() { return circuitGrid(); },
    get gates() { return circuitGates(12).slice(0, 7); },
  },
};
export const CHALLENGE_TYPES = {
  sprint: { label: 'Sprint', route: 'parkrun', scoring: 'time', desc: 'Do paddock até o Drift Park' },
  circuit: { label: 'Circuito (2 voltas)', route: 'circuit', scoring: 'time', desc: 'Duas voltas no Hakone Bay' },
  timeattack: { label: 'Time Attack', route: 'circuit1', scoring: 'time', ghost: true, desc: 'Uma volta, sem colisão, melhor tempo' },
  drift: { label: 'Drift Battle', route: 'sprint', scoring: 'drift', desc: 'Maior pontuação de drift no trecho' },
  tandem: { label: 'Tandem Drift', route: 'sprint', scoring: 'tandem', desc: 'Líder × perseguidor, proximidade conta' },
  bo3: { label: 'Melhor de três', route: 'parkrun', scoring: 'time', rounds: 3, desc: 'Três sprints, vence quem ganhar 2' },
};

// ---- server-side drift scoring from the state stream (same idea as DriftScorer, simplified, deterministic)
// state: {x, z, h (heading), vx, vz}
export function driftPoints(prev, cur, dt) {
  const sp = Math.hypot(cur.vx, cur.vz);
  if (sp < 8 || dt <= 0 || dt > 0.5) return 0;
  const vh = Math.atan2(cur.vx, cur.vz);
  let ang = Math.abs(((cur.h - vh + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (ang > Math.PI / 2) ang = Math.PI - ang; // driving backwards is not drifting
  const deg = ang * 180 / Math.PI;
  if (deg < 12 || deg > 75) return 0;
  const angleF = Math.min(1.6, (deg - 8) / 30);
  const speedF = Math.min(1.8, sp / 22);
  return 950 * angleF * speedF * dt;
}
export function tandemBonus(dist) { return dist < 4 ? 1.8 : dist < 8 ? 1.5 : dist < 15 ? 1.2 : dist < 30 ? 1 : 0.6; }

// ---- small helpers
export function sanitizeName(s) { return String(s || '').trim().replace(/[^\p{L}\p{N}_\-. ]/gu, '').slice(0, LIMITS.nameMax); }
const BAD = ['caralho', 'porra', 'puta', 'fdp', 'viado', 'buceta', 'merda', 'fuck', 'shit', 'nigger', 'cunt'];
export function filterChat(s) {
  let t = String(s || '').replace(/[\u0000-\u001f]/g, '').slice(0, LIMITS.chatMax);
  for (const w of BAD) t = t.replace(new RegExp(w, 'gi'), m => '*'.repeat(m.length));
  return t.trim();
}
