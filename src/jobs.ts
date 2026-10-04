import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Windows job objects for agent processes (roadmap X3). Each agent starts through a small launcher, which ACPX spawns.
// The launcher waits until AvA has assigned it to the agent's job, then starts the real agent. So the agent, and
// everything it starts, is in the job from its first instruction, with no window in which a child could start outside.
// The job allows no breakaway, so nothing started inside can leave it, even when its parent exits.
// The jobs aren't kill-on-close: if the service stops, agents and kept app servers behave as before, and the process
// ledger still finds survivors. While the service runs, a job's member list is the exact set of an agent's processes.
// A long-lived helper (Windows PowerShell with a compiled C# class) holds the job handles: a job loses its name with
// its last handle, so the service keeps them open to list or stop members later.

// Some processes start outside the job of the process that started them: a Microsoft Store (MSIX) app such as
// PowerShell 7 from the Store, which Windows starts in its package's own job, and programs started through Windows'
// Secondary Logon service. Windows also refuses to add such a process to another job. So the helper keeps each job's
// lineage too: about every 100 ms it reads a process snapshot and records any process whose parent is a member or is
// already in the lineage, with its start time (a child can't be older than its parent, which rules out reused PIDs).
// A job's members are then the processes in it plus the lineage still running.
const HELPER = String.raw`
using System; using System.Collections.Generic; using System.ComponentModel; using System.Runtime.InteropServices; using System.Threading;
public static class AvAJobs {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Entry { public uint Size, Usage, Pid; public IntPtr Heap; public uint Module, Threads, ParentPid; public int Priority; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string Exe; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended data, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, uint size, out uint written);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  static readonly object gate = new object();
  static readonly Dictionary<string, IntPtr> jobs = new Dictionary<string, IntPtr>();
  static readonly Dictionary<string, Dictionary<uint, long>> lineage = new Dictionary<string, Dictionary<uint, long>>();
  static Timer watcher;
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static IntPtr Job(string name) { IntPtr job; if (!jobs.TryGetValue(name, out job)) throw new InvalidOperationException("No such job."); return job; }
  // The process's start time (FILETIME ticks), or 0 if it can't be read (gone, or not accessible).
  static long Started(uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid); if (process == IntPtr.Zero) return 0; // PROCESS_QUERY_LIMITED_INFORMATION
    try { long created, exited, kernel, user; return GetProcessTimes(process, out created, out exited, out kernel, out user) ? created : 0; } finally { CloseHandle(process); }
  }
  static List<KeyValuePair<uint, uint>> Snapshot() {
    var list = new List<KeyValuePair<uint, uint>>(); IntPtr snapshot = CreateToolhelp32Snapshot(0x2, 0);
    if (snapshot == IntPtr.Zero || snapshot == new IntPtr(-1)) return list;
    try { var entry = new Entry(); entry.Size = (uint)Marshal.SizeOf(typeof(Entry)); if (Process32FirstW(snapshot, ref entry)) do { list.Add(new KeyValuePair<uint, uint>(entry.Pid, entry.ParentPid)); } while (Process32NextW(snapshot, ref entry)); }
    finally { CloseHandle(snapshot); }
    return list;
  }
  static uint[] InJob(IntPtr job) {
    int capacity = 4096, size = 8 + capacity * IntPtr.Size; IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      uint written; Check(QueryInformationJobObject(job, 3, buffer, (uint)size, out written)); // JOBOBJECT_BASIC_PROCESS_ID_LIST
      int count = Marshal.ReadInt32(buffer, 4); var pids = new uint[count];
      for (int i = 0; i < count; i++) pids[i] = (uint)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
      return pids;
    } finally { Marshal.FreeHGlobal(buffer); }
  }
  // Each job's lineage holds every process seen in it or descended from one, with its start time. Exited ones stay, so
  // a child whose parent has just exited (a shell that ran Start-Process) still finds it. A recorded PID running again
  // with another start time was reused, and stops counting.
  static void Sweep() {
    lock (gate) {
      if (jobs.Count == 0) return;
      List<KeyValuePair<uint, uint>> processes; try { processes = Snapshot(); } catch { return; }
      var running = new HashSet<uint>(); foreach (var p in processes) running.Add(p.Key);
      foreach (var job in jobs) {
        var known = lineage[job.Key]; uint[] members; try { members = InJob(job.Value); } catch { continue; }
        foreach (var pid in members) if (!known.ContainsKey(pid)) { long started = Started(pid); if (started != 0) known[pid] = started; }
        foreach (var pid in new List<uint>(known.Keys)) if (running.Contains(pid)) { long started = Started(pid); if (started != 0 && started != known[pid]) known.Remove(pid); }
        for (bool grew = true; grew; ) {
          grew = false;
          foreach (var p in processes) {
            if (known.ContainsKey(p.Key) || p.Key == p.Value || !known.ContainsKey(p.Value)) continue;
            long started = Started(p.Key);
            if (started == 0 || started < known[p.Value]) continue;
            known[p.Key] = started; grew = true;
          }
        }
      }
    }
  }
  // Flags: 0x400 die on an unhandled exception (no error-report dialog); 0x200 a job memory limit when one is given.
  // Neither breakaway flag is set, so no process in the job can leave it.
  public static void Create(string name, long memoryBytes) {
    lock (gate) {
      if (jobs.ContainsKey(name)) return;
      IntPtr job = CreateJobObject(IntPtr.Zero, null); if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      var limits = new Extended(); limits.Basic.Flags = 0x400;
      if (memoryBytes > 0) { limits.Basic.Flags |= 0x200; limits.JobMemory = new UIntPtr((ulong)memoryBytes); }
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Extended)))) { int error = Marshal.GetLastWin32Error(); CloseHandle(job); throw new Win32Exception(error); }
      jobs[name] = job; lineage[name] = new Dictionary<uint, long>();
      if (watcher == null) watcher = new Timer(delegate { Sweep(); }, null, 100, 100);
    }
  }
  public static void Assign(string name, int pid) {
    lock (gate) {
      IntPtr process = OpenProcess(0x0100 | 0x0001, false, (uint)pid); // PROCESS_SET_QUOTA | PROCESS_TERMINATE
      if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { Check(AssignProcessToJobObject(Job(name), process)); } finally { CloseHandle(process); }
    }
  }
  // The job's processes, then its lineage still running with the start time it was recorded with.
  public static long[] List(string name) {
    lock (gate) {
      IntPtr job; if (!jobs.TryGetValue(name, out job)) return new long[0];
      var all = new List<long>(); foreach (var pid in InJob(job)) all.Add(pid);
      foreach (var known in lineage[name]) if (!all.Contains(known.Key) && Started(known.Key) == known.Value) all.Add(known.Key);
      return all.ToArray();
    }
  }
  public static void Terminate(string name) { lock (gate) { IntPtr job; if (jobs.TryGetValue(name, out job)) Check(TerminateJobObject(job, 1)); } }
  public static void Close(string name) { lock (gate) { IntPtr job; if (jobs.TryGetValue(name, out job)) { CloseHandle(job); jobs.Remove(name); lineage.Remove(name); } } }
}`;
// One JSON request per line on stdin, one JSON answer per line on stdout. The helper ends when stdin closes (the
// service exited), which closes its job handles without stopping anything in the jobs.
const HOST = `$ErrorActionPreference='Stop'
Add-Type -TypeDefinition $env:AVA_JOB_HELPER
[Console]::Out.WriteLine('{"ready":true}')
while(($line=[Console]::In.ReadLine()) -ne $null){
  $request=$null
  try{
    $request=$line|ConvertFrom-Json;$answer=@{id=$request.id;ok=$true}
    switch($request.op){
      'create'{[AvAJobs]::Create([string]$request.name,[long]$request.memory)}
      'assign'{[AvAJobs]::Assign([string]$request.name,[int]$request.pid)}
      'list'{$answer.pids=@([AvAJobs]::List([string]$request.name))}
      'terminate'{[AvAJobs]::Terminate([string]$request.name)}
      'close'{[AvAJobs]::Close([string]$request.name)}
      default{throw 'Unknown request.'}
    }
  }catch{$answer=@{id=$(if($request){$request.id}else{0});ok=$false;error=$_.Exception.Message}}
  [Console]::Out.WriteLine(($answer|ConvertTo-Json -Compress))
}`;

