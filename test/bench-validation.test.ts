import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,writeFileSync,symlinkSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { loadSuite,loadTask } from '../src/bench-tasks.js';
import { validated,validateTask } from '../src/bench-validation.js';
import { tempDir } from './temp.js';

function task(manifest:string,answer='42'){
  const root=tempDir('ava-bench-task-');mkdirSync(join(root,'solution'));
  writeFileSync(join(root,'task.yaml'),manifest);writeFileSync(join(root,'solution','answer.txt'),answer);return root;
}
const manifest='id: example\nversion: 1\nmode: prompt\nprompt: Return 42\nchecks:\n  - equals: "42"\n';
test('every starter task accepts its reference and rejects a do-nothing attempt',{timeout:120000},async()=>{
  assert.ok(loadSuite(resolve('benchmarks/starter')).length>=20,'about twenty starter tasks');
  const tasks=loadSuite(resolve('benchmarks/starter')),data=tempDir('ava-bench-proofs-');
  assert.deepEqual(new Set(tasks.map(t=>t.spec.mode)),new Set(['prompt','build','review']));
  for(const t of tasks){const proof=await validateTask(t,data);assert.equal(proof.validated,true,t.spec.id);assert.ok(proof.oracle.every(c=>c.passed));assert.ok(proof.empty.some(c=>!c.passed));assert.equal(validated(data,t)?.digest,t.digest);}
});
test('a changed prompt, verifier or reference invalidates the prior validation receipt',async()=>{
  const root=task(manifest),data=tempDir('ava-bench-proof-');const before=loadTask(root);await validateTask(before,data);
  writeFileSync(join(root,'solution','answer.txt'),'43');const changed=loadTask(root);
  assert.notEqual(changed.digest,before.digest);assert.equal(validated(data,changed),null);assert.equal((await validateTask(changed,data)).validated,false);
});
test('a task whose empty attempt passes is refused even if its oracle passes',async()=>{
  const root=task(manifest.replace('equals: "42"','equals: ""'),''),result=await validateTask(loadTask(root),tempDir('ava-bench-trivial-'));
  assert.equal(result.validated,false);assert.ok(result.empty.every(c=>c.passed));
});
test('invalid schemas, missing verifiers, duplicate IDs and escaping check paths are refused',()=>{
  assert.throws(()=>loadTask(task(manifest.replace('mode: prompt','mode: unknown'))));
  assert.throws(()=>loadTask(task(manifest.replace('mode: prompt','mode: build').replace('equals: "42"','run: node tests/missing.mjs'))),/Missing verifier/);
  assert.throws(()=>loadTask(task(manifest.replace('mode: prompt','mode: build').replace('equals: "42"','file_exists: ../outside'))));
  const suite=tempDir('ava-bench-duplicate-');for(const name of ['one','two']){mkdirSync(join(suite,name,'solution'),{recursive:true});writeFileSync(join(suite,name,'task.yaml'),manifest);writeFileSync(join(suite,name,'solution','answer.txt'),'42');}
  assert.throws(()=>loadSuite(suite),/unique/);
});
test('linked fixture directories cannot expose files outside a task bundle',()=>{
  const root=task(manifest),outside=tempDir('ava-bench-outside-');writeFileSync(join(outside,'private.txt'),'not a task file');
  symlinkSync(outside,join(root,'fixture'),process.platform==='win32'?'junction':'dir');assert.throws(()=>loadTask(root),/must not be links/);
});
