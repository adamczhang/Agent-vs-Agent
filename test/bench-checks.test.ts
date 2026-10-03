import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,readFileSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { checkTask,verifierEnvironment } from '../src/bench-checks.js';
import { loadTask,type BenchCheck,type BenchTask } from '../src/bench-tasks.js';
import { validateTask,validated,validationPath } from '../src/bench-validation.js';
import { tempDir } from './temp.js';

function task(checks:BenchCheck[]):BenchTask{return {spec:{id:'checks',version:1,mode:'prompt',prompt:'Answer',time_limit_minutes:1,checks},directory:'',digest:'test-only',files:[]};}
const check=async(rule:BenchCheck,answer:string)=> (await checkTask(task([rule]),answer,tempDir('ava-answer-check-')))[0]!;
test('numeric checks enforce tolerance and reject empty, non-numeric and non-finite answers',async()=>{
  assert.equal((await check({number:{value:3,tolerance:.01}},'3.005')).passed,true);
  for(const answer of ['','three','3 dollars','NaN','Infinity','3.1'])assert.equal((await check({number:{value:3,tolerance:.01}},answer)).passed,false);
  assert.equal((await check({number:{value:300,tolerance:0}},'3e2')).passed,true);
});
test('JSON checks compare typed values at safe object and array paths',async()=>{
  assert.equal((await check({json_path:{path:'$.items[1].total',equals:42}},'{"items":[{}, {"total":42}]}')).passed,true);
  for(const answer of ['not json','{"items":[{}, {"total":"42"}]}','{"items":[]}'])assert.equal((await check({json_path:{path:'$.items[1].total',equals:42}},answer)).passed,false);
  assert.equal((await check({json_path:{path:'$.constructor',equals:'inherited'}},'{}')).passed,false);
  assert.equal((await check({json_path:{path:'$',equals:{a:1,b:2}}},'{"b":2,"a":1}')).passed,true);
});
test('regex checks run outside the service thread, with flags and a bounded deadline',async()=>{
  assert.equal((await check({regex:'^hello$',flags:'i'},'HELLO')).passed,true);
  assert.equal((await check({regex:'^hello$'},'hello extra')).passed,false);
  let ticks=0;const timer=setInterval(()=>ticks++,10),at=Date.now();
  try{const result=await check({regex:'^(a+)+$',timeout_ms:300},'a'.repeat(100000)+'!');assert.equal(result.passed,false);assert.match(result.detail,/timed out/);assert.ok(ticks>0);assert.ok(Date.now()-at<5000);}finally{clearInterval(timer);}
});
test('a verifier records exit status, has no provider environment, and stops on timeout or excessive output',async()=>{
  const root=tempDir('ava-verifier-');mkdirSync(join(root,'tests'));
  const run=async(code:string,timeout=1000)=>{writeFileSync(join(root,'tests','check.mjs'),code);return (await checkTask(task([{run:'node tests/check.mjs',timeout_ms:timeout}]),'',root))[0]!;};
  const previous=process.env.AVA_BENCH_CANARY;process.env.AVA_BENCH_CANARY='not_a_real_key';
  try{
    assert.equal(verifierEnvironment().AVA_BENCH_CANARY,undefined);
    const ok=await run("if(process.env.AVA_BENCH_CANARY||process.env.OPENAI_API_KEY||process.env.ANTHROPIC_API_KEY||process.env.AI_GATEWAY_API_KEY||process.env.NODE_OPTIONS)process.exit(1);console.log('clean');");
    assert.equal(ok.passed,true);assert.equal(ok.exitCode,0);assert.match(ok.detail,/clean/);
    const bad=await run('process.exit(7)');assert.equal(bad.passed,false);assert.equal(bad.exitCode,7);
    const timeout=await run('setInterval(()=>{},1000)',150);assert.equal(timeout.passed,false);assert.match(timeout.detail,/timed out/);
    const noisy=await run("process.stdout.write('X'.repeat(1000000));setInterval(()=>{},1000)");assert.equal(noisy.passed,false);assert.match(noisy.detail,/output limit/);assert.ok(noisy.detail.length<8001);
  }finally{if(previous===undefined)delete process.env.AVA_BENCH_CANARY;else process.env.AVA_BENCH_CANARY=previous;}
});
test('checks reject linked parent folders and support cancellation without starting verifier work',async()=>{
  const root=tempDir('ava-check-link-'),outside=tempDir('ava-check-outside-');writeFileSync(join(outside,'check.mjs'),"throw new Error('should not run')");
  symlinkSync(outside,join(root,'tests'),process.platform==='win32'?'junction':'dir');
  const result=await checkTask(task([{file_exists:'tests/check.mjs'},{run:'node tests/check.mjs'}]),'',root);assert.ok(result.every(c=>!c.passed&&/link/.test(c.detail)));
  const abort=new AbortController();abort.abort();const cancelled=await checkTask(task([{run:'node tests/check.mjs'}]),'',root,abort.signal);assert.equal(cancelled[0]!.detail,'Check cancelled');
});
test('validation receipts from another checker version cannot authorize a run',async()=>{
  const root=tempDir('ava-check-proof-'),data=tempDir('ava-check-proof-data-');mkdirSync(join(root,'solution'));
  writeFileSync(join(root,'task.yaml'),'id: proof\nversion: 1\nmode: prompt\nprompt: Answer 42\nchecks:\n  - number: { value: 42, tolerance: 0 }\n');writeFileSync(join(root,'solution','answer.txt'),'42');
  const loaded=loadTask(root);assert.equal((await validateTask(loaded,data)).validated,true);
  const file=validationPath(data,loaded),receipt=JSON.parse(readFileSync(file,'utf8'));receipt.checkerVersion=0;writeFileSync(file,JSON.stringify(receipt));assert.equal(validated(data,loaded),null);
});
