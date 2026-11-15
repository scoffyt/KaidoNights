// Entry point
import { Game } from './game.js';

function fatal(e) {
  console.error(e);
  const d = document.createElement('div');
  d.className = 'err';
  d.innerHTML = `<div style="font-size:28px;font-weight:800">Não foi possível iniciar o jogo</div><p>Verifique se o navegador suporta WebGL2 (Chrome, Edge ou Firefox atualizados) e se a aceleração por hardware está ativada.</p><code>${(e && (e.stack || e.message)) || e}</code>`;
  document.body.appendChild(d);
}

// scale the whole UI with the window size (designed for 1600x900)
function uiScale() {
  const k = Math.max(0.55, Math.min(1.3, Math.min(innerWidth / 1600, innerHeight / 900)));
  document.documentElement.style.setProperty('--ui-scale', k.toFixed(3));
}
addEventListener('resize', uiScale); uiScale();

// installed version (written by tools/release.mjs; the launcher keeps it up to date)
fetch('version.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(v => {
  if (!v || !v.version) return;
  const d = document.createElement('div'); d.id = 'game-version'; d.textContent = 'v' + v.version;
  document.body.appendChild(d);
}).catch(() => { });

(async () => {
  try {
    const c = document.createElement('canvas');
    if (!c.getContext('webgl2')) throw new Error('WebGL2 indisponível neste navegador.');
    const game = new Game();
    await game.init();
  } catch (e) { fatal(e); }
})();
