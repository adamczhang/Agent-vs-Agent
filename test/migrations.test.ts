import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store, SCHEMA_VERSION } from '../src/store.js';
import { AvAService } from '../src/service.js';
import { TestFactory } from './fakes.js';
import { tempDir } from './temp.js';

const version = (db: DatabaseSync) => Number(db.prepare('PRAGMA user_version').get()!.user_version);
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => String(r.name));

test('a new database is created at the latest schema with every table', () => {
  const store = new Store(join(tempDir('ava-mig-'), 'ava.sqlite'));
  assert.equal(version(store.db), SCHEMA_VERSION);
  assert.deepEqual(tables(store.db), ['attachments', 'commands', 'deliveries', 'direct_messages', 'events', 'menus', 'messages', 'pairs', 'phases', 'presets', 'processes', 'rooms', 'runs', 'thread_titles', 'turns']);
  store.close();
});
test('a pilot-era database that already has the ad hoc menus and rooms tables migrates without losing rows', () => {
  const path = join(tempDir('ava-mig-'), 'ava.sqlite'), old = new DatabaseSync(path);
  old.exec(`CREATE TABLE pairs(id TEXT PRIMARY KEY, thread TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE menus(pair_id TEXT NOT NULL,seat TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(pair_id,seat));
    CREATE TABLE rooms(pair_id TEXT PRIMARY KEY,room_id TEXT NOT NULL UNIQUE);
    INSERT INTO pairs VALUES('p','thread','{}'); INSERT INTO rooms VALUES('p','room-1');`);
  old.close();
  const store = new Store(path);
  assert.equal(version(store.db), SCHEMA_VERSION);
  assert.equal(String(store.db.prepare('SELECT room_id FROM rooms').get()!.room_id), 'room-1');
  assert.equal(Number(store.db.prepare('SELECT COUNT(*) n FROM pairs').get()!.n), 1);
  store.close();
});
test('data written by a newer schema is refused and left untouched', () => {
  const path = join(tempDir('ava-mig-'), 'ava.sqlite'), newer = new DatabaseSync(path);
  newer.exec(`PRAGMA user_version=${SCHEMA_VERSION + 7}`); newer.close();
  assert.throws(() => new Store(path), /written by a newer Agent vs Agent/);
  const check = new DatabaseSync(path, { readOnly: true }); assert.equal(version(check), SCHEMA_VERSION + 7); assert.deepEqual(tables(check), []); check.close();
});
// Uses a real pilot database when the (gitignored) private evidence is present on this machine.
const pilotDir = join('pilot-evidence', 'p2', 'private'), pilotDb = existsSync(pilotDir) ? readdirSync(pilotDir).find(f => f.endsWith('.sqlite')) : undefined;
test('a copy of a real pilot database migrates and stays readable through the service', { skip: pilotDb ? false : 'private pilot database not present' }, async () => {
  const dir = tempDir('ava-mig-pilot-');
  copyFileSync(join(pilotDir, pilotDb!), join(dir, 'ava.sqlite'));
  const service = new AvAService(dir, new TestFactory(), 'simulation');
  try {
    assert.equal(version(service.store.db), SCHEMA_VERSION);
    const runId = String(service.store.db.prepare('SELECT id FROM runs').get()!.id);
    const view = await service.call('run.get', { runId }) as { messages: unknown[] };
    const exported = await service.call('run.export', { runId }) as { json: { messages: unknown[] }; markdown: string };
    assert.equal(view.messages.length, 11); assert.equal(exported.json.messages.length, 11); assert.ok(exported.markdown.length > 0);
    assert.ok(((await service.call('runs.list', {})) as { runs: unknown[] }).runs.length === 1);
  } finally { await service.shutdown(); service.store.close(); }
});
