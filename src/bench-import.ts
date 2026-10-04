import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { AvAError } from './types.js';

// Importers for common benchmark formats (roadmap B8). Each writes AvA task folders (task.yaml, fixture/, tests/,
// solution/) into a suite folder. Imported tasks come from outside, so they're marked `isolation: container`: their
// verifiers run in Docker (src/containers.ts), never on the host. Validate them before running, as any task.
//   - Exercism JavaScript exercises: .meta/config.json names the solution, test and reference files; the instructions
//     are in .docs/. Jest-style tests run through a small built-in shim, so no test framework is installed.
//   - JSON Lines, "prompt plus tests": one task per line, {id, title?, prompt, file, solution, tests}, where tests is an
//     ES module that imports the solution file from '../<file>' and throws (or exits non-zero) on failure.
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, FILE = /^[A-Za-z0-9_-]+\.m?js$/;
const MODULE = '{"name":"benchmark-task","private":true,"type":"module"}\n';
const put = (root: string, path: string, text: string) => { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text.endsWith('\n') ? text : text + '\n'); };
export interface ImportedTask { id: string; title: string; prompt: string; file: string; stub?: string; solution: string; tests: Record<string, string>; minutes?: number; timeoutMs?: number }
// Every task is checked (its id and file, no repeats, nothing already in the suite) before any is written, so an import
// that fails leaves the suite as it was, and the same command can run again once the source is fixed.
export function writeTasks(suite: string, tasks: ImportedTask[]) {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (!ID.test(task.id) || task.id.length > 80) throw new AvAError('BENCH_IMPORT', `Task id "${task.id}" must be lowercase words joined by hyphens.`);
    if (!FILE.test(task.file)) throw new AvAError('BENCH_IMPORT', `${task.id}: the solution file must be a .js or .mjs file name.`);
    if (seen.has(task.id)) throw new AvAError('BENCH_IMPORT', `${task.id} appears more than once. Each task needs its own id.`);
    seen.add(task.id);
    if (existsSync(join(suite, task.id))) throw new AvAError('BENCH_IMPORT', `${task.id} already exists in ${suite}. Choose a new suite folder.`);
  }
  return tasks.map(task => writeTask(suite, task));
}
function writeTask(suite: string, task: ImportedTask) {
  const root = join(suite, task.id);
  const spec = { id: task.id, version: 1, title: task.title.slice(0, 160), mode: 'build', time_limit_minutes: task.minutes ?? 10, isolation: 'container',
    prompt: task.prompt.slice(0, 16000), checks: [{ file_exists: task.file }, { run: 'node tests/verify.mjs', timeout_ms: task.timeoutMs ?? 20000 }] };
  put(root, 'task.yaml', stringify(spec, { lineWidth: 0 }));
  put(root, 'fixture/package.json', MODULE);
  if (task.stub !== undefined) put(root, `fixture/${task.file}`, task.stub);
  put(root, `solution/${task.file}`, task.solution);
  for (const [name, text] of Object.entries(task.tests)) put(root, `tests/${name}`, text);
  return task.id;
}

