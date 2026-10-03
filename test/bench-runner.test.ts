import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { AvAService } from '../src/service.js';
import { listen } from '../src/http.js';
import type { BenchJob } from '../src/bench-runner.js';
import { BenchmarkFactory,agents,finishJob,startJob } from './bench-fakes.js';
import { tempDir } from './temp.js';
import { flush } from './fakes.js';
const ids=['invoice-total','tip-calculator','discount-review'];
test('live program verifiers are refused before any provider work, even after task validation',async()=>{
  const data=tempDir('ava-bench-live-guard-'),factory=new BenchmarkFactory(data),service=new AvAService(data,factory,'live',{processes:async()=>[]});
  try{
    await service.call('bench.validate',{taskIds:['tip-calculator']});
    await assert.rejects(startJob(service,['tip-calculator'],'blocked-live'),/execution sandbox/);
    assert.equal(factory.agents.length,0);assert.equal(service.benchmarks.jobs().length,0);
    assert.match(service.benchmarks.catalog().find(t=>t.id==='tip-calculator')!.blockedReason,/execution sandbox/);
  }finally{await service.shutdown();service.store.close();}
});
function fixture(){const data=tempDir('ava-bench-run-'),factory=new BenchmarkFactory(data),service=new AvAService(data,factory,'simulation',{processes:async()=>[]});return {data,factory,service,async close(){await service.shutdown();service.store.close();}};}
test('unvalidated tasks refuse model work; a full run uses fresh sessions and records all six graded attempts',async()=>{
  const f=fixture();try{
    await assert.rejects(startJob(f.service,ids,'unvalidated'),/needs validation/);assert.equal(f.factory.agents.length,0);
    await f.service.call('bench.validate',{taskIds:ids});
    const started=await startJob(f.service,ids),job=await finishJob(f.service,started.id);
    assert.equal(job.status,'completed',job.error??'The job should complete');assert.equal(job.results.length,6);assert.ok(job.results.every(r=>r.status==='pass'),JSON.stringify(job.results.filter(r=>r.status!=='pass').map(r=>({task:r.taskId,checks:f.service.benchmarks.attempt(r.id).checks,answer:f.service.benchmarks.attempt(r.id).answer}))));
    assert.equal(job.requestCeiling,12);assert.equal(job.requestsAdmitted,12);assert.equal(f.factory.taskRequests,6);assert.equal(f.factory.agents.length,6);assert.ok(f.factory.agents.every(a=>a.closed));
    assert.equal(new Set(f.factory.agents.map(a=>a.sessionId)).size,6);
    const built=f.service.benchmarks.attempt(job.results.find(r=>r.taskId==='tip-calculator')!.id);assert.equal(built.checks.length,2);assert.match(readFileSync(join(built.artifact!,'tip.js'),'utf8'),/calcTip/);
    const calls=f.factory.taskRequests;const retry=await startJob(f.service,ids);assert.equal(retry.id,job.id);await flush();assert.equal(f.factory.taskRequests,calls,'lost start acknowledgement cannot launch another job');
  }finally{await f.close();}
});
test('repeats get new sessions and attempt IDs while a check failure remains a scored result',async()=>{
  const f=fixture();f.factory.wrongSeat='cli2';try{
    await f.service.call('bench.validate',{taskIds:['invoice-total']});const job=await finishJob(f.service,(await startJob(f.service,['invoice-total'],'repeat',2)).id);
    assert.equal(job.status,'completed');assert.deepEqual(job.results.map(r=>r.status),['pass','fail','pass','fail']);assert.equal(new Set(job.results.map(r=>r.id)).size,4);assert.equal(f.factory.agents.length,4);
  }finally{await f.close();}
});
test('a real provider failure stops the job without starting another task or resending work',async()=>{
  const f=fixture();try{
    await f.service.call('bench.validate',{taskIds:ids});f.factory.failActivation=true;const job=await finishJob(f.service,(await startJob(f.service,ids)).id);
    assert.equal(job.status,'failed');assert.match(job.error!,/startup failure/);assert.equal(job.results.length,2);assert.ok(job.results.every(r=>r.status==='error'));assert.equal(f.factory.taskRequests,0);
  }finally{await f.close();}
});
test('cancel and Stop all interrupt benchmark work, block history clearing, and preserve job records',async()=>{
  const f=fixture();f.factory.hold=true;try{
    await f.service.call('bench.validate',{taskIds:['invoice-total']});const started=await startJob(f.service,['invoice-total']);
    for(const deadline=Date.now()+3000;f.factory.taskRequests<2&&Date.now()<deadline;)await new Promise(r=>setTimeout(r,10));
    await assert.rejects(f.service.call('history.clear',{requestId:'clear'}),/Stop the benchmark/);
    await f.service.call('resources.stop',{requestId:'stop-all'});const job=await finishJob(f.service,started.id);
    assert.equal(job.status,'cancelled');assert.ok(job.results.every(r=>r.status==='cancelled'));assert.ok(f.factory.agents.every(a=>a.closed));assert.equal(f.factory.taskRequests,2);
  }finally{await f.close();}
});
test('a restarted service marks unfinished jobs interrupted and never resubmits them',async()=>{
  const f=fixture();let job:BenchJob;
  try{
    await f.service.call('bench.validate',{taskIds:['invoice-total']});job=await finishJob(f.service,(await startJob(f.service,['invoice-total'])).id);
    job.status='running';job.current={taskId:'invoice-total',repeat:2,pending:[]};f.service.store.db.prepare('UPDATE bench_jobs SET data=? WHERE id=?').run(JSON.stringify(job),job.id);
  }finally{await f.close();}
  const nextFactory=new BenchmarkFactory(f.data),next=new AvAService(f.data,nextFactory,'simulation',{processes:async()=>[]});
  try{assert.equal(next.benchmarks.get(job!.id).status,'interrupted');assert.equal(nextFactory.agents.length,0);assert.equal(next.benchmarks.get(job!.id).results.length,2);}finally{await next.shutdown();next.store.close();}
});
test('the headless CLI runs through the same protected service and prints its request ceiling',async()=>{
  const f=fixture(),http=await listen(f.service,resolve('dist/web'));
  try{
    await f.service.call('bench.validate',{taskIds:['invoice-total']});
    const result=await promisify(execFile)(process.execPath,['--import','tsx','src/bench-cli.ts','run','benchmarks/starter','--task','invoice-total','--agents','codex:fixture,claude:fixture','--data',f.data],{cwd:resolve('.'),windowsHide:true,timeout:15000,maxBuffer:100000});
    const rows=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));assert.equal(rows[0].requestCeiling,4);assert.equal(rows.at(-1).passed,2);assert.equal(rows.at(-1).status,'completed');assert.equal(f.factory.taskRequests,2);
  }finally{await http.close();f.service.store.close();}
});
