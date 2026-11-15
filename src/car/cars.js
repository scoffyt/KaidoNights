// Car catalogue. Every entry is a real GLB import + its own physics base.
// Add new cars here (any GLB whose wheels are named "3DWheel Front L"/"WHEEL_FL" style works).
export const CARS = [
  {
    id: 'r34', make: 'Nissan', model: 'Skyline GT-R V-Spec (R34)', short: 'Skyline R34', year: 1999,
    file: './R34.glb', wheelBase: 2.665,
    engine: 'RB26DETT 2.6 L I6 biturbo', drivetrain: 'Traseira (drift spec)', hp: 440, nm: 480, mass: 1480,
    cls: 'A', pi: 780, color: '#c8102e', rim: '#c9ccd1',
    spec: { mass: 1480, maxTorque: 480, gears: [3.21, 2.13, 1.52, 1.16, 0.94, 0.79], finalDrive: 4.1 },
    stats: { speed: 7.6, handling: 7.4, accel: 7.1, launch: 6.2, braking: 7.0, drift: 7.8 },
    blurb: 'Lenda de Hakone. Seis em linha biturbo, chassi equilibrado e direção precisa.',
  },
  {
    id: 'supra', make: 'Toyota', model: 'Supra RZ (A80 / MK4)', short: 'Supra MK4', year: 1998,
    file: './assets/cars/toyota_supra_mk4_a80.glb', wheelBase: 2.55,
    engine: '2JZ-GTE 3.0 L I6 biturbo', drivetrain: 'Traseira', hp: 520, nm: 560, mass: 1510,
    cls: 'S1', pi: 820, color: '#f28c00', rim: '#1a1a1c',
    spec: { mass: 1510, maxTorque: 560, gears: [3.83, 2.36, 1.69, 1.31, 1.0, 0.79], finalDrive: 3.77, muRear: 1.17, maxSteer: 0.76 },
    stats: { speed: 8.2, handling: 6.9, accel: 7.8, launch: 6.5, braking: 6.8, drift: 8.4 },
    blurb: 'O 2JZ indestrutível com potência de sobra para manter o carro de lado.',
  },
  {
    id: 's14', make: 'Nissan', model: 'Silvia K\'s (S14) Drift Build', short: 'Silvia S14', year: 1996,
    file: './assets/cars/nissan_s14_drift.glb', wheelBase: 2.525,
    import: { wheelRe: /^(RIM_|Tyre|BRAKEDISK|2_ssr_ms3)/i, caliperRe: /^caliper/i, front: '+z', paintRe: /^metalPainted_003_0$|carPaint/i, brakeRe: /^tailight/i, rimRe: /SSR_MS3_RIM/i },
    engine: 'SR20DET 2.0 L I4 turbo', drivetrain: 'Traseira', hp: 380, nm: 430, mass: 1240,
    cls: 'A', pi: 760, color: '#e8e8ea', rim: '#2a2b2e',
    spec: { mass: 1240, maxTorque: 430, gears: [3.32, 1.90, 1.31, 1.0, 0.82, 0.70], finalDrive: 4.3, muRear: 1.17, maxSteer: 0.82, cgToFront: 1.22, cgToRear: 1.305, trackWidth: 1.6, wheelRadius: 0.31 },
    stats: { speed: 6.9, handling: 8.2, accel: 7.0, launch: 6.0, braking: 7.4, drift: 9.1 },
    blurb: 'Leve, curto e com ângulo de esterço extremo. A arma preferida das ligas de drift.',
  },
  {
    id: 's13', make: 'Nissan', model: '240SX (S13)', short: '240SX', year: 1994,
    file: './assets/cars/nissan_240sx.glb', wheelBase: 2.475,
    import: { wheelRe: /^wheel2?$/i, splitWheels: true, front: '-z', paintRe: /remap180/i, brakeRe: /^tail$/i, rimRe: /advan|vs_kf/i },
    engine: 'KA24DE 2.4 L I4 (swap SR20 turbo)', drivetrain: 'Traseira', hp: 300, nm: 370, mass: 1180,
    cls: 'B', pi: 690, color: '#1f4fa8', rim: '#c9ccd1',
    spec: { mass: 1180, maxTorque: 370, gears: [3.32, 1.90, 1.31, 1.0, 0.82, 0.70], finalDrive: 4.1, muRear: 1.15, maxSteer: 0.8, cgToFront: 1.2, cgToRear: 1.275, trackWidth: 1.46 },
    stats: { speed: 6.2, handling: 7.9, accel: 6.3, launch: 5.6, braking: 7.0, drift: 8.6 },
    blurb: 'O clássico de entrada do drift: barato, equilibrado e fácil de controlar no limite.',
  },
  {
    id: 'hoonicorn', make: 'Ford', model: 'Mustang "Hoonicorn" (Ken Block)', short: 'Hoonicorn', year: 1965,
    file: './assets/cars/hoonicorn.glb', wheelBase: 2.74,
    import: { wheelRe: /Wheel(Ft|Bk)/i, caliperRe: /^Caliper$/i, front: '+z', paintRe: /Body_Paint/i, brakeRe: /^Tail_Lights$/i, rimRe: /^Inner_Rim$/i },
    engine: 'Roush Yates 6.7 L V8 biturbo', drivetrain: 'Traseira (drift spec)', hp: 1000, nm: 900, mass: 1430,
    cls: 'X', pi: 950, color: '#ffffff', rim: '#1a1a1c',
    spec: { mass: 1430, maxTorque: 820, gears: [2.95, 2.1, 1.6, 1.28, 1.05, 0.88], finalDrive: 3.6, muFront: 1.22, muRear: 1.26, maxSteer: 0.8, cgToFront: 1.34, cgToRear: 1.40, trackWidth: 1.6, wheelRadius: 0.34 },
    stats: { speed: 9.4, handling: 7.0, accel: 9.6, launch: 7.0, braking: 7.6, drift: 9.5 },
    blurb: 'Muscle car de 1965 com V8 biturbo de quatro dígitos de potência. Fumaça garantida.',
  },
];

export const CLASS_COLORS = { D: '#3bb4ff', C: '#ffd23b', B: '#ff7a1a', A: '#ff2d55', S1: '#a23bff', S2: '#2d6bff', X: '#3bff7a' };
export function carById(id) { return CARS.find(c => c.id === id) || CARS[0]; }