// Jest-style globals for imported tests: describe, test/it and their x-variants (run like the others), the usual
// matchers, and a runner that reports each test and exits non-zero on any failure (or none).
export const JEST_SHIM = `// Jest-style globals for imported tests (AvA). No dependencies.
const tests=[],prefix=[],before=[],after=[];
const fmt=v=>{try{return typeof v==='string'?JSON.stringify(v):typeof v==='function'?'[function]':JSON.stringify(v)??String(v);}catch{return String(v);}};
function equals(a,b){
  if(Object.is(a,b))return true;
  if(typeof a!=='object'||typeof b!=='object'||!a||!b)return false;
  if(Array.isArray(a)!==Array.isArray(b))return false;
  if(a instanceof Map&&b instanceof Map)return a.size===b.size&&[...a].every(([k,v])=>b.has(k)&&equals(v,b.get(k)));
  if(a instanceof Set&&b instanceof Set)return a.size===b.size&&[...a].every(v=>b.has(v));
  if(a instanceof Date&&b instanceof Date)return a.getTime()===b.getTime();
  const keys=o=>Object.keys(o).filter(k=>o[k]!==undefined),ka=keys(a),kb=keys(b);
  return ka.length===kb.length&&ka.every(k=>Object.prototype.hasOwnProperty.call(b,k)&&equals(a[k],b[k]));
}
globalThis.describe=globalThis.xdescribe=(name,fn)=>{prefix.push(name);try{fn();}finally{prefix.pop();}};
globalThis.test=globalThis.it=globalThis.xtest=globalThis.xit=(name,fn)=>{tests.push({name:[...prefix,name].join(' > '),fn});};
globalThis.beforeEach=fn=>before.push(fn);globalThis.afterEach=fn=>after.push(fn);
globalThis.expect=actual=>{
  const make=negate=>{
    const check=(pass,what)=>{if(pass===negate)throw new Error('expected '+fmt(actual)+(negate?' not ':' ')+what);};
    const thrown=()=>{if(typeof actual!=='function')throw new Error('expect(...).toThrow needs a function');try{actual();}catch(error){return {error};}return null;};
    return {
      toBe:e=>check(Object.is(actual,e),'to be '+fmt(e)),toEqual:e=>check(equals(actual,e),'to equal '+fmt(e)),toStrictEqual:e=>check(equals(actual,e),'to equal '+fmt(e)),
      toBeTruthy:()=>check(!!actual,'to be truthy'),toBeFalsy:()=>check(!actual,'to be falsy'),toBeNull:()=>check(actual===null,'to be null'),
      toBeUndefined:()=>check(actual===undefined,'to be undefined'),toBeDefined:()=>check(actual!==undefined,'to be defined'),toBeNaN:()=>check(Number.isNaN(actual),'to be NaN'),
      toContain:e=>check(actual!=null&&actual.includes(e),'to contain '+fmt(e)),toHaveLength:n=>check(actual!=null&&actual.length===n,'to have length '+n),
      toMatch:e=>check(typeof actual==='string'&&(e instanceof RegExp?e.test(actual):actual.includes(e)),'to match '+e),
      toBeCloseTo:(e,digits=2)=>check(Math.abs(actual-e)<10**-digits/2,'to be close to '+e),
      toBeGreaterThan:e=>check(actual>e,'to be greater than '+e),toBeGreaterThanOrEqual:e=>check(actual>=e,'to be at least '+e),
      toBeLessThan:e=>check(actual<e,'to be less than '+e),toBeLessThanOrEqual:e=>check(actual<=e,'to be at most '+e),
      toBeInstanceOf:e=>check(actual instanceof e,'to be an instance of '+(e&&e.name)),
      toThrow:e=>{const r=thrown();const matches=!!r&&(e===undefined||(typeof e==='string'?String(r.error&&r.error.message).includes(e):e instanceof RegExp?e.test(String(r.error&&r.error.message)):typeof e==='function'?r.error instanceof e:equals(r.error&&r.error.message,e&&e.message)));if(matches===negate)throw new Error('expected the function'+(negate?' not':'')+' to throw'+(e===undefined?'':' '+fmt(e&&e.message||e))+(r?', it threw '+fmt(r.error&&r.error.message):', it did not throw'));},
    };
  };
  const m=make(false);m.not=make(true);m.toThrowError=m.toThrow;m.not.toThrowError=m.not.toThrow;return m;
};
export async function run(){
  let failed=0;
  for(const t of tests){try{for(const f of before)await f();await t.fn();for(const f of after)await f();console.log('ok   '+t.name);}catch(error){failed++;console.log('FAIL '+t.name+': '+(error&&error.message));}}
  console.log((tests.length-failed)+'/'+tests.length+' tests passed');
  if(failed||!tests.length)process.exit(1);
}
`;
// Exercism's tests import the solution without an extension ('./two-fer'); in AvA they run from tests/, against ../.
const rewriteImports = (source: string, files: string[]) => source
  .replace(/^\s*import\s+[^;]*from\s+['"]@jest\/globals['"];?\s*$/gm, '')
  .replace(/(from\s+|import\s*\(\s*)(['"])\.\/([\w./-]+?)(\.m?js)?\2/g, (all, lead: string, quote: string, path: string) => {
    const file = files.find(f => f.replace(/\.m?js$/, '') === path) ?? `${path}.js`;
    return `${lead}${quote}../${file}${quote}`;
  });

export function importExercism(exercise: string, suite: string) { return writeTasks(suite, [readExercism(exercise)])[0]!; }
// One Exercism exercise as an AvA task (nothing written).
export function readExercism(exercise: string): ImportedTask {
  const dir = resolve(exercise), slug = basename(dir), configFile = join(dir, '.meta', 'config.json');
  if (!existsSync(configFile)) throw new AvAError('BENCH_IMPORT', `${dir} has no .meta/config.json; it isn't an Exercism exercise.`);
  const config = JSON.parse(readFileSync(configFile, 'utf8')) as { blurb?: string; files?: { solution?: string[]; test?: string[]; example?: string[] } };
  const solution = config.files?.solution ?? [], test = config.files?.test ?? [], example = config.files?.example ?? [];
  if (solution.length !== 1 || example.length !== 1 || !test.length) throw new AvAError('BENCH_IMPORT', `${slug}: AvA imports exercises with one solution file, one example (reference) file and test files.`);
  const file = basename(solution[0]!), read = (path: string) => readFileSync(join(dir, path), 'utf8');
  const docs = ['.docs/introduction.md', '.docs/instructions.md', '.docs/instructions.append.md'].filter(p => existsSync(join(dir, p))).map(read).join('\n\n').trim();
  const tests: Record<string, string> = { 'jest-shim.mjs': JEST_SHIM };
  const specs = test.map(path => { const name = basename(path).replace(/\.m?js$/, '') + '.mjs'; tests[name] = rewriteImports(read(path), [file]); return name; });
  tests['verify.mjs'] = `import { run } from './jest-shim.mjs';\n${specs.map(s => `await import('./${s}');`).join('\n')}\nawait run();\n`;
  const title = slug.split(/[-_\s]+/).filter(Boolean).map(w => w[0]!.toUpperCase() + w.slice(1)).join(' ') || slug;
  const prompt = `Implement ${file}, an ES module, so that it solves this exercise. Keep its existing exports. Use no dependencies.\n\n${docs || config.blurb || title}`;
  return { id: `exercism-${slug}`.slice(0, 80), title: `Exercism: ${title}`, prompt, file, stub: read(solution[0]!), solution: read(example[0]!), tests };
}

export function importJsonl(source: string, suite: string) {
  const tasks: ImportedTask[] = [];
  for (const [index, line] of readFileSync(resolve(source), 'utf8').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let row: { id?: unknown; title?: unknown; prompt?: unknown; file?: unknown; solution?: unknown; tests?: unknown };
    try { row = JSON.parse(line); } catch { throw new AvAError('BENCH_IMPORT', `Line ${index + 1} isn't valid JSON.`); }
    for (const key of ['id', 'prompt', 'file', 'solution', 'tests'] as const) if (typeof row[key] !== 'string' || !(row[key] as string).trim()) throw new AvAError('BENCH_IMPORT', `Line ${index + 1} needs a "${key}" string.`);
    tasks.push({ id: row.id as string, title: typeof row.title === 'string' ? row.title : row.id as string, prompt: row.prompt as string, file: row.file as string, solution: row.solution as string, tests: { 'verify.mjs': row.tests as string } });
  }
  if (!tasks.length) throw new AvAError('BENCH_IMPORT', 'No tasks found.');
  return writeTasks(suite, tasks);
}
// Every Exercism exercise folder directly inside a folder (such as a track's exercises/practice).
export function exerciseFolders(root: string) { return readdirSync(resolve(root), { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(resolve(root), e.name, '.meta', 'config.json'))).map(e => join(resolve(root), e.name)); }
