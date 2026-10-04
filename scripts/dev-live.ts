// A real room for checking the UI against live agents: real service, real providers (provider-login), temporary data.
// Activates the two agents (one access check each) and writes the room URL (it carries the bearer token) to
// <data>/dev-url.txt; it is never printed. Usage: node --import tsx scripts/dev-live.ts --cli1 claude --cli2 grok-build [--port 5198]
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AvAService} from '../src/service.js';
import {listen} from '../src/http.js';
import {NativeFactory,loadProviderSetups} from '../src/providers.js';
import {installedDataRoot} from '../src/paths.js';
import {SEATS,type Pair,type Provider,type ProviderConfig} from '../src/types.js';

const args=process.argv.slice(2),option=(n:string)=>{const i=args.indexOf(n);return i>=0?args[i+1]:undefined;};
const MODELS:Record<Provider,Omit<ProviderConfig,'provider'|'auth'>>={codex:{model:'gpt-6-astra',effort:{key:'reasoning_effort',value:'low'}},claude:{model:'default',effort:{key:'effort',value:'low'}},'grok-build':{model:'grok-4.7'},antigravity:{model:'gemini-3.7-flash-high'},cursor:{model:'composer-2.5[fast=true]'},
  vercel:{model:option('--vercel-model')??'openai/gpt-5.6-luna',effort:{key:'model_reasoning_effort',value:'low'}}};
const dataRoot=resolve(option('--data')??mkdtempSync(join(tmpdir(),'ava-live-'))),shared=installedDataRoot(resolve('.'));mkdirSync(dataRoot,{recursive:true});
if(existsSync(join(shared,'providers.json'))&&!existsSync(join(dataRoot,'providers.json')))copyFileSync(join(shared,'providers.json'),join(dataRoot,'providers.json'));
// A Vercel AI Gateway agent uses the key stored in the shared folder (read from there; it never enters this process's
// environment, which every agent inherits).
process.env.AVA_GATEWAY_KEY_DIR??=shared;
const service=new AvAService(dataRoot,new NativeFactory(dataRoot,loadProviderSetups(dataRoot)),'live');
let pair=await service.call('pair.create',{thread:'dev-live'}) as Pair;
const chosen={cli1:(option('--cli1')??'claude') as Provider,cli2:(option('--cli2')??'codex') as Provider};
for(const seat of SEATS){await service.call('slot.configure',{pairId:pair.id,seat,config:{provider:chosen[seat],...MODELS[chosen[seat]],auth:chosen[seat]==='vercel'?'api':'provider-login'}});await service.call('slot.activate',{pairId:pair.id,seat});}
pair=await service.call('pair.get',{pairId:pair.id}) as Pair;
const prepared=await service.call('room.prepare',{pairId:pair.id}) as {ticket?:string;roomId?:string};
const room=prepared.roomId?prepared:await service.call('room.open',{ticket:prepared.ticket}) as {roomId:string};
const http=await listen(service,resolve('dist','web'),Number(option('--port')??0));
writeFileSync(join(dataRoot,'dev-url.txt'),`http://127.0.0.1:${http.port}/#token=${http.token}&room=${room.roomId}`,{mode:0o600});
console.log(JSON.stringify({status:'listening',mode:'live',port:http.port,dataRoot,agents:chosen}));
const stop=()=>{void http.close().finally(()=>{service.store.close();process.exit(0);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