// The launcher ACPX starts in place of the agent: <node> <launcher> <signal folder> <agent command> <arguments...>.
const LAUNCHER = `// AvA agent launcher (src/jobs.ts). Waits until AvA has placed this process in the agent's job object, or decided it
// can't, then starts the agent with this process's own stdio, so the agent and its children are in the job from birth.
import {spawn} from 'node:child_process';
import {existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
const [folder,command,...args]=process.argv.slice(2),ready=join(folder,process.pid+'.ready'),deadline=Date.now()+30000;
while(!existsSync(ready)){
  if(Date.now()>deadline){process.stderr.write('AvA did not release this agent to start.\\n');process.exit(1);}
  await new Promise(resolve=>setTimeout(resolve,15));
}
rmSync(ready,{force:true});
const child=spawn(command,args,{stdio:'inherit',windowsHide:true});
child.on('error',()=>{process.stderr.write('The agent failed to start.\\n');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
`;

// Whether a process with this PID is running (signal 0 tests without signalling).
const running = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; } };
// Stops exactly these processes, not their trees: a kept app server can be the child of a member that is stopped.
const stopExactly = (pids: number[]) => new Promise<void>(done => {
  if (!pids.length) { done(); return; }
  execFile('taskkill', ['/F', ...pids.flatMap(pid => ['/PID', String(pid)])], { windowsHide: true, timeout: 30_000 }, () => done());
});

