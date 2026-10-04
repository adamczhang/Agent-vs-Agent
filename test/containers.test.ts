import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { VERIFIER_IMAGE,containerArgs,containerStatus,imageRef } from '../src/containers.js';
import { checkTask,containerBackend } from '../src/bench-checks.js';
import { loadTask,type BenchCheck,type BenchTask } from '../src/bench-tasks.js';
import { validateTask } from '../src/bench-validation.js';
import { AvAService } from '../src/service.js';
import { BenchmarkFactory,agents } from './bench-fakes.js';
import { tempDir } from './temp.js';

const task=(checks:BenchCheck[]):BenchTask=>({spec:{id:'boxed',version:1,mode:'build',prompt:'Build',time_limit_minutes:1,checks,isolation:'container'},directory:'',digest:'test-only',files:[]});
// Replaces the Docker access for one test, and restores it.
async function withDocker(fake:Partial<typeof containerBackend>,body:()=>Promise<void>){
  const saved={...containerBackend};Object.assign(containerBackend,fake);
  try{await body();}finally{Object.assign(containerBackend,saved);}
}

test('the verifier container has no network, a read-only root, no privileges, limits, a non-root user and a read-only attempt',()=>{
  const args=containerArgs('C:\\attempt folder','tests/verify.mjs','ava-verify-x');
  const flag=(name:string)=>args[args.indexOf(name)+1];
  assert.equal(flag('--network'),'none');assert.ok(args.includes('--read-only'));assert.equal(flag('--tmpfs'),'/tmp:rw,size=64m');
  assert.equal(flag('--cap-drop'),'ALL');assert.equal(flag('--security-opt'),'no-new-privileges');assert.equal(flag('--user'),'node');
  assert.equal(flag('--pids-limit'),'128');assert.equal(flag('--memory'),'512m');assert.equal(flag('--memory-swap'),'512m');assert.equal(flag('--cpus'),'1');
  assert.equal(flag('--mount'),'type=bind,"source=C:\\attempt folder",target=/work,readonly');assert.equal(flag('--workdir'),'/work');
  // Docker reads --mount as comma-separated fields: a folder name with a comma stays one quoted field.
  const comma=containerArgs('D:\\Work, Inc\\attempt','tests/verify.mjs','x');
  assert.equal(comma[comma.indexOf('--mount')+1],'type=bind,"source=D:\\Work, Inc\\attempt",target=/work,readonly');
  assert.ok(args.includes(imageRef())&&imageRef().endsWith(VERIFIER_IMAGE.digest),'the image is pinned by digest');
  assert.deepEqual(args.slice(-3),['node','--max-old-space-size=256','tests/verify.mjs']);
  assert.ok(!args.some(a=>/privileged|^--net(work)?=host$|^--pid(=.*)?$|^--ipc|^-v$|^--volume/.test(a)),'no privileged mode, host namespaces or extra volumes');
});

test('a container task runs its verifier through Docker and records the backend; without Docker it fails and never runs on the host',async()=>{
  const root=tempDir('ava-boxed-');mkdirSync(join(root,'tests'));writeFileSync(join(root,'tests','verify.mjs'),"require('node:fs').writeFileSync('host-ran','x')");
  const calls:string[][]=[];
  await withDocker({status:async()=>({available:true,image:VERIFIER_IMAGE.digest}),run:async(args)=>{calls.push(args);return {exitCode:0,output:'checked in a container',timedOut:false};}},async()=>{
    const [result]=await checkTask(task([{run:'node tests/verify.mjs'}]),'',root);
    assert.deepEqual([result!.passed,result!.backend,result!.image,result!.detail],[true,'container',VERIFIER_IMAGE.digest,'checked in a container']);
    assert.equal(calls.length,1);assert.equal(calls[0]![0],'run');assert.ok(calls[0]!.includes(`type=bind,"source=${root}",target=/work,readonly`));
  });
  await withDocker({status:async()=>({available:false,reason:'Docker is not running.'}),run:async()=>{throw new Error('must not run');}},async()=>{
    const [result]=await checkTask(task([{run:'node tests/verify.mjs'}]),'',root);
    assert.equal(result!.passed,false);assert.equal(result!.backend,'container');assert.match(result!.detail,/^Container isolation unavailable: Docker is not running\./);
  });
  assert.throws(()=>readFileSync(join(root,'host-ran')),'the verifier never ran on the host');
});

