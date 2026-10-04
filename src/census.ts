import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Seat } from './types.js';

// Provider processes are recorded when ACPX spawns them, so a later owner can prove they are gone
// before releasing a pair. A recorded PID only counts as the same process if its start time matches.
export interface ProcessLedger { spawned(process: { pid: number; pairId: string; seat: Seat; generation: number }): void; exited(pid: number): void }
// `exited`: the adapter's own exit was recorded. It can no longer be the survivor, but its children still can.
// exitedAt: when its exit was recorded; children of that PID started after then belong to whatever reused the PID.
export interface LedgerProcess { pid: number; spawnedAt: string; ownerPid: number; exited?: boolean; exitedAt?: string }
export interface SystemProcess { pid: number; ppid: number; started: number; name: string; memoryBytes?: number; session?: number }
export interface Survivor { pid: number; parentPid: number; name: string }
export type Census = (recorded: LedgerProcess[]) => Promise<Survivor[]>;

export const START_SLACK_MS = 10_000;
// When this Windows logon session began: the start of its winlogon.exe, which Windows creates for each session before
// anything in it runs. No process outlives its session (a restart, a sign-out, or a shutdown with Fast Startup, which
// keeps the boot time running), so a process recorded before then is gone with all its descendants, and its PID proves
// nothing. -Infinity where it can't be told (no session in the listing, or another system).
export function sessionStart(processes: SystemProcess[], self = process.pid) {
  const session = processes.find(p => p.pid === self)?.session;
  const logon = session === undefined ? undefined : processes.find(p => p.session === session && p.name.toLowerCase() === 'winlogon.exe');
  return logon ? logon.started : -Infinity;
}
// Recorded processes whose own process is no longer running (nothing with their PID and start time).
export const notRunning = (recorded: LedgerProcess[], processes: SystemProcess[]) =>
  recorded.filter(entry => !processes.some(p => p.pid === entry.pid && Math.abs(p.started - Date.parse(entry.spawnedAt)) <= START_SLACK_MS));
// Recorded processes still alive, plus any live descendants (children of a dead adapter keep their parent PID on Windows).
// A record from before this logon session counts for nothing.
export function survivors(recorded: LedgerProcess[], processes: SystemProcess[]): Survivor[] {
  const found = new Map<number, Survivor>(), roots = new Map<number, number>(), exits = new Map<number, number>(), since = sessionStart(processes);
  for (const entry of recorded) {
    const spawned = Date.parse(entry.spawnedAt);
    if (!(spawned >= since - START_SLACK_MS)) continue;
    roots.set(entry.pid, spawned);
    if (entry.exitedAt) exits.set(entry.pid, Date.parse(entry.exitedAt));
    // Even with an exit on record, the same process (same start time) still running counts: trust what is running.
    const alive =processes.find(p => p.pid === entry.pid && Math.abs(p.started - spawned) <= START_SLACK_MS);
    if (alive) found.set(alive.pid, { pid: alive.pid, parentPid: alive.ppid, name: alive.name });
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const p of processes) {
      if (found.has(p.pid)) continue;
      const holder = processes.find(q => q.pid === p.ppid);
      let parentStart = found.has(p.ppid) ? holder?.started : roots.get(p.ppid);
      // A dead recorded parent whose PID now belongs to an unrelated process: only children older than that process are ours.
      if (!found.has(p.ppid) && holder && p.started >= holder.started) parentStart = undefined;
      // A recorded parent that exited can only have had children before it exited; later ones have another parent.
      const exited = found.has(p.ppid) ? undefined : exits.get(p.ppid);
      if (exited !== undefined && p.started > exited + START_SLACK_MS) parentStart = undefined;
      if (parentStart !== undefined && p.started >= parentStart - START_SLACK_MS) { found.set(p.pid, { pid: p.pid, parentPid: p.ppid, name: p.name }); grew = true; }
    }
  }
  return [...found.values()];
}
const run = promisify(execFile);
export async function listProcesses(): Promise<SystemProcess[]> {
  if (process.platform === 'win32') {
    const script = "Get-CimInstance Win32_Process | Where-Object { $_.CreationDate } | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; started = $_.CreationDate.ToUniversalTime().ToString('o'); name = $_.Name; memoryBytes = [double]$_.WorkingSetSize; session = $_.SessionId } } | ConvertTo-Json -Compress";
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
    const rows = JSON.parse(stdout) as Array<{ pid: number; ppid: number; started: string; name: string; memoryBytes:number; session: number }>;
    return (Array.isArray(rows) ? rows : [rows]).map(r => ({ pid: r.pid, ppid: r.ppid, started: Date.parse(r.started), name: r.name, memoryBytes:r.memoryBytes, session: r.session }));
  }
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=,etimes=,rss=,comm='], { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
  const now = Date.now();
  return stdout.trim().split('\n').map(line => line.trim().split(/\s+/)).map(([pid, ppid, elapsed, rss, ...name]) => ({ pid: Number(pid), ppid: Number(ppid), started: now - Number(elapsed) * 1000, name: name.join(' '),memoryBytes:Number(rss)*1024 }));
}
export const systemCensus: Census = async recorded => recorded.length ? survivors(recorded, await listProcesses()) : [];
