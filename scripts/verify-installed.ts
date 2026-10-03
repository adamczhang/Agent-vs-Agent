// Read-only: checks that the plugins installed in Claude Code and Codex match this checkout's build in
// release/marketplace, file for file (path and SHA-256). Run it after installing or updating them. Nothing is changed.
// Usage: node --import tsx scripts/verify-installed.ts [--out <evidence.json>]
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,relative,resolve} from 'node:path';

const args=process.argv.slice(2),out=args.includes('--out')?args[args.indexOf('--out')+1]:undefined;
const release=resolve('release','marketplace','plugins');
// Each host keeps an installed plugin under <its home>/plugins/cache/<marketplace>/<plugin>/<version>.
const hosts=[
  {host:'Claude Code',build:join(release,'agent-vs-agent-claude'),cache:join(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),'plugins','cache','ava','agent-vs-agent')},
  {host:'Codex',build:join(release,'agent-vs-agent'),cache:join(process.env.CODEX_HOME||join(homedir(),'.codex'),'plugins','cache','ava','agent-vs-agent')},
];
const files=(root:string,dir=root):string[]=>readdirSync(dir,{withFileTypes:true})
  .flatMap(e=>e.isDirectory()?files(root,join(dir,e.name)):e.isFile()?[relative(root,join(dir,e.name)).replaceAll('\\','/')]:[]);
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');

const results=hosts.map(({host,build,cache})=>{
  if(!existsSync(join(build,'package.json')))return {host,status:'no build',detail:`Run npm run package first (${build}).`};
  const version=(JSON.parse(readFileSync(join(build,'package.json'),'utf8')) as {version:string}).version,installed=join(cache,version);
  if(!existsSync(installed))return {host,status:'not installed',version,detail:`No installed ${version} at ${installed}.`};
  const built=new Set(files(build)),copied=new Set(files(installed));
  const missing=[...built].filter(f=>!copied.has(f)),extra=[...copied].filter(f=>!built.has(f));
  const different=[...built].filter(f=>copied.has(f)&&digest(join(build,f))!==digest(join(installed,f)));
  const status=missing.length+extra.length+different.length?'differs':'matches';
  return {host,status,version,installed,files:built.size,missing:missing.slice(0,20),extra:extra.slice(0,20),different:different.slice(0,20)};
});
for(const r of results)console.log(`${r.status==='matches'?'PASS':'FAIL'} ${r.host}: ${r.status}${'version' in r?` (${r.version}${'files' in r?`, ${r.files} files`:''})`:''}${'detail' in r?`. ${r.detail}`:''}`);
const status=results.every(r=>r.status==='matches')?'passed':'failed';
if(out){mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify({status,recordedAt:new Date().toISOString(),results},null,2));}
console.log(JSON.stringify({status,hosts:results.length}));if(status!=='passed')process.exitCode=1;
