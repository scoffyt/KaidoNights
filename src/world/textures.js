// Procedural canvas textures (no external image files needed)
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function tex(c, repeat = [1, 1], srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function noiseFill(ctx, w, h, base, amp, seed, size = 1) {
  const r = rand(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y += size) for (let x = 0; x < w; x += size) {
    const n = (r() - 0.5) * amp;
    for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
      const i = ((y + yy) * w + (x + xx)) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] + n));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + n));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + n));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const cache = {};
export function getTextures(quality = 'high') {
  if (cache[quality]) return cache[quality];
  const big = quality === 'low' ? 512 : 1024;
  const T = {};

  // ---------- asphalt (tileable) + roughness
  {
    const c = canvas(big, big), g = c.getContext('2d');
    noiseFill(g, big, big, [58, 58, 62], 26, 11);
    const r = rand(5);
    for (let i = 0; i < big * big / 60; i++) { // aggregate stones
      const x = r() * big, y = r() * big, s = r() * 1.8 + 0.4, v = 40 + r() * 70;
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.5 + r() * 0.5})`; g.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 14; i++) { // patches / repairs
      g.fillStyle = `rgba(${20 + r() * 30},${20 + r() * 30},${24 + r() * 30},0.18)`;
      g.beginPath(); g.ellipse(r() * big, r() * big, 30 + r() * 120, 20 + r() * 80, r() * 3, 0, Math.PI * 2); g.fill();
    }
    T.asphalt = tex(c, [1, 1]);
    const c2 = canvas(256, 256), g2 = c2.getContext('2d');
    noiseFill(g2, 256, 256, [200, 200, 200], 70, 21, 2);
    T.asphaltRough = tex(c2, [1, 1], false);
  }

  // ---------- road strip texture: u across width (0..1), v along (tiled)
  {
    const w = 512, h = 512;
    const c = canvas(w, h), g = c.getContext('2d');
    g.drawImage(T.asphalt.image, 0, 0, w, h);
    // darker racing line wear in the middle
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.35, 'rgba(0,0,0,0.12)');
    grad.addColorStop(0.65, 'rgba(0,0,0,0.12)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    // edge lines
    g.fillStyle = '#e8e8e8';
    g.fillRect(w * 0.018, 0, w * 0.022, h); g.fillRect(w * 0.96, 0, w * 0.022, h);
    // wear noise on the lines
    const r = rand(9);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(60,60,60,${r() * 0.6})`; const x = r() < 0.5 ? w * 0.018 : w * 0.96; g.fillRect(x + r() * w * 0.022, r() * h, 2, 2 + r() * 6); }
    T.road = tex(c, [1, 1]);
  }

  // ---------- curb (red/white)
  {
    const c = canvas(64, 256), g = c.getContext('2d');
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f2f2f2' : '#d61e1e'; g.fillRect(0, i * 64, 64, 64); }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, 6, 256);
    T.curb = tex(c, [1, 1]);
  }

  // ---------- grass
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    noiseFill(g, 512, 512, [52, 78, 36], 30, 33, 2);
    const r = rand(3);
    for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = `rgba(${30 + v * 50},${60 + v * 60},${20 + v * 20},0.6)`; g.fillRect(r() * 512, r() * 512, 1, 3 + r() * 4); }
    T.grass = tex(c, [1, 1]);
  }

  // ---------- gravel
  {
    const c = canvas(256, 256), g = c.getContext('2d');
    noiseFill(g, 256, 256, [128, 116, 98], 60, 44, 1);
    T.gravel = tex(c, [1, 1]);
  }

  // ---------- concrete
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    noiseFill(g, 512, 512, [150, 150, 146], 22, 55, 1);
    g.strokeStyle = 'rgba(70,70,70,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 512; i += 128) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); }
    T.concrete = tex(c, [1, 1]);
  }

  // ---------- paddock asphalt with parking lines
  {
    const c = canvas(512, 512), g = c.getContext('2d');
    g.drawImage(T.asphalt.image, 0, 0, 512, 512);
    T.plaza = tex(c, [1, 1]);
  }

  // ---------- barrier: concrete wall with red/white top band and blue sponsor stripe
  {
    const c = canvas(512, 128), g = c.getContext('2d');
    noiseFill(g, 512, 128, [176, 178, 180], 16, 66);
    for (let i = 0; i < 512; i += 64) { g.fillStyle = (i / 64) % 2 ? '#e8e8e8' : '#c4161c'; g.fillRect(i, 0, 64, 18); }
    g.fillStyle = '#1b3f8f'; g.fillRect(0, 70, 512, 16);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = 'italic 900 14px Arial'; g.textBaseline = 'middle';
    for (let i = 10; i < 512; i += 170) g.fillText('KAIDO NIGHTS', i, 79);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 118, 512, 10);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let i = 0; i <= 512; i += 256) { g.beginPath(); g.moveTo(i, 18); g.lineTo(i, 128); g.stroke(); }
    T.wall = tex(c, [1, 1]);
  }

  // ---------- tyre wall
  {
    const c = canvas(256, 128), g = c.getContext('2d');
    g.fillStyle = '#121212'; g.fillRect(0, 0, 256, 128);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
      const cx = i * 44 + (row % 2) * 22 + 10, cy = row * 42 + 22;
      g.fillStyle = '#1d1d1d'; g.beginPath(); g.arc(cx, cy, 20, 0, 7); g.fill();
      g.fillStyle = '#080808'; g.beginPath(); g.arc(cx, cy, 9, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(0, 54, 256, 8);
    T.tyres = tex(c, [1, 1]);
  }

  // ---------- night windows (skyline)
  {
    const c = canvas(256, 512), g = c.getContext('2d');
    g.fillStyle = '#0b0d14'; g.fillRect(0, 0, 256, 512);
    const r = rand(77);
    for (let y = 8; y < 512; y += 14) for (let x = 6; x < 256; x += 12) {
      const lit = r();
      if (lit > 0.55) { const warm = r() > 0.4; g.fillStyle = warm ? `rgba(255,${190 + r() * 50},${110 + r() * 60},${0.5 + r() * 0.5})` : `rgba(${160 + r() * 60},${200 + r() * 40},255,${0.4 + r() * 0.5})`; }
      else g.fillStyle = 'rgba(30,34,44,1)';
      g.fillRect(x, y, 7, 8);
    }
    T.windows = tex(c, [1, 1]);
  }

  // ---------- smoke sprite
  {
    const c = canvas(128, 128), g = c.getContext('2d');
    const r = rand(8);
    for (let i = 0; i < 26; i++) {
      const x = 64 + (r() - 0.5) * 50, y = 64 + (r() - 0.5) * 50, rad = 18 + r() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.20)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
    T.smoke = tex(c, [1, 1], true, 1);
  }

  // ---------- glow sprite (lights / flares)
  {
    const c = canvas(128, 128), g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    T.glow = tex(c, [1, 1], true, 1);
  }

  // ---------- light pool decal (projected floodlight on ground)
  {
    const c = canvas(256, 256), g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    T.pool = tex(c, [1, 1], true, 1);
  }

  // ---------- skid mark
  {
    const c = canvas(64, 64), g = c.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    const r = rand(4);
    for (let x = 0; x < 64; x++) { const a = 0.55 + r() * 0.4; g.fillStyle = `rgba(8,8,8,${a * Math.sin(Math.PI * (x + 0.5) / 64)})`; g.fillRect(x, 0, 1, 64); }
    T.skid = tex(c, [1, 1], true, 4);
  }

  // ---------- start grid / finish checker
  {
    const c = canvas(256, 64), g = c.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#eee'; g.fillRect(x * 16, y * 16, 16, 16); }
    T.checker = tex(c, [1, 1]);
  }

  T.sponsor = sponsorBoards();
  cache[quality] = T;
  return T;
}

