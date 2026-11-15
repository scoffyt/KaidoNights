// Local save system (localStorage) with versioning and safe fallbacks
const KEY = 'kaido-nights-save-v1';

const DEFAULTS = () => ({
  version: 1,
  settings: {
    quality: 'high', resScale: 1, motionBlur: true, showFps: false, fpsLimit: 0,
    master: 0.8, music: 0.5, sfx: 0.9, raceMusic: true,
    units: 'kmh', autoGear: true, tcs: false, abs: true, steerAssist: 0.5, driftAssist: 0.5,
    fov: 62, mouseSens: 1, camera: 'chase', time: 'night', aiLevel: 'normal',
  },
  car: { id: 'r34', color: '#c8102e', finish: 'metallic', rim: '#c9ccd1', smoke: '#eeeeee', tune: null },
  carConfigs: {},   // per-car paint & tune (cars not currently selected)
  stats: { totalScore: 0, bestChain: 0, bestFree: 0, distance: 0, driftDistance: 0, playTime: 0, races: 0, wins: 0, battles: 0, battleWins: 0, crashes: 0, maxSpeed: 0, maxAngle: 0, sessions: 0 },
  records: { timeAttack: null, timeAttackSectors: null, ghost: null, raceBest: null },
  challenges: {},      // id -> {medal: 0..3, best}
  ranking: { free: [], challenge: [], race: [], timeattack: [], battle: [] },
  history: [],         // last results
  credits: 0,
  unlocked: { finishes: ['metallic', 'matte'], colors: [] },
});

function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (over[k] === undefined) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && over[k] && typeof over[k] === 'object') base[k] = merge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}

export class Save {
  constructor() { this.data = DEFAULTS(); this.load(); }
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = merge(DEFAULTS(), JSON.parse(raw));
    } catch (e) { console.warn('save load failed', e); this.data = DEFAULTS(); }
    return this.data;
  }
  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { console.warn('save failed', e); return false; }
  }
  reset() { this.data = DEFAULTS(); this.save(); }
  get s() { return this.data.settings; }

  addHistory(entry) {
    this.data.history.unshift({ ...entry, date: new Date().toISOString() });
    this.data.history = this.data.history.slice(0, 30);
  }
  addRanking(mode, score, extra = {}, lowerIsBetter = false) {
    const list = this.data.ranking[mode] || (this.data.ranking[mode] = []);
    list.push({ score, ...extra, date: new Date().toISOString() });
    list.sort((a, b) => lowerIsBetter ? a.score - b.score : b.score - a.score);
    this.data.ranking[mode] = list.slice(0, 10);
    return this.data.ranking[mode].findIndex(e => e.score === score) + 1;
  }
}
