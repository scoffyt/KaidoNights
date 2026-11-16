// Online backup of the SQLite database (safe while the server runs).
//   node server/tools/backup.js [destDir]
import { DB } from '../db.js';
import { config } from '../config.js';
const db = new DB(config.dbPath);
const file = await db.backup(process.argv[2] || config.backupDir);
console.log('backup written:', file);
db.close();
