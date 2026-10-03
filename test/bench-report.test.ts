import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { suiteReport } from '../src/bench-report.js';
import type { BenchAttempt, BenchJob } from '../src/bench-runner.js';
import { AvAService } from '../src/service.js';
import { BenchmarkFactory,finishJob,startJob } from './bench-fakes.js';
import { tempDir } from './temp.js';

const TOKEN='ab'.repeat(32),DIGEST='sha256:'+'cd'.repeat(32);
function attempt(partial:Partial<BenchAttempt>):BenchAttempt{
  return {id:'a',jobId:'job-12345678',taskId:'t1',taskVersion:1,digest:'d',title:'Task one',suite:'C:/suites/starter',taskMode:'prompt',prompt:'p',checkSpecs:[],repeat:1,seat:'cli1',
    agent:{provider:'codex',model:'gpt-x',auth:'provider-login',effort:{key:'reasoning_effort',value:'low'}},status:'pass',createdAt:'2026-10-03T20:00:00.000Z',finishedAt:'',version:'0.2.8',simulation:false,
    answer:'42',checks:[],durationMs:1500,inputTokens:100,outputTokens:20,tokenSource:'reported',...partial};
}
const job:BenchJob={id:'job-12345678-aaaa',createdAt:'2026-10-03T20:00:00.000Z',updatedAt:'',status:'completed',requestCeiling:8,requestsAdmitted:8,totalAttempts:4,results:[],
  input:{suite:'C:/suites/starter',taskIds:['t1'],repeats:2,stopOnFailure:false,agents:{cli1:{provider:'codex',model:'gpt-x',auth:'provider-login'},cli2:{provider:'claude',model:'default',auth:'provider-login'}}}};

test('a report scores each agent with pass@k, lists every task and check, and carries no token or local path',()=>{
  const data=join(homedir(),'AgentVsAgent');
  const attempts=[
    attempt({id:'1',repeat:1,checks:[{index:0,kind:'equals',passed:true,detail:'Exact answer matched',durationMs:1}],rubric:{judge:{provider:'vercel',model:'judge-model',auth:'api'},score:7,reason:'Clear.'}}),
    attempt({id:'2',repeat:2,status:'fail',answer:'<script>alert(1)</script> token '+TOKEN,checks:[{index:0,kind:'run',passed:false,detail:`Error at ${join(data,'benchmarks','artifacts','x','tests','v.mjs')} in ${join(homedir(),'proj')} key vck_${'z'.repeat(24)}`,durationMs:5,backend:'container',image:DIGEST,exitCode:1}]}),
    attempt({id:'3',seat:'cli2',agent:{provider:'claude',model:'default',auth:'provider-login'},repeat:1,status:'fail',durationMs:3000,inputTokens:null}),
    attempt({id:'4',seat:'cli2',agent:{provider:'claude',model:'default',auth:'provider-login'},repeat:2,status:'fail',durationMs:3000,inputTokens:null}),
  ];
  for(const format of ['html','md'] as const){
    const report=suiteReport(job,attempts,format,data);
    assert.equal(report.filename,`ava-benchmark-starter-2026-10-03-job-1234.${format}`);
    // cli1 passed one of two repeats: pass@1 50%, pass@2 100%. cli2 passed none.
    assert.match(report.text,/1\/2/);assert.match(report.text,/@1 50%, @2 100%/);assert.match(report.text,/0\/2/);assert.match(report.text,/@1 0%, @2 0%/);
    assert.match(report.text,/Rubric \(judge\)/);assert.match(report.text,/7\.0\/10 \(1\)/);assert.match(report.text,/Rubric: 7\/10 from vercel · judge-model\. Clear\./);
    assert.match(report.text,/codex · gpt-x · low/);assert.match(report.text,/Task one/);assert.match(report.text,/AvA 0\.2\.8/);
    assert.ok(!report.text.includes(TOKEN)&&!report.text.includes('vck_z'),'tokens and keys are redacted');
    assert.ok(!report.text.includes(homedir())&&!report.text.includes(homedir().replaceAll('\\','/')),'no home or data path');
    assert.ok(report.text.includes(format==='html'?'&lt;data&gt;':'<data>')&&report.text.includes('~'),'paths are replaced, not dropped');
    assert.ok(!/#token=|room=/.test(report.text),'no room link');
    if(format==='html'){assert.ok(!report.text.includes('<script>alert'),'answers are escaped');assert.match(report.text,/&lt;script&gt;/);assert.ok(!/<script\b/.test(report.text),'the page has no scripts');assert.equal(report.mediaType,'text/html; charset=utf-8');}
    else assert.match(report.text,/^# Benchmark report: starter, 2026-10-03/);
  }
});

test('the service reports a finished job in both formats',async()=>{
  const data=tempDir('ava-bench-report-'),factory=new BenchmarkFactory(data);factory.wrongSeat='cli2';
  const service=new AvAService(data,factory,'simulation',{processes:async()=>[]});
  try{
    await service.call('bench.validate',{taskIds:['invoice-total']});
    const done=await finishJob(service,(await startJob(service,['invoice-total'],'report',2)).id);
    for(const format of ['html','md'] as const){
      const report=await service.call('bench.report',{jobId:done.id,format}) as {filename:string;text:string};
      assert.match(report.filename,new RegExp(`\\.${format}$`));assert.match(report.text,/Add invoice amounts/);assert.match(report.text,/2\/2/);assert.match(report.text,/0\/2/);
      assert.ok(!report.text.includes(data),'no data folder path');
    }
    await assert.rejects(service.call('bench.report',{jobId:done.id,format:'pdf'}));
  }finally{await service.shutdown();service.store.close();}
});