// fictional sponsor boards (all brand names invented for this game)
function sponsorBoards() {
  const list = [
    ['KAIDO NIGHTS', '#ff2d55', '#0b0b12'], ['TAKUMI OIL', '#ffffff', '#d4001a'], ['HAYATE TYRES', '#111', '#ffd400'],
    ['NEO-AKIBA ENERGY', '#00e5ff', '#101828'], ['SHINRAI BRAKES', '#fff', '#1f3fbf'], ['MIDNIGHT FM 88.1', '#ff9f0a', '#120a1a'],
    ['RYU MOTORSPORT', '#fff', '#111'], ['KOBE TURBO WORKS', '#ff2d55', '#f5f5f5'],
  ];
  return list.map(([txt, fg, bg], i) => {
    const c = canvas(1024, 192), g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 1024, 192);
    g.fillStyle = fg; g.globalAlpha = 0.12;
    for (let k = -4; k < 30; k++) { g.beginPath(); g.moveTo(k * 48, 192); g.lineTo(k * 48 + 120, 0); g.lineTo(k * 48 + 140, 0); g.lineTo(k * 48 + 20, 192); g.fill(); }
    g.globalAlpha = 1;
    g.font = 'italic 900 110px "Arial Black", Impact, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, 512, 100, 960);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  });
}

// text texture helper (signs, distance boards, corner numbers)
export function textTexture(text, { w = 512, h = 256, fg = '#fff', bg = '#c4161c', font = 'italic 900 150px "Arial Black", Impact, sans-serif' } = {}) {
  const c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 6, w * 0.92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
