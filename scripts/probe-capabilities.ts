// What each provider's ACP agent declares at startup: image/audio/embedded-context input, session load/resume, and the
// session config options it offers. Opens a session per provider and reads ACPX's session record. No prompt is sent.
// Usage: node --import tsx scripts/probe-capabilities.ts [--out <results.json>]
import {mkdirSync,mkdtempSync,readdirSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {NativeFactory,loadProviderSetups} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {PROVIDERS,type Provider} from '../src/types.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const root=mkdtempSync(join(tmpdir(),'ava-capabilities-')),factory=new NativeFactory(root,loadProviderSetups(installedDataRoot(resolve('.'))));
const walk=(dir:string):string[]=>{try{return readdirSync(dir).flatMap(n=>{const p=join(dir,n);return statSync(p).isDirectory()?walk(p):[p];});}catch{return [];}};
const result:Record<string,unknown>={recordedAt:new Date().toISOString()};
// The subscription CLIs (provider-login); the Gateway has its own probe (probe-vercel.ts).
for(const provider of (option('--only')?[option('--only') as Provider]:PROVIDERS.filter(p=>p!=='vercel'))){
  try{
    const p=await factory.open({provider,model:'',auth:'provider-login'},{pairId:'caps',seat:'cli1',generation:PROVIDERS.indexOf(provider)+1},AbortSignal.timeout(180_000));
    // ACPX writes the session record in snake_case.
    const records=walk(join(root,'acpx','caps','cli1',String(PROVIDERS.indexOf(provider)+1))).filter(f=>f.endsWith('.json')).map(f=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return null;}}).filter(r=>r?.agent_capabilities);
    const record=records[0]??{},status=await p.runtime.getStatus({handle:p.handle});
    result[provider]={agentCapabilities:record.agent_capabilities??null,protocolVersion:record.protocol_version??null,imageInputSeenByAvA:p.imageInput,webSetAtLaunch:p.launchedWithInternet!==undefined,currentModel:status.models?.currentModelId??null,
      configOptions:((status.details?.configOptions??[]) as Array<{id:string;name?:string;category?:string;currentValue?:unknown;options?:Array<{value?:string;name?:string}>}>).map(o=>({id:o.id,name:o.name,category:o.category,current:o.currentValue,...(o.category==='model'?{}:{values:(o.options??[]).map(v=>v.value??v.name)})})),
      commands:(status.availableCommands??[]).map(c=>c.name).slice(0,40)};
    await p.close();
  }catch(error){result[provider]={error:error instanceof Error?error.message:String(error)};}
  console.log(provider,JSON.stringify(result[provider],null,1).slice(0,2500));
}
const out=option('--out');if(out){mkdirSync(dirname(resolve(out)),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2));}
process.exit(0);
