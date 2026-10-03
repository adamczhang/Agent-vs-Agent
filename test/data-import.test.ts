import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { importData } from '../src/data-import.js';
import { Store, SCHEMA_VERSION } from '../src/store.js';
import { conversationConfig, SEATS } from '../src/types.js';
import { tempDir } from './temp.js';

test('importing history copies a consistent snapshot, migrates the copy, and never touches the source or a non-empty target', async () => {
  const from = tempDir('ava-import-from-'), to = join(tempDir('ava-import-to-'), 'AgentVsAgent');
  const store = new Store(join(from, 'ava.sqlite')), pair = store.createPair('history');
  for (const seat of SEATS) store.mutateSlot(pair.id, seat, s => { s.state = 'ready'; s.sessionId = seat; s.generation = 1; });
  const { run } = store.start(pair.id, conversationConfig('kept topic'), 'start');
  writeFileSync(join(from, 'providers.json'), '{}'); writeFileSync(join(from, 'server.json'), '{"pid":1}');
  store.db.exec('PRAGMA user_version=2'); // pretend the source is an older schema; the store stays open (live service)
  // The source is live (WAL mode, store open): compare the main file and the WAL before and after the import, before the test closes its store.
  const hash = () => ['ava.sqlite', 'ava.sqlite-wal'].map(f => existsSync(join(from, f)) ? createHash('sha256').update(readFileSync(join(from, f))).digest('hex') : '-').join(':'), before = hash();

  const result = await importData(from, to);
  assert.deepEqual([result.schemaVersion, result.pairs, result.runs, result.messages, result.copied], [SCHEMA_VERSION, 1, 1, 1, ['ava.sqlite', 'providers.json']]);
  assert.equal(existsSync(join(to, 'server.json')), false, 'rendezvous files are not copied');
  const copy = new DatabaseSync(join(to, 'ava.sqlite'), { readOnly: true });
  assert.equal(String(copy.prepare('SELECT text FROM messages WHERE run_id=?').get(run.id)!.text), 'kept topic'); copy.close();
  assert.equal(Number(store.db.prepare('PRAGMA user_version').get()!.user_version), 2, 'the source schema is untouched');
  assert.equal(hash(), before, 'the import wrote nothing to the source database or its WAL'); store.close();
  await assert.rejects(importData(from, to), /not empty/);
  const leftovers = tempDir('ava-import-left-'); writeFileSync(join(leftovers, 'ava.sqlite-wal'), 'stale');
  await assert.rejects(importData(from, leftovers), /not empty/, 'a leftover WAL alone also blocks the import');
});
