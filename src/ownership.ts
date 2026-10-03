import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { AvAError } from './types.js';

// When this process started (epoch ms), recorded with each ownership claim.
export const processStarted = () => Math.round(Date.now() - process.uptime() * 1000);
const START_SLACK_MS = 10_000;
// Whether the process recorded as an owner is still that process. A live PID alone isn't proof: Windows reuses PIDs, often
// right after a reboot, and a stale record would then block every new service. So a recorded start time must match too.
// A record without one (older versions), or a start time the system won't tell, falls back to the PID alone.
export function ownerAlive(pid: number, started?: number | null) {
  try { process.kill(pid, 0); } catch { return false; }
  if (started == null) return true;
  const actual = startTimeOf(pid);
  return actual === undefined || Math.abs(actual - started) <= START_SLACK_MS;
}
function startTimeOf(pid: number): number | undefined {
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
    : spawnSync('ps', ['-o', 'etimes=', '-p', String(pid)], { encoding: 'utf8', timeout: 20_000 });
  if (result.status !== 0) return undefined;
  const text = result.stdout.trim();
  const value = process.platform === 'win32' ? Date.parse(text) : Date.now() - Number(text) * 1000;
  return Number.isFinite(value) && text ? value : undefined;
}
// The claim's start time travels in its token ("<owner>@<started>"), so the table keeps the shape older versions sharing
// this data folder write and read; their claims (no "@") are judged by PID alone.
export function claimOwner(dataRoot:string,owner:string){
  const db=new DatabaseSync(join(dataRoot,'owner.sqlite')),token=`${owner}@${processStarted()}`;
  db.exec('PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,token TEXT NOT NULL); BEGIN IMMEDIATE');
  try{
    const old=db.prepare('SELECT pid,token FROM owner WHERE id=1').get(),started=Number(String(old?.token??'').split('@')[1]);
    if(old&&ownerAlive(Number(old.pid),Number.isFinite(started)&&started>0?started:null))throw new AvAError('OWNER_EXISTS','An AvA service already owns this data directory.');
    db.prepare('INSERT OR REPLACE INTO owner VALUES(1,?,?)').run(process.pid,token);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');db.close();throw error;}
  db.close();
  return ()=>{const state=new DatabaseSync(join(dataRoot,'owner.sqlite'));try{state.prepare('DELETE FROM owner WHERE id=1 AND pid=? AND token=?').run(process.pid,token);}finally{state.close();}};
}