test('Docker\'s engine type is read from its stdout alone: a warning on stderr doesn\'t hide a Linux engine',async()=>{
  const fake=(info:{output:string;stdout?:string}):Parameters<typeof containerStatus>[0]=>async args=>args[0]==='info'?{exitCode:0,timedOut:false,...info}:{exitCode:0,output:'sha256:x',stdout:'sha256:x',timedOut:false};
  assert.deepEqual(await containerStatus(fake({output:'WARNING: Plugin \"C:\\\\x\\\\docker-foo.exe\" is not valid\nlinux',stdout:'linux\n'})),{available:true,image:VERIFIER_IMAGE.digest});
  assert.match((await containerStatus(fake({output:'windows',stdout:'windows\n'}))).reason!,/Windows containers/);
});

test('a container task is refused before any agent starts when Docker is unavailable, and the catalog says why',async()=>{
  const suite=tempDir('ava-boxed-suite-'),bundle=join(suite,'tip-calculator-boxed');cpSync(resolve('benchmarks/starter/tip-calculator'),bundle,{recursive:true});
  writeFileSync(join(bundle,'task.yaml'),readFileSync(join(bundle,'task.yaml'),'utf8').replace('id: tip-calculator','id: tip-calculator-boxed')+'isolation: container\n');
  const data=tempDir('ava-boxed-data-'),factory=new BenchmarkFactory(data),service=new AvAService(data,factory,'live',{processes:async()=>[]});
  try{
    await withDocker({status:async()=>({available:false,reason:'Docker is not running.'}),run:async()=>{throw new Error('must not run');}},async()=>{
      await assert.rejects(service.call('bench.start',{taskIds:['tip-calculator-boxed'],suite,agents,requestId:'boxed'}),/tip-calculator-boxed: needs container isolation\. Docker is not running\./);
      assert.equal(factory.agents.length,0,'no agent started');assert.equal(service.benchmarks.jobs().length,0);
      const entry=(service.call('bench.catalog',{suite}) as unknown as Promise<{tasks:Array<{id:string;blockedReason:string;isolation:string|null}>}>);
      const boxed=(await entry).tasks.find(t=>t.id==='tip-calculator-boxed')!;
      assert.deepEqual([boxed.isolation,boxed.blockedReason],['container','Needs container isolation. Docker is not running.']);
    });
  }finally{await service.shutdown();service.store.close();}
});

// The real engine, where Docker's Linux engine and the pinned image are present (not on CI's Windows runners).
test('in a real container: a verifier passes; the network, writing the attempt and starting a second process are refused; validation records the backend',{timeout:180000},async()=>{
  const status=await containerStatus();
  if(!status.available){assert.ok(status.reason);return;}
  const root=tempDir('ava-docker-');mkdirSync(join(root,'tests'));writeFileSync(join(root,'candidate.mjs'),'export const answer=42;');
  const run=async(code:string)=>{writeFileSync(join(root,'tests','check.mjs'),code);return (await checkTask(task([{run:'node tests/check.mjs',timeout_ms:20000}]),'',root))[0]!;};
  const ok=await run("import {answer} from '../candidate.mjs';import {writeFileSync} from 'node:fs';if(answer!==42)process.exit(1);writeFileSync('/tmp/scratch','ok');console.log('passed inside');");
  assert.equal(ok.passed,true,ok.detail);assert.equal(ok.backend,'container');assert.match(ok.detail,/passed inside/);
  const offline=await run("try{await fetch('https://example.com');console.log('reached');}catch(e){console.log('blocked',e.cause?.code??e.message);process.exit(3);}");
  assert.equal(offline.passed,false);assert.match(offline.detail,/blocked/);
  const readOnly=await run("import {writeFileSync} from 'node:fs';writeFileSync('planted.txt','x');");
  assert.equal(readOnly.passed,false);assert.match(readOnly.detail,/EROFS|read-only/i);
  const forks=await run("import {spawnSync} from 'node:child_process';const r=spawnSync('sh',['-c',':(){ :|:& };:'],{timeout:3000});console.log('done',r.status);");
  assert.ok(forks.durationMs<60000,'a fork bomb is held by the process limit and the timeout');
  // A container copy of the tip calculator validates inside Docker, and its receipt names the backend and image.
  const bundle=tempDir('ava-docker-task-');cpSync(resolve('benchmarks/starter/tip-calculator'),bundle,{recursive:true});
  writeFileSync(join(bundle,'task.yaml'),readFileSync(join(bundle,'task.yaml'),'utf8').replace('id: tip-calculator','id: tip-calculator-boxed')+'isolation: container\n');
  const receipt=await validateTask(loadTask(bundle),tempDir('ava-docker-data-'));
  assert.equal(receipt.validated,true,JSON.stringify(receipt.oracle));
  const verifier=receipt.oracle.find(c=>c.kind==='run')!;assert.deepEqual([verifier.backend,verifier.image],['container',VERIFIER_IMAGE.digest]);
});
