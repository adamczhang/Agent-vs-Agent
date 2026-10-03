// Upkeep report (roadmap H6): what can be updated, and whether an update would change what AvA requires of the user.
// Without --live it sends no model request, only npm registry lookups:
//   - npm outdated;
//   - the agent adapters' latest releases, and the CLI minimums those releases would require (MINIMUM in src/clis.ts follows
//     the installed adapters; raise it only when an adapter does);
//   - the installed CLIs, against the minimums and the newest Codex and Claude Code.
// --live adds one activation per provider, in a temporary data folder: 5 short model requests, the Gateway's on its
// stored key at a small credit cost. Each agent is stopped after its check, so Resources' activation limit never
// applies. The batch stops at the first failed activation.
// Usage: node --import tsx scripts/upkeep.ts [--live [--providers codex,claude,...]] [--out <report.json>]
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {MINIMUM} from '../src/clis.js';
import {diagnoseCli} from '../src/doctor.js';
import {NativeFactory,loadProviderSetups} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {AvAService} from '../src/service.js';
import {LIVE_CONFIGS} from './live-configs.js';
import type {Pair,Provider} from '../src/types.js';

const args=process.argv.slice(2),live=args.includes('--live');
const out=resolve(args.includes('--out')?args[args.indexOf('--out')+1]!:join('test-results','upkeep',`upkeep-${new Date().toISOString().slice(0,10)}.json`));
// npm is a .cmd on Windows, which needs a shell, so the command line is built here. Every word is a package name, a
// version range from the registry, or a flag; one with anything else (a ^ in ^0.3.286 is cmd.exe's escape) is quoted.
const windows=process.platform==='win32';
const npm=(...words:string[])=>(windows
  ?spawnSync(['npm.cmd',...words.map(w=>/^[\w@./:=-]+$/.test(w)?w:`"${w.replaceAll('"','')}"`)].join(' '),{encoding:'utf8',windowsHide:true,shell:true})
  :spawnSync('npm',words,{encoding:'utf8'})).stdout.trim();
const npmJson=<T>(...words:string[]):T|undefined=>{try{return JSON.parse(npm(...words)) as T;}catch{return undefined;}};
const bare=(range:string|undefined)=>range?.replace(/^[\^~>=\s]+/,'');
const pkg=JSON.parse(readFileSync('package.json','utf8')) as {dependencies:Record<string,string>};

// 1. Packages with newer releases.
const outdated=npmJson<Record<string,{current:string;wanted:string;latest:string}>>('outdated','--json')??{};

// 2. The adapters, and what their latest releases would require of the installed CLIs.
const ADAPTERS=['acpx','@agentclientprotocol/codex-acp','@agentclientprotocol/claude-agent-acp'];
const adapters=ADAPTERS.map(name=>({name,pinned:pkg.dependencies[name],latest:npm('view',name,'version')}));
const codexAcp=adapters[1]!.latest,claudeAcp=adapters[2]!.latest;
const codexNeeds=bare(npmJson<Record<string,string>>('view',`@agentclientprotocol/codex-acp@${codexAcp}`,'dependencies','--json')?.['@openai/codex']);
const sdkRange=npmJson<Record<string,string>>('view',`@agentclientprotocol/claude-agent-acp@${claudeAcp}`,'dependencies','--json')?.['@anthropic-ai/claude-agent-sdk'];
const sdkVersions=sdkRange?npmJson<string|string[]>('view',`@anthropic-ai/claude-agent-sdk@${sdkRange}`,'version','--json'):undefined;
const sdk=Array.isArray(sdkVersions)?sdkVersions.at(-1):sdkVersions;
const claudeNeeds=sdk?npm('view',`@anthropic-ai/claude-agent-sdk@${sdk}`,'claudeCodeVersion'):undefined;
const minimums={codex:{current:MINIMUM.codex,withLatestAdapter:codexNeeds??null},claude:{current:MINIMUM.claude,withLatestAdapter:claudeNeeds||null}};

// 3. The installed CLIs (version only; no sign-in check and no model request).
const shared=installedDataRoot(resolve('.'));
const setupRoot=mkdtempSync(join(tmpdir(),'ava-upkeep-'));
if(existsSync(join(shared,'providers.json')))copyFileSync(join(shared,'providers.json'),join(setupRoot,'providers.json'));
const factory=new NativeFactory(setupRoot,loadProviderSetups(setupRoot));
const newest={codex:npm('view','@openai/codex','version'),claude:npm('view','@anthropic-ai/claude-code','version')};
const clis=await Promise.all((['codex','claude','grok-build','antigravity'] as const).map(async provider=>{
  const found=await diagnoseCli(provider,p=>factory.inspect(p),{},false);
  return {provider,installed:found.installed,version:found.version,minimum:found.minimum,meetsMinimum:found.compatible,newest:provider==='codex'||provider==='claude'?newest[provider]:null};
}));

