import type { DatabaseSync } from 'node:sqlite';

// Ordered schema changes. Store applies each once, in its own transaction, and records the last in PRAGMA user_version.
// Pilot databases report version 0 but already contain the version 1 tables, so every step must be idempotent.
export const MIGRATIONS: ReadonlyArray<(db: DatabaseSync) => void> = [
  // 1: pilot schema.
  db => db.exec(`CREATE TABLE IF NOT EXISTS pairs(id TEXT PRIMARY KEY, thread TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, pair_id TEXT NOT NULL REFERENCES pairs(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS commands(key TEXT PRIMARY KEY, hash TEXT NOT NULL, result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, run_id TEXT NOT NULL REFERENCES runs(id), sender TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT);
    CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seat TEXT NOT NULL, inputs TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS deliveries(run_id TEXT NOT NULL, seat TEXT NOT NULL, message_id TEXT NOT NULL, turn_id TEXT NOT NULL, PRIMARY KEY(run_id,seat,message_id));
    CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, time TEXT NOT NULL);`),
  // 2: durable phase boundary (A4): a reply and the next-seat decision it completes commit together.
  db => {
    if (!db.prepare('PRAGMA table_info(turns)').all().some(c => c.name === 'phase_id')) db.exec('ALTER TABLE turns ADD COLUMN phase_id TEXT');
    db.exec('CREATE TABLE IF NOT EXISTS phases(id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id), kind TEXT NOT NULL, broadcast_id TEXT, seats TEXT NOT NULL, status TEXT NOT NULL)');
  },
  // 3: provider process ledger (A6), so recovery can prove an old owner's processes are gone.
  db => db.exec('CREATE TABLE IF NOT EXISTS processes(pid INTEGER NOT NULL, owner_pid INTEGER NOT NULL, pair_id TEXT NOT NULL, seat TEXT NOT NULL, generation INTEGER NOT NULL, spawned_at TEXT NOT NULL, exited_at TEXT, PRIMARY KEY(pid, spawned_at))'),
  // 4: conversation presets (B6): room settings only, never provider or model.
  db => db.exec('CREATE TABLE IF NOT EXISTS presets(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, data TEXT NOT NULL, updated_at TEXT NOT NULL)'),
  // 5: menu snapshots and room bindings, previously created ad hoc by Menus and AvAService.
  db => db.exec(`CREATE TABLE IF NOT EXISTS menus(pair_id TEXT NOT NULL, seat TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(pair_id, seat));
    CREATE TABLE IF NOT EXISTS rooms(pair_id TEXT PRIMARY KEY, room_id TEXT NOT NULL UNIQUE);`),
  // 6: direct (1:1) messages between the user and one agent, inside that agent's own session. Never part of the
  // shared room and never sent to the other agent. thread_id is the thread (pair + sessions) they were sent in.
  db => db.exec(`CREATE TABLE IF NOT EXISTS direct_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, pair_id TEXT NOT NULL, thread_id TEXT NOT NULL, seat TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, state TEXT NOT NULL, error TEXT, time TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS direct_messages_thread ON direct_messages(thread_id, seq);`),
  // 7: thread names the user chose, and files attached to room messages (bytes live in <data>/attachments/<id>).
  db => {
    db.exec(`CREATE TABLE IF NOT EXISTS thread_titles(thread_id TEXT PRIMARY KEY, title TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY, name TEXT NOT NULL, media_type TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, created_at TEXT NOT NULL);`);
    if (!db.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'attachments')) db.exec('ALTER TABLE messages ADD COLUMN attachments TEXT');
  },
  // 8: service-wide settings, independent of conversation history.
  db => db.exec('CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
  // 9: durable benchmark jobs and immutable attempt records; separate from conversation history.
  db => db.exec(`CREATE TABLE IF NOT EXISTS bench_jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bench_attempts(id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES bench_jobs(id), task_id TEXT NOT NULL, task_version INTEGER NOT NULL, digest TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS bench_attempts_job ON bench_attempts(job_id);
    CREATE INDEX IF NOT EXISTS bench_attempts_task ON bench_attempts(task_id,task_version,digest);`),
  // 10: puzzle comparisons persist independently of conversation history, like benchmark jobs.
  db => db.exec('CREATE TABLE IF NOT EXISTS puzzle_jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL)'),
  // 11: paired game/debate experiments retain settings, outcomes and transcripts.
  db => db.exec('CREATE TABLE IF NOT EXISTS series_jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL)'),
];
export const SCHEMA_VERSION = MIGRATIONS.length;
