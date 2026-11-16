// =====================================================================
//  Minimal RFC 6455 WebSocket server (no dependencies).
//  Text frames only (JSON protocol), ping/pong, close, fragmentation,
//  payload cap, backpressure-aware send.
// =====================================================================
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WSConn extends EventEmitter {
  constructor(socket, req, opts = {}) {
    super();
    this.socket = socket; this.req = req;
    this.maxPayload = opts.maxPayload || 64 * 1024;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.open = true;
    this.lastSeen = Date.now();
    this.bytesIn = 0; this.bytesOut = 0;
    socket.setNoDelay(true);
    socket.on('data', d => this._onData(d));
    socket.on('close', () => this._closed(1006, 'socket closed'));
    socket.on('error', () => this._closed(1006, 'socket error'));
  }
  get ip() { return this.req.headers['x-forwarded-for']?.split(',')[0].trim() || this.socket.remoteAddress; }

  _onData(d) {
    this.lastSeen = Date.now(); this.bytesIn += d.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf; if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const hi = b.readUInt32BE(2); if (hi) return this.close(1009, 'too big'); len = b.readUInt32BE(6); off = 10; }
      if (len > this.maxPayload) return this.close(1009, 'payload too big');
      if (!masked) return this.close(1002, 'client frames must be masked');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4); off += 4;
      const payload = Buffer.from(b.subarray(off, off + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + len);
      this._frame(fin, op, payload);
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this._send(0xA, payload); return; }
    if (op === 0xA) return;
    if (op === 0x1 || op === 0x2) {
      if (fin) return this.emit('message', payload.toString('utf8'));
      this.frag = [payload]; return;
    }
    if (op === 0x0 && this.frag) {
      this.frag.push(payload);
      const total = this.frag.reduce((a, p) => a + p.length, 0);
      if (total > this.maxPayload) return this.close(1009, 'payload too big');
      if (fin) { const m = Buffer.concat(this.frag).toString('utf8'); this.frag = null; this.emit('message', m); }
      return;
    }
    this.close(1002, 'bad opcode');
  }
  _send(op, payload) {
    if (!this.open) return false;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    this.bytesOut += head.length + len;
    try { this.socket.write(head); return this.socket.write(payload); } catch { return false; }
  }
  send(obj) {
    // drop non-critical traffic for clients that cannot keep up
    if (this.socket.writableLength > 512 * 1024 && obj && (obj.t === 'snap' || obj.t === 'far')) return false;
    return this._send(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
  }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close(code = 1000, reason = '') {
    if (!this.open) return;
    const r = Buffer.from(String(reason).slice(0, 100));
    const p = Buffer.alloc(2 + r.length); p.writeUInt16BE(code, 0); r.copy(p, 2);
    this._send(0x8, p);
    this._closed(code, reason);
    setTimeout(() => this.socket.destroy(), 100);
  }
  _closed(code, reason) {
    if (!this.open) return;
    this.open = false;
    this.emit('close', code, reason);
  }
}

export function acceptUpgrade(req, socket, opts) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WSConn(socket, req, opts);
}