export interface AgentJobs {
  // The launcher's command line for an agent command, or the command itself when jobs aren't available.
  launch(argv: string[]): Promise<{ argv: string[]; contained: boolean; note: string }>;
  create(name: string, memoryBytes?: number): Promise<void>;
  // Assigns a started launcher to its job and lets it start the agent; contained is false when assignment failed.
  release(name: string, pid: number): Promise<boolean>;
  members(name: string): Promise<number[]>;
  scopeMembers(prefix: string): Promise<number[]>;
  // Stops every member except those kept (or the whole job when none are), then lets the job go.
  retire(name: string, keep?: number[]): Promise<void>;
  dispose(): void;
}

export class JobHost implements AgentJobs {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private failure?: string;
  private next = 1;
  private waiting = new Map<number, { resolve(value: { ok: boolean; pids?: number[]; error?: string }): void; reject(error: Error): void }>();
  private names = new Set<string>();
  constructor(private dataRoot: string, private stop: (pids: number[]) => Promise<void> = stopExactly) {}
  private get folder() { return join(this.dataRoot, 'jobs'); }
  private launcher() {
    const dir = join(this.dataRoot, 'wrappers'); mkdirSync(dir, { recursive: true });
    const file = join(dir, `job-launch-${createHash('sha256').update(LAUNCHER).digest('hex').slice(0, 16)}.mjs`);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== LAUNCHER) writeFileSync(file, LAUNCHER, { mode: 0o700 });
    return file;
  }
  private start() {
    if (process.platform !== 'win32') { this.failure = 'Job objects are Windows only.'; return Promise.resolve(); }
    return this.starting ??= new Promise<void>(resolve => {
      const fail = (reason: string) => { this.failure ??= reason; for (const w of this.waiting.values()) w.reject(new Error(reason)); this.waiting.clear(); resolve(); };
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(HOST, 'utf16le').toString('base64')],
          { env: { ...process.env, AVA_JOB_HELPER: HELPER }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) { fail(`The job helper could not start (${error instanceof Error ? error.message : String(error)}).`); return; }
      this.child = child;
      const timer = setTimeout(() => { fail('The job helper did not start within 30 seconds.'); child.kill(); }, 30_000);
      let buffered = '', errors = '';
      child.stderr.on('data', chunk => { if (errors.length < 2000) errors += String(chunk); });
      // A write to a helper that has just exited fails with EPIPE; without a listener that error would end the service.
      child.stdin.on('error', error => { fail(`The job helper stopped (${error.message}).`); });
      child.stdout.on('data', chunk => {
        buffered += String(chunk);
        for (let at = buffered.indexOf('\n'); at >= 0; at = buffered.indexOf('\n')) {
          const line = buffered.slice(0, at).trim(); buffered = buffered.slice(at + 1);
          if (!line) continue;
          let message: { ready?: boolean; id?: number; ok?: boolean; pids?: number | number[]; error?: string };
          try { message = JSON.parse(line); } catch { continue; }
          if (message.ready) { clearTimeout(timer); resolve(); continue; }
          const waiter = this.waiting.get(Number(message.id)); this.waiting.delete(Number(message.id));
          const pids = message.pids === undefined ? undefined : Array.isArray(message.pids) ? message.pids : [message.pids];
          waiter?.resolve({ ok: !!message.ok, ...(pids ? { pids: pids.map(Number) } : {}), ...(message.error ? { error: message.error } : {}) });
        }
      });
      child.on('error', error => { clearTimeout(timer); fail(`The job helper failed (${error.message}).`); });
      child.on('exit', () => { clearTimeout(timer); this.child = undefined; fail(`The job helper stopped.${errors.trim() ? ' ' + errors.trim().split(/\r?\n/)[0] : ''}`); });
      child.unref(); (child.stdin as unknown as { unref?(): void }).unref?.();
      (child.stdout as unknown as { unref?(): void }).unref?.(); (child.stderr as unknown as { unref?(): void }).unref?.();
    });
  }
  private async request(op: string, fields: Record<string, unknown>): Promise<{ ok: boolean; pids?: number[]; error?: string }> {
    await this.start();
    if (this.failure || !this.child) throw new Error(this.failure ?? 'The job helper is not running.');
    const id = this.next++, child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error('The job helper did not answer.')); }, 15_000);
      this.waiting.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ id, op, ...fields }) + '\n');
    });
  }
  private async must(op: string, fields: Record<string, unknown>) { const answer = await this.request(op, fields); if (!answer.ok) throw new Error(answer.error ?? `Job ${op} failed.`); return answer; }
  async launch(argv: string[]) {
    if (process.env.AVA_JOB_OBJECTS === 'off') return { argv, contained: false, note: 'Process containment is off (AVA_JOB_OBJECTS=off).' };
    await this.start();
    if (this.failure) return { argv, contained: false, note: `Process containment unavailable: ${this.failure}` };
    mkdirSync(this.folder, { recursive: true });
    this.sweepReady();
    return { argv: [process.execPath, this.launcher(), this.folder, ...argv], contained: true, note: 'Processes contained in a Windows job object.' };
  }
  // A launcher waits at most 30 s for its signal, so an older one was never read (its launcher had gone). Removing it
  // keeps a later launcher that reuses the PID from starting its agent before it is in the job.
  private sweepReady() {
    try { for (const file of readdirSync(this.folder)) { if (!file.endsWith('.ready')) continue; const path = join(this.folder, file); try { if (Date.now() - statSync(path).mtimeMs > 60_000) rmSync(path, { force: true }); } catch { /* gone or in use */ } } }
    catch { /* no folder yet */ }
  }
  async create(name: string, memoryBytes = 0) { await this.must('create', { name, memory: memoryBytes }); this.names.add(name); }
  async release(name: string, pid: number) {
    let contained = false;
    try { await this.must('assign', { name, pid }); contained = true; } catch { /* the agent still starts, found by its process tree */ }
    // A launcher that has already exited never reads its signal, which would wait for the next process with its PID.
    if (!contained && !running(pid)) return false;
    mkdirSync(this.folder, { recursive: true });
    writeFileSync(join(this.folder, `${pid}.ready`), contained ? 'contained' : 'uncontained');
    return contained;
  }
  async members(name: string) { return this.names.has(name) ? (await this.must('list', { name })).pids ?? [] : []; }
  async scopeMembers(prefix: string) {
    const lists = await Promise.all([...this.names].filter(n => n.startsWith(prefix)).map(n => this.members(n).catch(() => [] as number[])));
    return [...new Set(lists.flat())];
  }
  async retire(name: string, keep: number[] = []) {
    if (!this.names.has(name)) return;
    try {
      // With nothing of its own to keep, the job ends at once; its lineage outside the job is stopped below either way.
      // Kept processes count only when they are this job's members: other agents' app servers, or recorded ones that
      // have since exited, mustn't stop it ending as a whole.
      const kept = new Set(keep), first = kept.size ? await this.members(name).catch(() => [] as number[]) : [];
      if (!first.some(pid => kept.has(pid))) await this.must('terminate', { name }).catch(() => {});
      // Twice: a member may start another process while the first set is being stopped.
      for (let pass = 0; pass < 2; pass++) { const stop = (await this.members(name)).filter(pid => !kept.has(pid)); if (!stop.length) break; await this.stop(stop); }
    } finally { this.names.delete(name); await this.must('close', { name }).catch(() => {}); }
  }
  dispose() { this.child?.stdin.end(); this.child = undefined; }
}
