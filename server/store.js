import fs from 'node:fs';
import path from 'node:path';
import { seedDb } from './seed.js';

const FILE = path.resolve('data', 'db.json');
export let db;

export function load() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : seedDb();
  flush();
}

// Atomic write (temp file + rename) so a crash never leaves a half-written DB.
export function flush() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

let timer;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 200);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { if (db) flush(); process.exit(0); });
}
