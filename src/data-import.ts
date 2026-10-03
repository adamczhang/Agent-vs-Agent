import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { Store } from './store.js';

// Copies an existing AvA data folder's history into an empty one (never moves or edits the source).
// SQLite's online backup gives a consistent snapshot even while the source service is running.
// Session workspaces, ACPX state, and service rendezvous files are not copied: they belong to old processes.
export async function importData(from: string, to: string) {
  const source = join(from, 'ava.sqlite'), target = join(to, 'ava.sqlite');
  if (!existsSync(source)) throw new Error(`No AvA database at ${source}. Nothing was changed.`);
  // An empty (or missing) target only: leftover -wal/-shm files could otherwise be replayed into the copy.
  if (existsSync(to) && readdirSync(to).length) throw new Error(`${to} is not empty. Import only into an empty data folder. Nothing was changed.`);
  mkdirSync(to, { recursive: true });
  const copied = ['ava.sqlite'];
  try {
    const db = new DatabaseSync(source, { readOnly: true });
    try { await backup(db, target); } finally { db.close(); }
    if (existsSync(join(from, 'providers.json'))) { copyFileSync(join(from, 'providers.json'), join(to, 'providers.json')); copied.push('providers.json'); }
    // Attached files belong to the history (messages refer to them by ID).
    if (existsSync(join(from, 'attachments'))) { cpSync(join(from, 'attachments'), join(to, 'attachments'), { recursive: true }); copied.push('attachments'); }
    // Opening the copy applies any schema migrations (and refuses data from a newer AvA); the source keeps its version.
    const store = new Store(target);
    try {
      const count = (table: string) => Number(store.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
      return { from, to, copied, schemaVersion: Number(store.db.prepare('PRAGMA user_version').get()!.user_version), pairs: count('pairs'), runs: count('runs'), messages: count('messages') };
    } finally { store.close(); }
  } catch (error) {
    // The target was empty, so removing what this import wrote leaves it as it was.
    for (const file of ['ava.sqlite', 'ava.sqlite-wal', 'ava.sqlite-shm', 'providers.json', 'attachments']) rmSync(join(to, file), { recursive: true, force: true });
    throw error;
  }
}
