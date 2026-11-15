// Restore a backup file over the live database path. STOP THE SERVER FIRST.
//   node server/tools/restore.js data/backups/kaido-XXXX.db
import { copyFileSync, existsSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
const src = process.argv[2];
if (!src || !existsSync(src)) { console.error('usage: node server/tools/restore.js <backup.db>'); process.exit(1); }
// validate the backup first
const test = new DatabaseSync(src, { readOnly: true });
const ok = test.prepare('PRAGMA integrity_check').get();
const v = test.prepare('SELECT v FROM schema_version').get();
test.close();
if (Object.values(ok)[0] !== 'ok') { console.error('backup failed integrity check:', ok); process.exit(1); }
if (existsSync(config.dbPath)) { const keep = config.dbPath + '.before-restore-' + Date.now(); renameSync(config.dbPath, keep); console.log('current database kept as', keep); }
for (const ext of ['-wal', '-shm']) rmSync(config.dbPath + ext, { force: true });
copyFileSync(src, config.dbPath);
console.log(`restored ${src} → ${config.dbPath} (schema v${v.v}). Start the server again.`);