console.log('Packages with newer releases:');
for(const [name,v] of Object.entries(outdated))console.log(`  ${name}: ${v.current} -> ${v.latest}${v.wanted!==v.current?` (wanted ${v.wanted})`:''}`);
if(!Object.keys(outdated).length)console.log('  none');
console.log('Agent adapters:');
for(const a of adapters)console.log(`  ${a.name}: ${a.pinned}${a.latest&&a.latest!==a.pinned?` -> ${a.latest} available`:' (latest)'}`);
for(const [cli,m] of Object.entries(minimums))console.log(`  ${cli} minimum: ${m.current}${m.withLatestAdapter&&m.withLatestAdapter!==m.current?`; the latest adapter would require ${m.withLatestAdapter}`:' (unchanged by the latest adapter)'}`);
console.log('Installed CLIs:');
for(const c of clis)console.log(`  ${c.provider}: ${c.installed?c.version??'version unknown':'not installed'}${c.minimum?`, minimum ${c.minimum}${c.meetsMinimum===false?' (UPDATE REQUIRED)':''}`:''}${c.newest&&c.version&&c.newest!==c.version?`; ${c.newest} available`:''}`);

// 4. Optional: one activation per provider.
const activations:Array<{provider:Provider;model:string;status:'passed'|'failed'|'not run';seconds?:number;evidence?:string;error?:string}>=[];
if(live){
  const picked=args.includes('--providers')?args[args.indexOf('--providers')+1]!.split(','):undefined;
  const order=(['codex','claude','grok-build','antigravity','vercel'] as Provider[]).filter(p=>!picked||picked.includes(p));
  console.log(`Live: one activation per provider. Request ceiling: ${order.length} model requests (${order.join(', ')}). Stops at the first failure.`);
  const root=mkdtempSync(join(tmpdir(),'ava-upkeep-live-'));
  if(existsSync(join(shared,'providers.json')))copyFileSync(join(shared,'providers.json'),join(root,'providers.json'));
  // The Gateway agent reads the key stored in the shared folder; it never enters this process's environment.
  process.env.AVA_GATEWAY_KEY_DIR??=shared;
  const service=new AvAService(root,new NativeFactory(root,loadProviderSetups(root)),'live');
  let stopped=false;
  try{
    for(const provider of order){
      const config=LIVE_CONFIGS[provider];
      if(stopped){activations.push({provider,model:config.model,status:'not run'});continue;}
      const started=Date.now();
      try{
        const pair=await service.call('pair.create',{thread:`upkeep-${provider}`}) as Pair;
        await service.call('slot.configure',{pairId:pair.id,seat:'cli1',config});
        const {evidence}=await service.call('slot.activate',{pairId:pair.id,seat:'cli1'}) as {evidence:string};
        activations.push({provider,model:config.model,status:'passed',seconds:Math.round((Date.now()-started)/100)/10,evidence:String(evidence).slice(0,300)});
        // Stop all: the checked agent stops (no model request), so the next one has room under the activation limit.
        await service.call('resources.stop',{requestId:randomUUID()});
      }catch(error){
        activations.push({provider,model:config.model,status:'failed',seconds:Math.round((Date.now()-started)/100)/10,error:(error instanceof Error?error.message:String(error)).replace(/\b[a-f0-9]{64}\b/g,'<redacted>').slice(0,500)});
        stopped=true;
      }
      const last=activations.at(-1)!;console.log(`  ${last.status==='passed'?'PASS':'FAIL'} ${provider} (${last.model}): ${last.seconds}s${last.error?` — ${last.error}`:''}`);
    }
  }finally{await service.shutdown();service.store.close();}
}

const status=clis.every(c=>c.meetsMinimum!==false)&&activations.every(a=>a.status==='passed')?'passed':'attention';
const report={status,recordedAt:new Date().toISOString(),outdated,adapters,minimums,clis,activations};
mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(report,null,2));
console.log(JSON.stringify({status,report:out}));
process.exit(status==='passed'?0:1);
