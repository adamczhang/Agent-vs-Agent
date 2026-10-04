import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {findOnPath,launchOf,MINIMUM,versionAtLeast} from './clis.js';
import {gatewayKey,parseCredits} from './gateway.js';
import {cursorArgv,cursorTier} from './cursor.js';
import {writePrivateFile} from './private-files.js';
import type {Provider} from './types.js';
import type {NativeFactory} from './providers.js';

type CliProvider=Exclude<Provider,'vercel'>;
type Launch={command:string;args:string[]};
export type DiagnosticRun=(launch:Launch,args:string[],env:NodeJS.ProcessEnv)=>Promise<{ok:boolean;stdout:string;stderr:string}>;
export interface CliDiagnostic {provider:CliProvider;installed:boolean;version:string|null;minimum:string|null;compatible:boolean|null;auth:'signed_in'|'signed_out'|'api_key'|'unknown';message:string}
export interface GatewayDiagnostic {key:'none'|'environment'|'stored';status:'missing'|'ready'|'no_credit'|'invalid_key'|'unavailable';balance?:number}
export interface DataFolderDiagnostic {path:string;writable:boolean;secured:boolean|null;message:string}
export interface DoctorReport {modelRequests:0;clis:CliDiagnostic[];gateway:GatewayDiagnostic;dataFolder?:DataFolderDiagnostic}
export type Inspection=(provider:Provider)=>ReturnType<NativeFactory['inspect']>;
interface Options {env?:NodeJS.ProcessEnv;run?:DiagnosticRun;resolve?:(provider:CliProvider)=>Launch|undefined;fetcher?:typeof fetch}
const LABELS:Record<CliProvider,string>={codex:'Codex CLI',claude:'Claude Code','grok-build':'Grok Build',antigravity:'Antigravity',cursor:'Cursor Agent'};
const UPDATES:Partial<Record<CliProvider,string>>={codex:'npm install -g @openai/codex@latest',claude:'claude update'};
const API_ENV:Record<CliProvider,string[]>={codex:['CODEX_API_KEY','OPENAI_API_KEY'],claude:['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'],'grok-build':['XAI_API_KEY'],antigravity:['GOOGLE_API_KEY','GEMINI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GENAI_USE_VERTEXAI'],cursor:['CURSOR_API_KEY','CURSOR_AUTH_TOKEN']};
const run:DiagnosticRun=(launch,args,env)=>new Promise(resolve=>{
  execFile(launch.command,[...launch.args,...args],{env,windowsHide:true,timeout:20000,maxBuffer:1024*1024},(error,stdout,stderr)=>resolve({ok:!error,stdout:String(stdout??''),stderr:String(stderr??'')}));
});
function resolveCli(provider:CliProvider,inspect:Inspection,env:NodeJS.ProcessEnv):Launch|undefined{
  if(provider==='codex'||provider==='claude'){
    const found=findOnPath(provider,env);return found?launchOf(found,provider):undefined;
  }
  const entry=inspect(provider);
  if(entry?.launch.kind!=='installed')return undefined;
  // Cursor's shim is a .cmd that needs a shell; its bundled Node and entry file start without one.
  const argv=provider==='cursor'?cursorArgv(entry.launch.argv):entry.launch.argv,command=argv[0];
  if(!command||!isAbsolute(command))return undefined;
  // Registry entries point at the CLI with ACP subcommands. A Node entry needs its script prefix for --version.
  return {command,args:argv[1]&&/\.[cm]?js$/.test(argv[1])?[argv[1]]:[]};
}
export async function diagnoseCli(provider:CliProvider,inspect:Inspection,options:Options={},checkAuth=true):Promise<CliDiagnostic>{
  const env=options.env??process.env,execute=options.run??run;
  const minimum=provider==='codex'||provider==='claude'?MINIMUM[provider]:null;
  const base:CliDiagnostic={provider,installed:false,version:null,minimum,compatible:null,auth:'unknown',message:'Not installed or not on PATH.'};
  try{
    const launch=options.resolve?options.resolve(provider):resolveCli(provider,inspect,env);
    if(!launch)return base;
    base.installed=true;
    const result=await execute(launch,['--version'],env);
    base.version=result.ok?/\b\d+\.\d+\.\d+\b/.exec(result.stdout+'\n'+result.stderr)?.[0]??null:null;
    base.compatible=minimum&&base.version?versionAtLeast(base.version,minimum):null;
    base.message=!base.version?'Version unavailable.':base.compatible===false?`Update required: ${UPDATES[provider]}`:minimum?'Version meets the adapter minimum.':'The adapter declares no minimum version.';
    if(!checkAuth)return base;
    if(API_ENV[provider].some(key=>!!env[key])){base.auth='api_key';base.message+=' API credentials override the subscription route.';return base;}
    if(provider==='codex'){
      const auth=await execute(launch,['login','status'],env),text=auth.stdout+'\n'+auth.stderr;
      base.auth=auth.ok&&/logged in.*chatgpt/i.test(text)?'signed_in':/not logged in/i.test(text)?'signed_out':/api key/i.test(text)?'api_key':'unknown';
    }else if(provider==='claude'){
      const auth=await execute(launch,['auth','status','--json'],env);
      try{const data=JSON.parse(auth.stdout) as {loggedIn?:boolean;authMethod?:string};base.auth=data.loggedIn===false?'signed_out':data.loggedIn===true?(/api/i.test(data.authMethod??'')?'api_key':'signed_in'):'unknown';}catch{/* no documented result */}
    }
    else if(provider==='cursor'){
      const auth=await execute(launch,['status'],{...env,CURSOR_INVOKED_AS:'cursor-agent'}),text=auth.stdout+'\n'+auth.stderr;
      base.auth=/not logged in|not authenticated|log in to/i.test(text)?'signed_out':auth.ok&&/logged in as/i.test(text)?'signed_in':'unknown';
      // The plan decides whether agent requests are served: a Free plan's are refused.
      if(base.auth==='signed_in'){const about=await execute(launch,['about'],{...env,CURSOR_INVOKED_AS:'cursor-agent'}),tier=cursorTier(about.stdout);if(tier)base.message+=/^free$/i.test(tier)?` Plan: ${tier}; Cursor refuses agent requests on it.`:` Plan: ${tier}.`;}
    }
    // Grok and Antigravity don't expose a verified non-interactive login-status command here.
    return base;
  }catch{return {...base,message:'Could not inspect this CLI. Check its installation and PATH.'};}
}
export async function diagnoseGateway(dataRoot:string,fetcher:typeof fetch=fetch):Promise<GatewayDiagnostic>{
  const found=gatewayKey(dataRoot);if(!found)return {key:'none',status:'missing'};
  try{
    const response=await fetcher('https://ai-gateway.vercel.sh/v1/credits',{headers:{Authorization:`Bearer ${found.key}`},signal:AbortSignal.timeout(10000)});
    if(response.status===401||response.status===403)return {key:found.source,status:'invalid_key'};
    const credit=response.ok?parseCredits(await response.json()):undefined;
    return credit?{key:found.source,status:credit.balance>0?'ready':'no_credit',balance:credit.balance}:{key:found.source,status:'unavailable'};
  }catch{return {key:found.source,status:'unavailable'};}
}
// The data folder must take writes, and secrets written there must be restricted to this account (server.json and the
// Gateway key are). A throwaway file in a throwaway folder goes the same way a secret does, then both are removed.
export function checkDataFolder(dataRoot:string):DataFolderDiagnostic{
  const probe=join(dataRoot,`.doctor-${randomUUID()}`),reason=(error:unknown)=>error instanceof Error?error.message:String(error);
  try{
    try{mkdirSync(probe,{recursive:true});writeFileSync(join(probe,'write-check'),'');}
    catch(error){return {path:dataRoot,writable:false,secured:null,message:`Not writable: ${reason(error)}`};}
    try{writePrivateFile(join(probe,'secret-check','probe.json'),'{}',true);return {path:dataRoot,writable:true,secured:true,message:'Writable; secrets are restricted to your account.'};}
    catch(error){return {path:dataRoot,writable:true,secured:false,message:reason(error)};}
  }finally{try{rmSync(probe,{recursive:true,force:true});}catch{/* nothing was created */}}
}
export async function doctor(dataRoot:string,inspect:Inspection,options:Options={}):Promise<DoctorReport>{
  const [clis,gateway]=await Promise.all([Promise.all((['codex','claude','grok-build','antigravity','cursor'] as const).map(p=>diagnoseCli(p,inspect,options))),diagnoseGateway(dataRoot,options.fetcher)]);
  return {modelRequests:0,clis,gateway,dataFolder:checkDataFolder(dataRoot)};
}
export async function cliWarnings(inspect:Inspection):Promise<Partial<Record<Provider,string>>>{
  const rows=await Promise.all((['codex','claude'] as const).map(p=>diagnoseCli(p,inspect,{},false)));
  return Object.fromEntries(rows.filter(r=>!r.installed||r.compatible!==true).map(r=>[r.provider,r.message]));
}
export function formatDoctor(report:DoctorReport){
  const auth={signed_in:'signed in',signed_out:'not signed in',api_key:'API credentials (subscription login expected)',unknown:'sign-in not checked'};
  return ['Agent vs Agent diagnostics (0 model requests)',...report.clis.map(c=>`${LABELS[c.provider]}: ${c.installed?c.version??'installed; version unknown':'missing'}${c.minimum?` (minimum ${c.minimum})`:''}; ${auth[c.auth]}. ${c.message}`),
    `Vercel AI Gateway: key ${report.gateway.key}; ${report.gateway.status.replaceAll('_',' ')}${report.gateway.balance!==undefined?`; credit $${report.gateway.balance.toFixed(2)}`:''}. Requires Codex CLI.`,
    ...report.dataFolder?[`Data folder ${report.dataFolder.path}: ${report.dataFolder.message}`]:[],
    'Sign-in status does not verify model access. Activation performs that check.'].join('\n');
}
// /ava doctor when the service itself can't start: the reason, and the data folder check, which needs no service.
export function formatServiceDown(reason:string,folder:DataFolderDiagnostic){
  return ['Agent vs Agent diagnostics (0 model requests)',`AvA service: not running. ${reason}`,`Data folder ${folder.path}: ${folder.message}`,
    'CLI and Gateway checks run in the service, so they appear once it starts. Fix the cause above, then run /ava doctor again.'].join('\n');
}
