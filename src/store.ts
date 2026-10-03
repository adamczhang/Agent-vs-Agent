import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { AvAError, SEATS, other, type AttachmentRef, type Pair, type Seat, type Slot, type Run, type RunConfig, type RoomMessage } from './types.js';
import type { LedgerProcess, ProcessLedger } from './census.js';
import { MIGRATIONS, SCHEMA_VERSION } from './migrations.js';

export { SCHEMA_VERSION };
// A thread is one continuous conversation with the same two agent sessions: every prompt sent until Clear Session gives
// both agents fresh ones. The ID is derived from the pair and its sessions, so it needs no schema change and older data
// (which reset sessions before every run) shows one thread per run. Opaque: session IDs stay internal.
export function threadKey(pairId: string, sessions: Record<Seat, string | null>) {
  return 't' + createHash('sha256').update(`${pairId}\n${sessions.cli1}\n${sessions.cli2}`).digest('hex').slice(0, 23);
}
export class Store implements ProcessLedger {
  readonly db: DatabaseSync;
  // Attached files, next to the database: <data>/attachments/<id>.
  readonly attachmentsDir: string;
  // Test-only crash injection: called at labeled points inside a transaction and right after its COMMIT.
  faults?: (point: string) => void;
  constructor(path: string) {
    this.attachmentsDir = join(path === ':memory:' ? tmpdir() : dirname(path), 'attachments');
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA busy_timeout=3000;');
      // Never let an older plugin touch data a newer one created: check before any pragma or write changes the file.
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version > SCHEMA_VERSION) throw new AvAError('NEWER_DATA', `This data was written by a newer Agent vs Agent (schema ${version}; this version understands ${SCHEMA_VERSION}). Update the plugin. Nothing was changed.`);
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      this.migrate();
    } catch (error) { this.db.close(); throw error; }
  }
  private migrate() {
    const current = () => Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    // Re-read the version inside each write transaction, so two processes opening an old database never double-apply a step.
    for (let next = current(); next < SCHEMA_VERSION; next++) this.transaction(() => {
      if (current() > next) return;
      MIGRATIONS[next]!(this.db); this.db.exec(`PRAGMA user_version=${next + 1}`);
    });
    // Lookup indexes for the per-run reads the room polls (messages, events, turns, phases), without them every poll
    // scans the whole shared pool. Indexes don't change what an older AvA reads, so they need no schema version.
    this.db.exec(`CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);
      CREATE INDEX IF NOT EXISTS messages_run ON messages(run_id, seq);
      CREATE INDEX IF NOT EXISTS turns_run ON turns(run_id);
      CREATE INDEX IF NOT EXISTS turns_phase ON turns(phase_id);
      CREATE INDEX IF NOT EXISTS phases_run ON phases(run_id);`);
  }
  listPresets() {
    return this.db.prepare('SELECT id,name,data,updated_at FROM presets ORDER BY name COLLATE NOCASE').all().map(r => ({ id: String(r.id), name: String(r.name), data: JSON.parse(String(r.data)) as unknown, updatedAt: String(r.updated_at) }));
  }
  // Saving under an existing name replaces that preset.
  savePreset(name: string, data: unknown) {
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id FROM presets WHERE name=?').get(name), id = existing ? String(existing.id) : randomUUID();
      this.db.prepare('INSERT INTO presets VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(id, name, JSON.stringify(data), new Date().toISOString());
      return { id, name, replaced: !!existing };
    });
  }
  deletePreset(id: string) { return { deleted: this.db.prepare('DELETE FROM presets WHERE id=?').run(id).changes > 0 }; }
  spawned(p: { pid: number; pairId: string; seat: Seat; generation: number }) {
    this.db.prepare('INSERT OR REPLACE INTO processes VALUES(?,?,?,?,?,?,NULL)').run(p.pid, process.pid, p.pairId, p.seat, p.generation, new Date().toISOString());
  }
  exited(pid: number) {
    this.db.prepare('UPDATE processes SET exited_at=? WHERE pid=? AND owner_pid=? AND exited_at IS NULL').run(new Date().toISOString(), pid, process.pid);
  }
  // Every process recorded for a run's own sessions (its pair and slot generations), including adapters that already
  // exited: their children (the actual CLI) can outlive them, so recovery must check from all of them.
  runProcesses(pairId: string, generations: Record<Seat, number>): LedgerProcess[] {
    return this.db.prepare("SELECT pid,spawned_at,owner_pid,exited_at FROM processes WHERE pair_id=? AND ((seat='cli1' AND generation=?) OR (seat='cli2' AND generation=?))").all(pairId, generations.cli1, generations.cli2)
      .map(r => ({ pid: Number(r.pid), spawnedAt: String(r.spawned_at), ownerPid: Number(r.owner_pid), exited: r.exited_at != null, ...(r.exited_at != null ? { exitedAt: String(r.exited_at) } : {}) }));
  }
  // One agent's recorded processes for one session generation.
  seatProcesses(pairId: string, seat: Seat, generation: number): LedgerProcess[] {
    return this.db.prepare('SELECT pid,spawned_at,owner_pid,exited_at FROM processes WHERE pair_id=? AND seat=? AND generation=?').all(pairId, seat, generation)
      .map(r => ({ pid: Number(r.pid), spawnedAt: String(r.spawned_at), ownerPid: Number(r.owner_pid), exited: r.exited_at != null, ...(r.exited_at != null ? { exitedAt: String(r.exited_at) } : {}) }));
  }
  openProcesses(pairId: string): LedgerProcess[] {
    return this.db.prepare('SELECT pid,spawned_at,owner_pid FROM processes WHERE pair_id=? AND exited_at IS NULL').all(pairId).map(r => ({ pid: Number(r.pid), spawnedAt: String(r.spawned_at), ownerPid: Number(r.owner_pid) }));
  }
  // Clear history: every saved run, message, 1:1 message, thread name and attachment in this data folder. Pairs,
  // rooms, presets and the process ledger stay. The caller makes sure nothing is running.
  clearHistory() {
    const count = (table: string) => Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n);
    const attachments = this.db.prepare('SELECT id FROM attachments').all().map(r => String(r.id));
    const result = this.transaction(() => {
      // Checked again here, atomically with the delete: a run started meanwhile must not lose its records under it.
      if (this.db.prepare('SELECT data FROM pairs').all().some(r => (JSON.parse(String(r.data)) as Pair).activeRunId)) throw new AvAError('PAIR_BUSY', 'A prompt started meanwhile. Stop it, then clear history.');
      const counts = { runs: count('runs'), directMessages: count('direct_messages'), attachments: attachments.length };
      // The command records stay: they make retried requests idempotent, this very Clear history's included.
      for (const table of ['messages', 'turns', 'deliveries', 'events', 'phases', 'runs', 'direct_messages', 'thread_titles', 'attachments']) this.db.exec(`DELETE FROM ${table}`);
      for (const row of this.db.prepare('SELECT data FROM pairs').all()) { const pair = JSON.parse(String(row.data)) as Pair; delete pair.lastRunId; pair.activeRunId = null; this.savePair(pair); }
      return counts;
    });
    for (const id of attachments) rmSync(join(this.attachmentsDir, id), { force: true });
    return result;
  }
  transaction<T>(action: () => T, label?: string): T {
    this.db.exec('BEGIN IMMEDIATE');
    let result: T;
    try { result = action(); if (label) this.faults?.(label + ':inside'); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if (label) this.faults?.(label + ':committed');
    return result;
  }
  close() { this.db.close(); }
  pair(id: string): Pair {
    const row = this.db.prepare('SELECT data FROM pairs WHERE id=?').get(id);
    if (!row) throw new AvAError('NOT_FOUND', 'Pair not found.');
    return JSON.parse(String(row.data)) as Pair;
  }
  createPair(thread: string): Pair {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT data FROM pairs WHERE thread=?').get(thread);
      if (row) return JSON.parse(String(row.data)) as Pair;
      const empty = (seat: Seat): Slot => ({ seat, generation: 0, state: 'empty', config: null, sessionId: null, verifiedAt: null, error: null });
      const pair: Pair = { id: randomUUID(), thread, activeRunId: null, slots: { cli1: empty('cli1'), cli2: empty('cli2') } };
      this.db.prepare('INSERT INTO pairs VALUES(?,?,?)').run(pair.id, thread, JSON.stringify(pair));
      return pair;
    });
  }
  savePair(pair: Pair) { this.db.prepare('UPDATE pairs SET data=? WHERE id=?').run(JSON.stringify(pair), pair.id); }
  // Changes allowed while a run holds the pair: the agent's internet switch, and a failure found while restarting it.
  setSlotInternet(pairId: string, seat: Seat, on: boolean) {
    this.transaction(() => { const pair = this.pair(pairId); pair.slots[seat].internet = on; this.savePair(pair); });
  }
  // Read live by the permission gate, so it may change at any time; it doesn't touch the agent's session.
  setSlotPermissions(pairId: string, seat: Seat, level: 'ask' | 'bypass') {
    this.transaction(() => { const pair = this.pair(pairId); pair.slots[seat].permissions = level; this.savePair(pair); });
  }
  failSlot(pairId: string, seat: Seat, generation: number, error: string) {
    this.transaction(() => { const pair = this.pair(pairId), slot = pair.slots[seat]; if (slot.generation !== generation) return; slot.state = 'failed'; slot.error = error; this.savePair(pair); });
  }
  mutateSlot(pairId: string, seat: Seat, mutate: (slot: Slot) => void): Slot {
    return this.transaction(() => {
      const pair = this.pair(pairId);
      if (pair.activeRunId) throw new AvAError('PAIR_BUSY', 'Stop and settle the current run before changing this pair.');
      mutate(pair.slots[seat]); this.savePair(pair); return pair.slots[seat];
    });
  }
  run(id: string): Run {
    const row = this.db.prepare('SELECT data FROM runs WHERE id=?').get(id);
    if (!row) throw new AvAError('NOT_FOUND', 'Run not found.');
    return JSON.parse(String(row.data)) as Run;
  }
  saveRun(run: Run) { this.db.prepare('UPDATE runs SET data=? WHERE id=?').run(JSON.stringify(run), run.id); }
  updateRun(id: string, action: (run: Run) => void): Run {
    return this.transaction(() => { const run = this.run(id); action(run); this.saveRun(run); return run; });
  }
  private fingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private replay(key: string, value: unknown): string | undefined {
    const old = this.db.prepare('SELECT hash,result FROM commands WHERE key=?').get(key);
    if (!old) return undefined;
    if (old.hash !== this.fingerprint(value)) throw new AvAError('IDEMPOTENCY_CONFLICT', 'This request ID was already used with different input.');
    return String(old.result);
  }
  private remember(key: string, value: unknown, result: string) {
    this.db.prepare('INSERT INTO commands VALUES(?,?,?)').run(key, this.fingerprint(value), result);
  }
  beginOperation(key:string,input:unknown):{fresh:boolean;record:Record<string,unknown>}{
    return this.transaction(()=>{const replay=this.replay(key,input);if(replay)return {fresh:false,record:JSON.parse(replay)};const record={status:'pending'};this.remember(key,input,JSON.stringify(record));return {fresh:true,record};});
  }
  finishOperation(key:string,record:Record<string,unknown>){this.db.prepare('UPDATE commands SET result=? WHERE key=?').run(JSON.stringify(record),key);}
  previousStart(pairId:string,config:RunConfig,key:string):Run|undefined {
    const replay=this.replay(`start:${key}`,{pairId,config});return replay?this.run(replay):undefined;
  }
  // Attachments: the bytes go to a file named by a random ID; the row records what they are.
  saveAttachment(name: string, mediaType: string, kind: 'image' | 'text', data: Buffer): AttachmentRef {
    const id = randomUUID(); mkdirSync(this.attachmentsDir, { recursive: true });
    writeFileSync(join(this.attachmentsDir, id), data, { mode: 0o600 });
    this.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?)').run(id, name, mediaType, kind, data.length, createHash('sha256').update(data).digest('hex'), new Date().toISOString());
    return { id, name, mediaType, size: data.length, kind };
  }
  attachment(id: string): AttachmentRef {
    const row = this.db.prepare('SELECT * FROM attachments WHERE id=?').get(id);
    if (!row) throw new AvAError('NOT_FOUND', 'Attachment not found.');
    return { id: String(row.id), name: String(row.name), mediaType: String(row.media_type), size: Number(row.size), kind: String(row.kind) as AttachmentRef['kind'] };
  }
  attachmentData(id: string) { return readFileSync(join(this.attachmentsDir, this.attachment(id).id)); }
  // Thread names the user chose (the default name is the thread's first prompt).
  threadTitles() { return new Map(this.db.prepare('SELECT thread_id,title FROM thread_titles').all().map(r => [String(r.thread_id), String(r.title)])); }
  setThreadTitle(threadId: string, title: string | null) {
    if (title) this.db.prepare('INSERT INTO thread_titles VALUES(?,?,?) ON CONFLICT(thread_id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at').run(threadId, title, new Date().toISOString());
    else this.db.prepare('DELETE FROM thread_titles WHERE thread_id=?').run(threadId);
  }
  start(pairId: string, config: RunConfig, key: string, attachments: AttachmentRef[] = []): { run: Run; created: boolean } {
    return this.transaction(() => {
      const input = { pairId, config };
      const replay = this.replay(`start:${key}`, input);
      if (replay) return { run: this.run(replay), created: false };
      const pair = this.pair(pairId);
      if (pair.activeRunId) throw new AvAError('PAIR_BUSY', 'This pair already owns an active run.');
      for (const seat of SEATS) if (pair.slots[seat].state !== 'ready' || !pair.slots[seat].sessionId) throw new AvAError('NOT_READY', `${seat} has not passed activation.`);
      const run: Run = {
        id: randomUUID(), pairId, status: 'running', config,
        generations: { cli1: pair.slots.cli1.generation, cli2: pair.slots.cli2.generation },
        sessions: { cli1: pair.slots.cli1.sessionId!, cli2: pair.slots.cli2.sessionId! },
        requests: 0, elapsedMs: 0, nextSeat: config.lead,
        stopFlags: { cli1: false, cli2: false }, reason: null,
        participants: { cli1: pair.slots.cli1.config!, cli2: pair.slots.cli2.config! }, createdAt: new Date().toISOString(),
      };
      this.db.prepare('INSERT INTO runs VALUES(?,?,?)').run(run.id, pairId, JSON.stringify(run));
      pair.activeRunId = run.id; pair.lastRunId=run.id; this.savePair(pair); this.remember(`start:${key}`, input, run.id);
      this.addMessage(run.id, 'user', config.topic, 'queued', null, attachments);
      this.event(run.id, 'run_started', { runId: run.id });
      return { run, created: true };
    });
  }
  addMessage(runId: string, sender: Seat | 'user', text: string, state: RoomMessage['state'], turnId: string | null, attachments: AttachmentRef[] = []): string {
    const id = randomUUID();
    this.db.prepare('INSERT INTO messages(id,run_id,sender,text,state,turn_id,attachments) VALUES(?,?,?,?,?,?,?)').run(id, runId, sender, text, state, turnId, attachments.length ? JSON.stringify(attachments) : null);
    return id;
  }
  // replayed: the same request again (a retry). The caller must not act on it a second time.
  broadcast(runId: string, text: string, key: string, attachments: AttachmentRef[] = []): { id: string; replayed: boolean } {
    return this.transaction(() => {
      const input = { runId, text, ...(attachments.length ? { attachments: attachments.map(a => a.id) } : {}) }, replay = this.replay(`broadcast:${key}`, input);
      if (replay) return { id: replay, replayed: true };
      const run = this.run(runId);
      if (!['running', 'pausing', 'paused'].includes(run.status)) throw new AvAError('NOT_RUNNING', 'This run cannot accept another message.');
      if (!text.trim() || text.length > 16000) throw new AvAError('INVALID_MESSAGE', 'Enter 1–16000 characters.');
      const id = this.addMessage(runId, 'user', text, 'queued', null, attachments);
      this.remember(`broadcast:${key}`, input, id); this.event(runId, 'room_queued', { messageId: id }); return { id, replayed: false };
    });
  }
  messages(runId: string): RoomMessage[] {
    const delivered=new Map<string,Seat[]>();
    for(const row of this.db.prepare('SELECT seat,message_id FROM deliveries WHERE run_id=?').all(runId)){const key=String(row.message_id),seats=delivered.get(key)??[];seats.push(String(row.seat) as Seat);delivered.set(key,seats);}
    return this.db.prepare('SELECT * FROM messages WHERE run_id=? ORDER BY seq').all(runId).map(row => ({
      id: String(row.id), seq: Number(row.seq), runId: String(row.run_id), sender: String(row.sender) as RoomMessage['sender'],
      text: String(row.text), state: String(row.state) as RoomMessage['state'], turnId: row.turn_id == null ? null : String(row.turn_id),
      deliveredTo:delivered.get(String(row.id))??[],
      ...(row.attachments ? { attachments: JSON.parse(String(row.attachments)) as AttachmentRef[] } : {}),
    }));
  }
  queued(runId: string) { return this.messages(runId).filter(m => m.state === 'queued'); }
  admit(runId: string, seats: readonly Seat[], broadcastId?: string, repairOf?: string): Array<{ id: string; seat: Seat; messages: RoomMessage[] }> {
    return this.transaction(() => {
      const run = this.run(runId), pair = this.pair(run.pairId), repair = !!repairOf;
      if (pair.activeRunId !== runId || run.status !== 'running' && !(repair && run.status === 'pausing')) throw new AvAError('REVOKED', 'Run no longer permits submission.');
      if (run.requests + seats.length > run.config.maxRequests) throw new AvAError('REQUEST_LIMIT', 'Request limit reached.');
      for (const seat of seats) if (pair.slots[seat].generation !== run.generations[seat] || pair.slots[seat].sessionId !== run.sessions[seat]) throw new AvAError('REVOKED', 'Participant identity changed.');
      if (broadcastId) {
        const changed = this.db.prepare("UPDATE messages SET state='admitted' WHERE id=? AND run_id=? AND state='queued'").run(broadcastId, runId);
        if (!changed.changes) throw new AvAError('CONFLICT', 'Broadcast is no longer queued.');
        run.stopFlags = { cli1: false, cli2: false };
      }
      let phaseId: string;
      if (repairOf) {
        const original = this.db.prepare('SELECT phase_id FROM turns WHERE id=? AND run_id=?').get(repairOf, runId);
        if (original?.phase_id == null) throw new AvAError('CONFLICT', 'The repaired turn has no phase.');
        phaseId = String(original.phase_id);
      } else {
        phaseId = randomUUID();
        this.db.prepare("INSERT INTO phases VALUES(?,?,?,?,?,'open')").run(phaseId, runId, broadcastId ? 'paired' : 'single', broadcastId ?? null, JSON.stringify(seats));
      }
      const all = this.messages(runId);
      const turns = seats.map(seat => {
        const delivered = new Set(this.db.prepare('SELECT message_id FROM deliveries WHERE run_id=? AND seat=?').all(runId, seat).map(r => String(r.message_id)));
        const messages = repair ? [] : all.filter(m => ['admitted', 'committed'].includes(m.state) && m.sender !== seat && !delivered.has(m.id));
        const id = randomUUID();
        this.db.prepare('INSERT INTO turns(id,run_id,seat,inputs,status,text,error,phase_id) VALUES(?,?,?,?,?,?,?,?)').run(id, runId, seat, JSON.stringify(messages.map(m => m.id)), 'queued', '', null, phaseId);
        return { id, seat, messages };
      });
      run.requests += seats.length; this.saveRun(run);
      this.event(runId, 'phase_admitted', { phaseId, broadcastId, turns: turns.map(t => ({ id: t.id, seat: t.seat, inputIds: t.messages.map(m => m.id) })) });
      return turns;
    }, 'admit');
  }
  turnText(id: string, text: string) { this.db.prepare('UPDATE turns SET text=? WHERE id=?').run(text, id); }
  started(id: string) {
    this.transaction(() => {
      const turn = this.db.prepare('SELECT * FROM turns WHERE id=?').get(id);
      if (!turn) return;
      this.db.prepare("UPDATE turns SET status='submitted' WHERE id=? AND status='queued'").run(id);
      for (const msg of JSON.parse(String(turn.inputs)) as string[]) this.db.prepare('INSERT OR IGNORE INTO deliveries VALUES(?,?,?,?)').run(turn.run_id!, turn.seat!, msg, id);
    }, 'started');
  }
  turnEnd(id: string, status: string, error: string | null = null) {
    this.db.prepare('UPDATE turns SET status=?,error=? WHERE id=?').run(status, error, id);
    // Timing for run statistics: when each request finished, whatever its outcome.
    const row = this.db.prepare('SELECT run_id FROM turns WHERE id=?').get(id);
    if (row) this.event(String(row.run_id), 'turn_ended', { turnId: id, status });
  }
  // Rows for run statistics (src/stats.ts): every turn with its phase kind, and every event in order.
  statsRows(runId: string) {
    const turns = this.db.prepare("SELECT t.id,t.seat,t.status,t.phase_id,p.kind FROM turns t LEFT JOIN phases p ON p.id=t.phase_id WHERE t.run_id=? ORDER BY t.rowid").all(runId).map(r => ({ id: String(r.id), seat: String(r.seat), status: String(r.status), phaseId: r.phase_id == null ? null : String(r.phase_id), phaseKind: r.kind == null ? null : String(r.kind) }));
    const events = this.db.prepare('SELECT type,time,data FROM events WHERE run_id=? ORDER BY seq').all(runId).map(r => ({ type: String(r.type), time: String(r.time), data: JSON.parse(String(r.data)) as Record<string, unknown> }));
    const replies = Number(this.db.prepare("SELECT COUNT(*) n FROM messages WHERE run_id=? AND sender!='user' AND state='committed'").get(runId)!.n);
    return { turns, events, replies };
  }
  commitReply(runId: string, turnId: string, seat: Seat, text: string, stopRequested: boolean) {
    return this.transaction(() => {
      const run = this.run(runId);
      if (!['running', 'pausing'].includes(run.status) || this.pair(run.pairId).activeRunId !== runId) return false;
      const turn = this.db.prepare('SELECT status,phase_id FROM turns WHERE id=?').get(turnId);
      if (!turn || turn.status === 'completed') return false;
      this.turnEnd(turnId, 'completed');
      const messageId = this.addMessage(runId, seat, text, 'committed', turnId);
      this.faults?.('commit:after-message');
      run.stopFlags[seat] = stopRequested;
      this.event(runId, 'room_committed', { messageId, seat, turnId });
      if (turn.phase_id != null) this.completePhase(run, String(turn.phase_id), seat);
      this.saveRun(run); return true;
    }, 'commit');
  }
  // Runs inside commitReply's transaction, so a crash cannot separate the last reply of a phase from the next-seat decision.
  private completePhase(run: Run, phaseId: string, seat: Seat) {
    const phase = this.db.prepare('SELECT kind,seats,status FROM phases WHERE id=?').get(phaseId);
    if (!phase || phase.status !== 'open') return;
    const done = new Set(this.db.prepare("SELECT seat FROM turns WHERE phase_id=? AND status='completed'").all(phaseId).map(r => String(r.seat)));
    if (!(JSON.parse(String(phase.seats)) as Seat[]).every(s => done.has(s))) return;
    this.db.prepare("UPDATE phases SET status='complete' WHERE id=?").run(phaseId);
    run.nextSeat = phase.kind === 'paired' ? run.config.lead : other(seat);
    this.event(run.id, 'phase_completed', { phaseId, nextSeat: run.nextSeat });
  }
  finish(runId: string, status: 'completed' | 'stopped' | 'needs_attention', reason: string, elapsedMs: number) {
    return this.transaction(() => {
      const run = this.run(runId), pair = this.pair(run.pairId);
      run.status = status; run.reason = reason; run.elapsedMs = elapsedMs; this.saveRun(run);
      if (status !== 'needs_attention' && pair.activeRunId === runId) { pair.activeRunId = null; this.savePair(pair); }
      this.db.prepare("UPDATE messages SET state='not_delivered' WHERE run_id=? AND state='queued'").run(runId);
      // A run that ends mid-phase (stop, deadline, timeout, failure) leaves no phase looking in progress.
      this.db.prepare("UPDATE phases SET status='interrupted' WHERE run_id=? AND status='open'").run(runId);
      this.event(runId, 'run_ended', { status, reason }); return run;
    }, 'finish');
  }
  // When each room message appeared: replies at commit, broadcasts when queued (the opening topic has no event).
  messageTimes(runId: string) {
    const times = new Map<string, string>();
    for (const row of this.db.prepare("SELECT data,time FROM events WHERE run_id=? AND type IN ('room_committed','room_queued') ORDER BY seq").all(runId)) {
      const id = (JSON.parse(String(row.data)) as { messageId?: unknown }).messageId;
      if (typeof id === 'string') times.set(id, String(row.time));
    }
    return times;
  }
  // Read-only history page, newest first. `before` is the cursor from the previous page.
  listRuns(pairId: string | undefined, limit: number, before?: number) {
    const rows = this.db.prepare('SELECT rowid,data FROM runs WHERE (? IS NULL OR pair_id=?) AND (? IS NULL OR rowid<?) ORDER BY rowid DESC LIMIT ?').all(pairId ?? null, pairId ?? null, before ?? null, before ?? null, limit);
    const replies = this.db.prepare("SELECT COUNT(*) n FROM messages WHERE run_id=? AND sender!='user' AND state='committed'");
    return {
      runs: rows.map(row => {
        const run = JSON.parse(String(row.data)) as Run;
        return { id: run.id, pairId: run.pairId, cursor: Number(row.rowid), createdAt: run.createdAt ?? null, status: run.status, reason: run.reason, topic: run.config.topic.slice(0, 300), participants: run.participants ?? null, replies: Number(replies.get(run.id)!.n), requests: run.requests, elapsedMs: run.elapsedMs };
      }),
      next: rows.length === limit ? Number(rows.at(-1)!.rowid) : null,
    };
  }
  // Every run grouped into threads, oldest run first within each thread. Read-only.
  threads() {
    const groups = new Map<string, { id: string; pairId: string; runs: Run[] }>();
    for (const row of this.db.prepare('SELECT data FROM runs ORDER BY rowid').all()) {
      const run = JSON.parse(String(row.data)) as Run, id = threadKey(run.pairId, run.sessions);
      let group = groups.get(id); if (!group) groups.set(id, group = { id, pairId: run.pairId, runs: [] });
      group.runs.push(run);
    }
    return [...groups.values()];
  }
  // Per-run counts and the time of the latest recorded event, for thread summaries.
  runActivity() {
    const counts = new Map<string, { prompts: number; replies: number; lastAt: string | null }>();
    for (const row of this.db.prepare("SELECT run_id, SUM(sender='user') prompts, SUM(sender!='user' AND state='committed') replies FROM messages GROUP BY run_id").all()) counts.set(String(row.run_id), { prompts: Number(row.prompts), replies: Number(row.replies), lastAt: null });
    for (const row of this.db.prepare('SELECT run_id, MAX(time) last FROM events GROUP BY run_id').all()) {
      const entry = counts.get(String(row.run_id)) ?? { prompts: 0, replies: 0, lastAt: null }; entry.lastAt = row.last === null ? null : String(row.last); counts.set(String(row.run_id), entry);
    }
    return counts;
  }
  // Read-only search over room messages (what the user saw), newest first. LIKE wildcards in the query are literal.
  searchMessages(pairId: string | undefined, query: string, limit: number) {
    const pattern = '%' + query.replace(/[\\%_]/g, c => '\\' + c) + '%';
    const rows = this.db.prepare(`SELECT m.id,m.run_id,m.sender,m.text,r.data FROM messages m JOIN runs r ON r.id=m.run_id WHERE (? IS NULL OR r.pair_id=?) AND m.text LIKE ? ESCAPE '\\' ORDER BY m.seq DESC LIMIT ?`).all(pairId ?? null, pairId ?? null, pattern, limit);
    return rows.map(row => {
      const text = String(row.text), at = Math.max(0, text.toLowerCase().indexOf(query.toLowerCase())), from = Math.max(0, at - 60), to = Math.min(text.length, at + query.length + 60);
      const run = JSON.parse(String(row.data)) as Run;
      return { runId: run.id, threadId: threadKey(run.pairId, run.sessions), messageId: String(row.id), sender: String(row.sender), snippet: (from ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : ''), runTopic: run.config.topic.slice(0, 120), runCreatedAt: run.createdAt ?? null, participants: run.participants ?? null };
    });
  }
  // Operator release of a quarantined run. The caller has already proven no owned provider process survives.
  reconcile(runId: string, details: { note: string | null; checked: LedgerProcess[] }) {
    return this.transaction(() => {
      const run = this.run(runId), pair = this.pair(run.pairId);
      if (run.status !== 'needs_attention') throw new AvAError('NOT_NEEDS_ATTENTION', 'Only a run that needs attention can be released.');
      if (pair.activeRunId !== runId) throw new AvAError('NOT_PAIR_OWNER', 'This run no longer holds its pair; nothing was released.');
      const abandoned = this.db.prepare("SELECT id FROM turns WHERE run_id=? AND status IN ('queued','submitted','uncertain')").all(runId).map(r => String(r.id));
      this.db.prepare("UPDATE turns SET status='abandoned' WHERE run_id=? AND status IN ('queued','submitted','uncertain')").run(runId);
      this.db.prepare("UPDATE phases SET status='abandoned' WHERE run_id=? AND status IN ('open','interrupted')").run(runId);
      // The census just proved these recorded processes are gone; close their ledger rows so later checks don't re-test them.
      const closed = new Date().toISOString(), exit = this.db.prepare('UPDATE processes SET exited_at=? WHERE pid=? AND spawned_at=? AND exited_at IS NULL');
      for (const p of details.checked) exit.run(closed, p.pid, p.spawnedAt);
      this.db.prepare("UPDATE messages SET state='not_delivered' WHERE run_id=? AND state='queued'").run(runId);
      const previousReason = run.reason;
      run.status = 'stopped'; run.reason = 'reconciled'; this.saveRun(run);
      if (pair.activeRunId === runId) pair.activeRunId = null;
      for (const seat of SEATS) Object.assign(pair.slots[seat], { generation: pair.slots[seat].generation + 1, state: 'configuring', sessionId: null, verifiedAt: null, error: 'Released after recovery. Activate this agent again.' });
      this.savePair(pair);
      this.event(runId, 'reconciled', { previousReason, abandonedTurns: abandoned, checkedProcesses: details.checked.length, note: details.note });
      this.event(runId, 'run_ended', { status: run.status, reason: run.reason });
      return { runId, released: true, previousReason, abandonedTurns: abandoned.length, checkedProcesses: details.checked.length };
    }, 'reconcile');
  }
  event(runId: string, type: string, data: unknown) {
    this.db.prepare('INSERT INTO events(run_id,type,data,time) VALUES(?,?,?,?)').run(runId, type, JSON.stringify(data), new Date().toISOString());
  }
  events(runId: string, after = 0, limit = 300) {
    return this.db.prepare('SELECT * FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT ?').all(runId, after, Math.max(1, Math.min(limit, 1000))).map(r => ({ version:1,seq: Number(r.seq), type: String(r.type), data: JSON.parse(String(r.data)), time: String(r.time) }));
  }
  turns(runId: string) { return this.db.prepare('SELECT * FROM turns WHERE run_id=? ORDER BY rowid').all(runId); }
  // Direct (1:1) messages. A user message is 'pending' until its agent answers ('answered'), or the request is
  // 'cancelled', 'failed', or 'interrupted' by a service restart (never resent).
  addDirect(m: { id: string; pairId: string; threadId: string; seat: Seat; sender: 'user' | 'agent'; text: string; state: string }) {
    this.db.prepare('INSERT INTO direct_messages(id,pair_id,thread_id,seat,sender,text,state,time) VALUES(?,?,?,?,?,?,?,?)').run(m.id, m.pairId, m.threadId, m.seat, m.sender, m.text, m.state, new Date().toISOString());
  }
  setDirectState(id: string, state: string, error: string | null = null) { this.db.prepare('UPDATE direct_messages SET state=?, error=? WHERE id=?').run(state, error, id); }
  directMessages(threadId: string) {
    return this.db.prepare('SELECT * FROM direct_messages WHERE thread_id=? ORDER BY seq').all(threadId).map(r => ({ id: String(r.id), seat: String(r.seat) as Seat, sender: String(r.sender) as 'user' | 'agent', text: String(r.text), state: String(r.state), error: r.error === null ? null : String(r.error), time: String(r.time) }));
  }
  // Threads that have direct messages: their pair, message count, and first and last message times.
  directThreads() {
    return this.db.prepare('SELECT thread_id, pair_id, COUNT(*) n, MIN(time) first, MAX(time) last FROM direct_messages GROUP BY thread_id').all()
      .map(r => ({ threadId: String(r.thread_id), pairId: String(r.pair_id), count: Number(r.n), first: String(r.first), last: String(r.last) }));
  }
  interruptUnfinished() {
    this.db.prepare("UPDATE direct_messages SET state='interrupted', error='The service restarted before a reply arrived. Nothing was resent.' WHERE state='pending'").run();
    for (const row of this.db.prepare('SELECT data FROM runs').all()) {
      const run = JSON.parse(String(row.data)) as Run;
      if (['running', 'pausing', 'stopping', 'paused'].includes(run.status)) {
        this.db.prepare("UPDATE turns SET status='uncertain' WHERE run_id=? AND status IN ('queued','submitted')").run(run.id);
        this.db.prepare("UPDATE phases SET status='interrupted' WHERE run_id=? AND status='open'").run(run.id);
        this.finish(run.id, 'needs_attention', 'service_interrupted', run.elapsedMs);
      }
    }
  }
}
