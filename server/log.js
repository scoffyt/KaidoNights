// Structured JSON logs (stdout + rotating daily file).
import { appendFile } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min = LEVELS[config.logLevel] ?? 20;

function write(level, msg, data) {
  if (LEVELS[level] < min) return;
  const rec = { ts: new Date().toISOString(), level, msg, ...data };
  const line = JSON.stringify(rec);
  if (process.env.LOG_QUIET !== '1') (level === 'error' ? console.error : console.log)(line);
  appendFile(join(config.logDir, `server-${rec.ts.slice(0, 10)}.log`), line + '\n', () => { });
}
export const log = {
  debug: (m, d = {}) => write('debug', m, d),
  info: (m, d = {}) => write('info', m, d),
  warn: (m, d = {}) => write('warn', m, d),
  error: (m, d = {}) => write('error', m, d),
};
