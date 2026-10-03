import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,readFileSync,writeFileSync,cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { JEST_SHIM,importExercism,importJsonl,exerciseFolders } from '../src/bench-import.js';
import { loadSuite,loadTask } from '../src/bench-tasks.js';
import { validateTask } from '../src/bench-validation.js';
import { containerStatus } from '../src/containers.js';
import { tempDir } from './temp.js';

// An exercise laid out as Exercism's JavaScript track does.
function exercise(root:string,slug='two-fer'){
  const dir=join(root,slug);mkdirSync(join(dir,'.meta'),{recursive:true});mkdirSync(join(dir,'.docs'));
  writeFileSync(join(dir,'.meta','config.json'),JSON.stringify({blurb:'Two-fer.',files:{solution:[`${slug}.js`],test:[`${slug}.spec.js`],example:['.meta/proof.ci.js']}}));
  writeFileSync(join(dir,'.docs','instructions.md'),'# Instructions\n\nCreate a sentence of the form "One for X, one for me."\n');
  writeFileSync(join(dir,`${slug}.js`),"export const twoFer = () => {\n  throw new Error('Remove this statement and implement this function');\n};\n");
  writeFileSync(join(dir,`${slug}.spec.js`),`import { twoFer } from './${slug}';
describe('twoFer()', () => {
  test('no name given', () => { expect(twoFer()).toEqual('One for you, one for me.'); });
  xtest('a name given', () => { expect(twoFer('Alice')).toEqual('One for Alice, one for me.'); });
  xtest('not a stub', () => { expect(() => twoFer('Bob')).not.toThrow(); });
});\n`);
  writeFileSync(join(dir,'.meta','proof.ci.js'),"export const twoFer = (name = 'you') => `One for ${name}, one for me.`;\n");
  return dir;
}
// Assemble a checking folder the way validation does (fixture, then the candidate, then the hidden tests) and run it on the host.
function verify(task:string,candidate:'solution'|'stub'){
  const work=tempDir('ava-import-run-');cpSync(join(task,'fixture'),work,{recursive:true});
  if(candidate==='solution')cpSync(join(task,'solution'),work,{recursive:true});
  cpSync(join(task,'tests'),join(work,'tests'),{recursive:true});
  return spawnSync(process.execPath,['tests/verify.mjs'],{cwd:work,encoding:'utf8',windowsHide:true});
}

test('an Exercism exercise imports as a container task whose reference passes its Jest-style tests and whose stub fails',async()=>{
  const source=tempDir('ava-exercism-'),suite=tempDir('ava-imported-');exercise(source);exercise(source,'leap');
  assert.deepEqual(exerciseFolders(source).length,2);
  const id=importExercism(join(source,'two-fer'),suite);assert.equal(id,'exercism-two-fer');
  const task=loadTask(join(suite,id));
  assert.equal(task.spec.isolation,'container');assert.equal(task.spec.mode,'build');assert.match(task.spec.prompt,/Implement two-fer\.js[\s\S]*One for X, one for me/);
  assert.match(readFileSync(join(suite,id,'tests','two-fer.spec.mjs'),'utf8'),/from '\.\.\/two-fer\.js'/,'the spec imports the solution from the attempt folder');
  const passed=verify(join(suite,id),'solution');assert.equal(passed.status,0,passed.stdout+passed.stderr);assert.match(passed.stdout,/3\/3 tests passed/);
  const stub=verify(join(suite,id),'stub');assert.notEqual(stub.status,0);assert.match(stub.stdout,/FAIL twoFer\(\) > no name given/);
  assert.throws(()=>importExercism(join(source,'two-fer'),suite),/already exists/);
  // Validation runs inside Docker, where it's available.
  if((await containerStatus()).available){const receipt=await validateTask(task,tempDir('ava-import-data-'));assert.equal(receipt.validated,true,JSON.stringify(receipt.oracle));assert.equal(receipt.oracle.find(c=>c.kind==='run')!.backend,'container');}
});

test('the Jest shim compares like Jest and reports each failure',()=>{
  const dir=tempDir('ava-shim-');writeFileSync(join(dir,'jest-shim.mjs'),JEST_SHIM);
  const run=(body:string)=>{writeFileSync(join(dir,'spec.mjs'),`import {run} from './jest-shim.mjs';\n${body}\nawait run();`);return spawnSync(process.execPath,['spec.mjs'],{cwd:dir,encoding:'utf8',windowsHide:true});};
  const ok=run(`test('matchers',()=>{expect({a:1,b:undefined}).toEqual({a:1});expect([1,[2]]).toEqual([1,[2]]);expect('abc').toContain('b');expect([1,2]).toHaveLength(2);
    expect(0.1+0.2).toBeCloseTo(0.3);expect(()=>{throw new RangeError('bad input');}).toThrow(/bad/);expect(()=>{throw new RangeError('x');}).toThrow(RangeError);
    expect(1).not.toBe(2);expect(()=>1).not.toThrow();expect(null).toBeNull();expect(new Map([[1,2]])).toEqual(new Map([[1,2]]));});`);
  assert.equal(ok.status,0,ok.stdout+ok.stderr);
  const failing=run(`test('wrong',()=>{expect(2+2).toBe(5);});test('right',()=>{expect(1).toBe(1);});`);
  assert.equal(failing.status,1);assert.match(failing.stdout,/FAIL wrong: expected 4 to be 5/);assert.match(failing.stdout,/1\/2 tests passed/);
  assert.equal(run('').status,1,'a spec with no tests fails');
});

test('JSON Lines import: one container task per line, with every field required',()=>{
  const dir=tempDir('ava-jsonl-'),file=join(dir,'tasks.jsonl'),suite=tempDir('ava-jsonl-suite-');
  const row=(id:string)=>JSON.stringify({id,title:`Add ${id}`,prompt:'Export add(a, b) from add.js.',file:'add.js',solution:'export const add=(a,b)=>a+b;',tests:"import {add} from '../add.js';if(add(2,3)!==5)throw new Error('add failed');"});
  writeFileSync(file,[row('add-one'),'',row('add-two')].join('\n'));
  assert.deepEqual(importJsonl(file,suite),['add-one','add-two']);
  const tasks=loadSuite(suite);assert.equal(tasks.length,2);assert.ok(tasks.every(t=>t.spec.isolation==='container'));
  const passed=verify(join(suite,'add-one'),'solution');assert.equal(passed.status,0,passed.stderr);
  writeFileSync(file,'{"id":"x"}');assert.throws(()=>importJsonl(file,tempDir('ava-jsonl-bad-')),/Line 1 needs a "prompt" string/);
  writeFileSync(file,'not json');assert.throws(()=>importJsonl(file,tempDir('ava-jsonl-bad-')),/Line 1 isn't valid JSON/);
  writeFileSync(file,row('Bad_ID'));assert.throws(()=>importJsonl(file,tempDir('ava-jsonl-bad-')),/lowercase words/);
});
