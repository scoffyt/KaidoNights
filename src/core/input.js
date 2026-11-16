// Keyboard + gamepad input
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.gamepadIndex = null;
    this.state = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: 0, clutch: 0, analog: false };
    this._steerKb = 0;
    this.prevPad = {};
    window.addEventListener('keydown', e => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target.type !== 'range') return; // typing in chat / forms
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code) && !(e.target && e.target.tagName === 'INPUT')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', e => { this.gamepadIndex = e.gamepad.index; this.onPad && this.onPad(e.gamepad.id); });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  down(...codes) { return codes.some(c => this.keys.has(c)); }
  hit(...codes) { return codes.some(c => this.pressed.has(c)); }

  pad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] || null;
  }
  padHit(btn) {
    const p = this.pad(); if (!p || !p.buttons[btn]) return false;
    const now = p.buttons[btn].pressed; const was = this.prevPad[btn]; return now && !was;
  }

  update(dt) {
    const s = this.state;
    const kbT = this.down('KeyW', 'ArrowUp') ? 1 : 0;
    const kbB = this.down('KeyS', 'ArrowDown') ? 1 : 0;
    const left = this.down('KeyA', 'ArrowLeft'), right = this.down('KeyD', 'ArrowRight');
    const target = (left ? 1 : 0) - (right ? 1 : 0);  // + = left
    // keyboard steering ramps smoothly (faster return to centre)
    const rate = (target === 0 || Math.sign(target) !== Math.sign(this._steerKb)) ? 7 : 3.2;
    const d = target - this._steerKb;
    this._steerKb += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    s.throttle = kbT; s.brake = kbB; s.steer = this._steerKb;
    s.handbrake = this.down('Space') ? 1 : 0;
    s.nitro = this.down('ShiftLeft', 'ShiftRight') ? 1 : 0;
    s.clutch = this.down('KeyF') ? 1 : 0;
    s.analog = false;
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] || 0;
      const dz = Math.abs(ax) < 0.08 ? 0 : (ax - Math.sign(ax) * 0.08) / 0.92;
      const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
      if (Math.abs(dz) > 0 || rt > 0.02 || lt > 0.02) {
        s.analog = Math.abs(dz) > 0;
        if (s.analog) s.steer = -Math.sign(dz) * Math.pow(Math.abs(dz), 1.4);
        s.throttle = Math.max(s.throttle, rt);
        s.brake = Math.max(s.brake, lt);
      }
      if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) s.handbrake = 1; // A / B
      if (p.buttons[2]?.pressed) s.nitro = 1;   // X
      if (p.buttons[4]?.pressed) s.clutch = 1;  // LB
    }
  }

  // call at end of frame
  endFrame() {
    this.pressed.clear();
    const p = this.pad();
    if (p) p.buttons.forEach((b, i) => this.prevPad[i] = b.pressed);
  }

  // menu actions (edge)
  get pause() { return this.hit('Escape', 'KeyP') || this.padHit(9); }
  get camera() { return this.hit('KeyC') || this.padHit(3); }
  get reset() { return this.hit('KeyR') || this.padHit(8); }
  get shiftUp() { return this.hit('KeyE') || this.padHit(5); }
  get shiftDown() { return this.hit('KeyQ') || this.padHit(13); }
  get lookBack() { return this.down('KeyB') || (this.pad()?.buttons[11]?.pressed); }
  get lights() { return this.hit('KeyL'); }
  get horn() { return this.down('KeyH'); }
}
