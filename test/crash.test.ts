import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { other, type Run, type Seat } from '../src/types.js';
import { TestFactory } from './fakes.js';
import { tempDir } from './temp.js';

// One run: paired opening (2 requests), then single replies until the 6-request limit, then finish.
// Occurrence N is the Nth time the worker reaches that point.
// Each case also states exactly what must be on disk afterwards: requests that reached a provider, committed replies,
// and recorded phases (the paired opening is one phase; each later reply is its own single phase).
const CASES:Array<[point:string,occurrence:number,expect:string,exact:{sent:number;committed:number;phases:number}]>=[
  ['admit:inside',1,'first phase never existed; nothing sent',{sent:0,committed:0,phases:0}],
  ['admit:committed',1,'phase admitted, nothing submitted yet',{sent:0,committed:0,phases:1}],
  ['started:committed',1,'one opening submitted',{sent:1,committed:0,phases:1}],
  ['commit:after-message',1,'first reply rolled back mid-commit',{sent:2,committed:0,phases:1}],
  ['commit:committed',1,'first opening committed, paired phase still open',{sent:2,committed:1,phases:1}],
  ['commit:inside',2,'phase-completing reply rolled back with its next-seat decision',{sent:2,committed:1,phases:1}],
  ['commit:committed',2,'paired phase complete',{sent:2,committed:2,phases:1}],
  ['commit:committed',3,'first single phase complete',{sent:3,committed:3,phases:2}],
  ['finish:inside',1,'terminal state rolled back',{sent:6,committed:6,phases:5}],
  ['finish:committed',1,'run finished before the crash',{sent:6,committed:6,phases:5}],
];
interface Entry{type:string;turnId?:string;runId?:string;pairId?:string;point?:string}
for(const [point,occurrence,expect,exact] of CASES)test(`crash at ${point} #${occurrence}: ${expect}`,async()=>{
  const dir=tempDir('ava-crash-');
  const child=spawnSync(process.execPath,['--import','tsx',join('test','crash-worker.ts'),dir,point,String(occurrence)],{encoding:'utf8',windowsHide:true,timeout:60_000});
  const log=readFileSync(join(dir,'worker.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as Entry);
  assert.equal(child.status,137,`worker should die at the fault point (stderr: ${child.stderr})`);
  assert.deepEqual(log.at(-1),{type:'crash',point,occurrence});
  const {runId,pairId}=log.find(e=>e.type==='started')!,sent=log.filter(e=>e.type==='request').map(e=>e.turnId!);
  const factory=new TestFactory(),service=new AvAService(dir,factory,'simulation'),db=service.store.db;
  try{
    const run=service.store.run(runId!),pair=service.store.pair(pairId!),turns=service.store.turns(runId!);
    const committedReplies=Number(db.prepare("SELECT COUNT(*) n FROM messages WHERE run_id=? AND sender!='user' AND state='committed'").get(runId!)!.n);
    const phaseCount=Number(db.prepare('SELECT COUNT(*) n FROM phases WHERE run_id=?').get(runId!)!.n);
    assert.deepEqual({sent:sent.length,committed:committedReplies,phases:phaseCount},exact,'exactly what this crash point leaves on disk');
    const status=new Map(turns.map(t=>[String(t.id),String(t.status)]));
    // Nothing that reached a provider may look unsent or in flight; in-flight work is uncertain, never retried.
    for(const id of sent)assert.ok(['completed','uncertain'].includes(status.get(id)??'missing'),`sent turn ${id} is ${status.get(id)}`);
    assert.ok(turns.every(t=>!['queued','submitted'].includes(String(t.status))),'no turn is left looking unsent');
    // Each completed turn has exactly one public message, and nothing else was published.
    const published=db.prepare("SELECT turn_id,COUNT(*) n FROM messages WHERE run_id=? AND sender!='user' GROUP BY turn_id").all(runId!);
    assert.ok(published.every(r=>Number(r.n)===1),'no duplicate public message');
    assert.deepEqual(published.map(r=>String(r.turn_id)).sort(),turns.filter(t=>t.status==='completed').map(t=>String(t.id)).sort());
    // The next-seat decision matches the last completed phase exactly.
    const last=db.prepare("SELECT kind,seats FROM phases WHERE run_id=? AND status='complete' ORDER BY rowid DESC LIMIT 1").get(runId!);
    const expected:Seat=!last||last.kind==='paired'?run.config.lead:other((JSON.parse(String(last.seats)) as Seat[])[0]!);
    assert.equal(run.nextSeat,expected);
    for(const phase of db.prepare("SELECT id,seats FROM phases WHERE run_id=? AND status='complete'").all(runId!)){
      const done=new Set(turns.filter(t=>t.phase_id===phase.id&&t.status==='completed').map(t=>String(t.seat)));
      assert.ok((JSON.parse(String(phase.seats)) as Seat[]).every(s=>done.has(s)),'a complete phase has a reply from every seat');
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM phases WHERE run_id=? AND status='open'").get(runId!)!.n,0,'open phases are marked interrupted');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE run_id=? AND state='queued'").get(runId!)!.n,0,'no message is left queued');
    // A crash before the run finished keeps the pair lease; only a committed finish releases it.
    if(point==='finish:committed'){assert.equal(run.status,'stopped');assert.equal(run.reason,'request_limit');assert.equal(pair.activeRunId,null);}
    else{assert.equal(run.status,'needs_attention');assert.equal(run.reason,'service_interrupted');assert.equal(pair.activeRunId,runId);}
    // The new owner starts no provider work, and a second restart changes nothing.
    assert.equal(factory.agents.length,0);
    const snapshot=JSON.stringify([service.store.run(runId!),service.store.turns(runId!),service.store.messages(runId!)]);
    await service.shutdown();service.store.close();
    const again=new AvAService(dir,new TestFactory(),'simulation');
    assert.equal(JSON.stringify([again.store.run(runId!),again.store.turns(runId!),again.store.messages(runId!)]),snapshot);
    await again.shutdown();again.store.close();
  }finally{try{service.store.close();}catch{}}
});
