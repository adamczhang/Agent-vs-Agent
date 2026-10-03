import { createAcpRuntime, createAgentRegistry, createFileSessionStore, type AcpxRuntime, type AcpRuntimeHandle, type AcpRuntimeSessionUsage, type AcpRuntimeUsageBreakdown } from 'acpx/runtime';
import { existsSync, mkdirSync, readFileSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { isInside, participantWorkspace } from './workspace.js';
import { GATEWAY, gatewayKey, gatewayModels } from './gateway.js';
import { installedCli, type InstalledCli } from './clis.js';
import { createHash, randomUUID } from 'node:crypto';
import { CODEX_ISOLATION_FLAGS, codexMcpNames, disabledMcpNames } from './isolation.js';
import { doctor,cliWarnings } from './doctor.js';
import { AvAError, PROVIDERS, type AgentRequest, type AgentResult, type AgentUsage, type Provider, type ProviderConfig, type Seat } from './types.js';
import type { ConfiguredParticipant, ParticipantFactory } from './activation.js';
import type { ProcessLedger } from './census.js';

export interface ConfigOption { id: string; name: string; currentValue: string; options: Array<{ value: string; name: string }> }
export interface Catalog { provider: Provider; currentModel: string; models: Array<{ id: string; name: string }>; controls: ConfigOption[] }
export interface ProviderSetup { argv?: string[]; env?: Record<string,string> }
const API_VARIABLES:Record<Provider,string[]>={
  codex:['CODEX_API_KEY','OPENAI_API_KEY'],claude:['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN'],
  'grok-build':['XAI_API_KEY'],antigravity:['GOOGLE_API_KEY','GEMINI_API_KEY','GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_GENAI_USE_VERTEXAI'],vercel:['AI_GATEWAY_API_KEY'],
};
// Seen live with Gateway models: "Warning: Model metadata for `x` not found. Defaulting to fallback metadata; …".
const CODEX_NOTICE=/^\s*Warning: Model metadata for `[^`]+` not found/;
// Providers run by the Codex agent: Codex itself, and the Vercel AI Gateway (Codex pointed at the Gateway).
const CODEX_HARNESS=new Set<Provider>(['codex','vercel']);
const adapterOf=(provider:Provider):Provider=>provider==='vercel'?'codex':provider;
function flatOptions(value:unknown):Array<{value:string;name:string}>{
  if(!Array.isArray(value))return [];
  return value.flatMap(v=>{if(!v||typeof v!=='object')return [];const r=v as Record<string,unknown>;if(Array.isArray(r.options))return flatOptions(r.options);return typeof r.value==='string'?[{value:r.value,name:typeof r.name==='string'?r.name:r.value}]:[];});
}
function controls(value:unknown):ConfigOption[]{
  if(!Array.isArray(value))return [];
  return value.flatMap(v=>{if(!v||typeof v!=='object')return [];const r=v as Record<string,unknown>;return typeof r.id==='string'?[{id:r.id,name:String(r.name??r.id),currentValue:String(r.currentValue??''),options:flatOptions(r.options)}]:[];});
}
export class NativeFactory implements ParticipantFactory {
  ledger?:ProcessLedger;
  constructor(readonly dataRoot:string,private setups:Partial<Record<Provider,ProviderSetup>>={}){}
  inspect(provider:Provider){
    const setup=this.setups[provider];
    const registry=createAgentRegistry(setup?.argv?{overrides:{[provider]:setup.argv}}:undefined);
    return registry.inspect(provider);
  }
  list(){return PROVIDERS.map(provider=>({provider,inspection:this.inspect(adapterOf(provider))}));}
  doctor(){return doctor(this.dataRoot,p=>this.inspect(p));}
  cliWarnings(){return cliWarnings(p=>this.inspect(p));}
  private argv(provider:Provider){
    const inspected=this.inspect(adapterOf(provider));
    if(!inspected||inspected.launch.kind!=='installed')throw new AvAError('MISSING_PROVIDER',`${provider}: install the required CLI/ACP adapter first.`);
    const argv=inspected.launch.argv;
    if(!argv[0]||!isAbsolute(argv[0])||!existsSync(argv[0])||/^(npx|npm|pnpm|yarn|uvx)(\.|$)/i.test(basename(argv[0])))throw new AvAError('UNSAFE_LAUNCH','Only inspected installed executables may be launched.');
    return argv;
  }
  private auth(config:ProviderConfig){
    // The Gateway has only API access: an AI Gateway key (from the environment, or AvA's own) is the route.
    if(config.provider==='vercel'){
      if(config.auth!=='api')throw new AvAError('AUTH_ROUTE','The Vercel AI Gateway uses an API key; choose the API route.');
      if(!gatewayKey(this.dataRoot))throw new AvAError('MISSING_API_AUTH','The Vercel AI Gateway needs a key. Create one in this agent’s menu (Gateway key), or set AI_GATEWAY_API_KEY.');
      return 'AI Gateway API key route (Vercel); model access verified by a live response.';
    }
    const present=API_VARIABLES[config.provider].filter(k=>process.env[k]);
    if(config.auth==='provider-login'&&present.length)throw new AvAError('AUTH_ROUTE_CONFLICT',`API credentials are present (${present.join(', ')}). Choose the API route or use a separate login environment; no fallback occurred.`);
    if(config.auth==='api'&&!present.length)throw new AvAError('MISSING_API_AUTH','No API credential is configured for the selected provider.');
    return config.auth==='api'?'API route selected; model access verified by a live response.':'Provider-managed login selected; no API credential environment override. Billing tier is not asserted.';
  }
  // options.internet: the agent's live internet switch. options.resumeSessionId: reopen this native session in a new
  // process (used to apply launch-time settings, such as Codex's web search, without losing the conversation).
  async open(config:ProviderConfig,scope:{pairId:string;seat:Seat;generation:number},signal:AbortSignal,options:ParticipantOptions={}):Promise<NativeParticipant>{
    const evidence=this.auth(config),internet=options.internet??(()=>false),launchedWithInternet=internet();
    // Grok Build searches and fetches the web without asking permission, so its web tools are removed at launch
    // (--disable-web-search, a global flag that goes before the subcommand) while the switch is off.
    const inspected=this.argv(config.provider),argv=config.provider==='grok-build'&&!launchedWithInternet?[inspected[0]!,'--disable-web-search',...inspected.slice(1)]:inspected;
    // Codex (and the Gateway, which runs on it) and Claude Code run as the user's installed CLI, at the version the adapter needs.
    const cli=CODEX_HARNESS.has(config.provider)?await installedCli('codex'):config.provider==='claude'?await installedCli('claude'):undefined;
    const cwd=participantWorkspace(this.dataRoot,scope);mkdirSync(cwd,{recursive:true});
    const mcpNames=CODEX_HARNESS.has(config.provider)?await codexMcpNames(cli!,cwd,{...process.env,...this.setups[config.provider]?.env},signal):[];
    // A Gateway model's catalog entry: its context window goes to Codex (which has no metadata for it) and its vision tag
    // says whether it takes images.
    const listed=config.provider==='vercel'?(await gatewayModels(this.dataRoot).catch(()=>[])).find(m=>m.id===config.model):undefined;
    const stateDir=join(this.dataRoot,'acpx',scope.pairId,scope.seat,String(scope.generation));
    const processes=new Set<number>(),ledger=this.ledger;
    // A spawn that cannot be recorded must not run unrecorded (recovery would miss it): the error propagates and ACPX
    // stops the child. A failed exit record is harmless (the census then checks a process that is already gone).
    const record=(write:()=>void)=>{try{write();}catch{}};
    const runtime=createAcpRuntime({cwd,sessionStore:createFileSessionStore({stateDir}),agentRegistry:createAgentRegistry({overrides:{[config.provider]:argv}}),
      permissionMode:'deny-all',nonInteractivePermissions:'deny',fs:false,terminal:false,timeoutMs:60_000,
      agentProcessEnv:participantEnvironment(config.provider,this.setups[config.provider]?.env,this.dataRoot,launchedWithInternet,
        config.provider==='vercel'?{model:config.model,effort:config.effort?.value,key:gatewayKey(this.dataRoot)!.key,...(listed?.context?{context:listed.context}:{})}:undefined,cli,mcpNames),
      processLifecycle:{onBeforeSpawn(){signal.throwIfAborted();},onSpawned(event){processes.add(event.pid);ledger?.spawned({pid:event.pid,...scope});signal.throwIfAborted();},onExit(event){processes.delete(event.pid);record(()=>ledger?.exited(event.pid));}},
    });
    let handle:AcpRuntimeHandle|undefined;
    const cancel=()=>{void runtime.shutdown().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
    try{
      signal.throwIfAborted();
      // A resume gets its own session record, so the process it replaces keeps running until the resume is proven.
      const sessionKey=`ava-${scope.pairId}-${scope.seat}-${scope.generation}`+(options.resumeSessionId?`-resume-${randomUUID()}`:'');
      handle=await runtime.ensureSession({sessionKey,agent:config.provider,mode:'persistent',cwd,...(options.resumeSessionId?{resumeSessionId:options.resumeSessionId}:{})});
      signal.throwIfAborted();
      let status=await runtime.getStatus({handle,signal});
      const model=config.model||status.models?.currentModelId;
      if(!model)throw new AvAError('NO_MODEL','The provider did not report a current model.');
      // A Gateway agent gets its model and effort when it starts (they aren't in Codex's own model list).
      const fixedAtLaunch=config.provider==='vercel';
      if(config.model&&!fixedAtLaunch){await runtime.setModel({handle,model,signal,assertActive:()=>signal.throwIfAborted()});status=await runtime.getStatus({handle,signal});}
      const current=String(status.models?.currentModelId??'');
      if(fixedAtLaunch?!(current===model||current.startsWith(`${model}/`)):current!==model)throw new AvAError('CONFIG_REJECTED','The provider did not accept the selected model.');
      for(const selected of fixedAtLaunch?[]:[config.effort,config.speed]){
        if(!selected)continue;
        const option=controls(status.details?.configOptions).find(c=>c.id===selected.key);
        if(!option||!option.options.some(v=>v.value===selected.value))throw new AvAError('UNSUPPORTED_SETTING',`${selected.key}=${selected.value} is not advertised for this model.`);
        const response=await runtime.setConfigOption({handle,key:selected.key,value:selected.value,signal,assertActive:()=>signal.throwIfAborted()});
        if(!controls(response.configOptions).some(c=>c.id===selected.key&&c.currentValue===selected.value))throw new AvAError('CONFIG_REJECTED',`The provider did not accept ${selected.key}.`);
        status=await runtime.getStatus({handle,signal});
      }
      signal.throwIfAborted();
      // Images: what the agent declared, or for a Gateway model whether the model itself takes images.
      const images=fixedAtLaunch?listed?.tags.includes('vision')===true:imageInput(stateDir,sessionKey);
      const participant=new NativeParticipant(runtime,handle,{...config,model},cli?`${evidence} Installed ${cli.name} ${cli.version}.`:evidence,()=>processes.size>0,internet,LAUNCH_TIME_WEB.has(config.provider)?launchedWithInternet:undefined,
        images,options.workspace??(()=>undefined),cwd,options.bypass??(()=>false));
      participant.noteSessionUsage(status.usage);
      signal.removeEventListener('abort',cancel);return participant;
    }catch(error){signal.removeEventListener('abort',cancel);await runtime.shutdown().catch(()=>{});throw error;}
  }
  async discover(provider:Provider,signal:AbortSignal,model='',auth:ProviderConfig['auth']='provider-login'):Promise<Catalog>{
    // The Gateway's models come from its public list; nothing needs to start.
    if(provider==='vercel')return {provider,currentModel:model,models:(await gatewayModels(this.dataRoot)).map(m=>({id:m.id,name:m.name})),controls:[]};
    const participant=await this.open({provider,model,auth},{pairId:'discovery-'+randomUUID(),seat:'cli1',generation:Date.now()},signal);
    try{return await participant.catalog();}finally{await participant.close();}
  }
}
// gateway: for a Vercel AI Gateway agent, its model, effort and key (all fixed when it starts). cli: the installed CLI the
// agent runs (Codex for Codex and the Gateway, Claude Code for Claude), from installedCli.
export function participantEnvironment(provider:Provider,configured:Record<string,string>={},dataRoot?:string,internet=false,gateway?:{model:string;effort?:string;key:string;context?:number},cli?:Pick<InstalledCli,'command'|'args'|'path'>,discoveredMcp:string[]=[]){
  // Agents inherit the service's environment; the Gateway key goes only to a Gateway agent (set below), never another.
  const env:Record<string,string>={...configured,AVA_PARTICIPANT:'1',AI_GATEWAY_API_KEY:''};
  if(CODEX_HARNESS.has(provider)){
    const inherited=JSON.parse(configured.CODEX_CONFIG??process.env.CODEX_CONFIG??'{}') as Record<string,unknown>;
    const names=disabledMcpNames(discoveredMcp);
    // Drop session-supplied servers, then disable disk servers with leaf overrides. A new table containing only
    // enabled:false lacks a transport and is invalid, even when disabled (especially for plugin-owned servers).
    for(const key of Object.keys(inherited))if(key==='mcp_servers'||key.startsWith('mcp_servers.'))delete inherited[key];
    for(const name of names)inherited[`mcp_servers.${name}.enabled`]=false;
    // Codex's web search runs inside Codex with no per-call approval, so it is set when the process starts:
    // "live" with the agent's internet switch on, "disabled" with it off. Commands in a Build session (workspace-write)
    // may reach the network on the same switch, to clone a repository or install packages.
    // A Gateway agent is Codex with Vercel's provider settings (as `vercel ai-gateway setup` writes them for Codex) and
    // the chosen model; OpenAI's built-in web search isn't offered through it, so its internet switch governs commands.
    const vercel=provider==='vercel'&&gateway?{model_provider:'vercel',model:gateway.model,...(gateway.effort?{model_reasoning_effort:gateway.effort}:{}),...(gateway.context?{model_context_window:gateway.context}:{}),
      model_providers:{...(inherited.model_providers as Record<string,unknown>??{}),vercel:{name:'Vercel AI Gateway',base_url:GATEWAY.codexBaseUrl,env_key:'AI_GATEWAY_API_KEY',wire_api:'responses'}}}:{};
    env.CODEX_CONFIG=JSON.stringify({...inherited,...vercel,web_search:internet&&provider==='codex'?'live':'disabled',sandbox_workspace_write:{...(inherited.sandbox_workspace_write as Record<string,unknown>??{}),network_access:internet},features:{...(inherited.features as Record<string,unknown>??{}),plugins:false,apps:false,remote_plugin:false,hooks:false},'features.plugins':false,'features.apps':false,'features.remote_plugin':false,'features.hooks':false});
    if(provider==='vercel'&&gateway){env.MODEL_PROVIDER='vercel';env.AI_GATEWAY_API_KEY=gateway.key;}
    env.INITIAL_AGENT_MODE='read-only';
    if(dataRoot){
      // Session flags arrive after app-server startup. Disable integrations on
      // the child process itself so it cannot boot the parent plugin first.
      if(!cli)throw new AvAError('MISSING_PROVIDER','Codex isn’t installed.');
      const dir=join(dataRoot,'wrappers');mkdirSync(dir,{recursive:true});
      const signature=createHash('sha256').update(JSON.stringify([cli,names])).digest('hex').slice(0,16);
      const wrapper=join(dir,`codex-child-${signature}.${process.platform==='win32'?'cmd':'sh'}`);
      const flags=CODEX_ISOLATION_FLAGS.join(' ')+names.map(name=>` -c mcp_servers.${name}.enabled=false`).join('');
      const quote=(s:string)=>'"'+s.replaceAll('%','%%')+'"';
      const shellQuote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
      const source=process.platform==='win32'?`@echo off\r\nsetlocal DisableDelayedExpansion\r\n${[cli.command,...cli.args].map(quote).join(' ')} ${flags} %*\r\n`:`#!/bin/sh\nexec ${[cli.command,...cli.args].map(shellQuote).join(' ')} ${flags} "$@"\n`;
      if(!existsSync(wrapper)||readFileSync(wrapper,'utf8')!==source)writeFileSync(wrapper,source,{mode:0o700});
      env.CODEX_PATH=wrapper;
    }
  }
  // Claude Code's adapter starts the CLI it is given (a native binary, or a .js entry with Node).
  if(provider==='claude'&&cli){
    if(!dataRoot)env.CLAUDE_CODE_EXECUTABLE=cli.path;
    else{
      const dir=join(dataRoot,'wrappers');mkdirSync(dir,{recursive:true});
      const signature=createHash('sha256').update(JSON.stringify(cli)).digest('hex').slice(0,16);
      const wrapper=join(dir,`claude-child-${signature}.mjs`);
      // The SDK launches .mjs entries with Node. Keep stdio and exit status intact and use no shell.
      // Strict MCP config keeps the adapter's own in-process MCP tools but excludes the user's servers.
      const source=`import {spawn} from 'node:child_process';\nconst child=spawn(${JSON.stringify(cli.command)},[...${JSON.stringify(cli.args)},'--strict-mcp-config',...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});\nchild.on('error',()=>{process.stderr.write('Claude Code failed to start.\\n');process.exitCode=1;});\nchild.on('exit',(code)=>{process.exitCode=code??1;});\nfor(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));\n`;
      if(!existsSync(wrapper)||readFileSync(wrapper,'utf8')!==source)writeFileSync(wrapper,source,{mode:0o700});
      env.CLAUDE_CODE_EXECUTABLE=wrapper;
    }
  }
  return env;
}
// workspace: while a Build run is active for this agent, the folder it may work in (its workspace, which holds its copy).
// bypass: the agent's permissions are set to bypass, so every tool request is approved (web tools still follow internet).
export interface ParticipantOptions {internet?:()=>boolean;resumeSessionId?:string;workspace?:()=>string|undefined;bypass?:()=>boolean}
// Build runs, policy "auto-approve everything in the copy": any tool request whose paths all lie inside the agent's
// workspace is allowed, as are commands (they run there). A path outside it, or a request to leave the sandbox, is not.
// Web tools stay with the internet switch.
// Paths are found by key name (the CLIs' own names for them) and, under any key, by looking like an absolute path, at
// any depth and in arrays: an unfamiliar shape can't hide a path. Command text is left alone (a command names programs
// and arguments, not the paths it touches; commands run in the workspace).
const PATH_KEYS=new Set(['path','paths','file_path','filePath','file','files','notebook_path','cwd','workdir','directory','dir','target','source','destination','old_path','new_path','uri','url']);
const COMMAND_KEYS=new Set(['command','cmd','commandLine','script','args','argv']);
const ABSOLUTE=/^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/;
// A CLI's own settings inside the workspace would change its permissions from its next start (Claude Code reads
// .claude/settings*.json from its working folder), so an agent may not write there.
const AGENT_SETTINGS=/(^|[\\/])\.(claude|codex|gemini|grok)([\\/]|$)/i;
// A request to leave the sandbox (Codex: sandbox_permissions "require_escalated", with_escalated_permissions true) is
// found by its setting's name, never by file content that happens to contain such a word.
const ESCALATION_KEY=/escalat|sandbox_permissions|danger/i,ESCALATION_VALUE=/^(require_escalated|danger-full-access)$/i;
export function buildPermission(request:{raw:{toolCall?:{locations?:Array<{path?:string}>|null;rawInput?:unknown;title?:string|null}}},root:string){
  const call=request.raw.toolCall,raw=call?.rawInput,paths=[...(call?.locations??[]).map(l=>l.path)];
  let escalates=false;
  const visit=(v:unknown,depth=0)=>{
    if(!v||typeof v!=='object'||depth>8)return;
    for(const [k,x] of Object.entries(v as Record<string,unknown>)){
      if(ESCALATION_KEY.test(k)&&!!x&&x!=='use_default'||typeof x==='string'&&ESCALATION_VALUE.test(x))escalates=true;
      if(COMMAND_KEYS.has(k))continue;
      if(typeof x==='string'){if(PATH_KEYS.has(k)||ABSOLUTE.test(x))paths.push(x);}
      else visit(x,depth+1);
    }
  };
  visit(raw);
  if(escalates)return {decision:undefined,reason:'asks to leave its sandbox'};
  const norm=(p:string)=>process.platform==='win32'?p.toLowerCase():p,base=resolve(root),resolved=paths.filter((p):p is string=>!!p&&!/^[a-z][a-z0-9+.-]*:\/\//i.test(p)).map(p=>resolve(base,p));
  const outside=resolved.find(p=>!isInside(norm(p),norm(base)));
  if(outside)return {decision:undefined,reason:`outside its copy (${outside})`};
  const settings=resolved.find(p=>AGENT_SETTINGS.test(relative(base,p)));
  return settings?{decision:undefined,reason:`a CLI's own settings folder (${settings})`}:{decision:{outcome:'allow_once' as const},reason:''};
}
// Claude Code also obeys the user's own permission settings: allow rules or a permissive default mode approve a tool
// before AvA's gate is asked, and ACPX offers no way to switch those settings off for one session. The agent's screen
// says so once, rather than the gate appearing to be in charge.
function claudeSettingsNotice(){
  const dir=process.env.CLAUDE_CONFIG_DIR??join(homedir(),'.claude'),found:string[]=[];
  for(const name of ['settings.json','settings.local.json']){
    try{
      const settings=JSON.parse(readFileSync(join(dir,name),'utf8')) as {permissions?:{allow?:unknown[];defaultMode?:string}};
      if(Array.isArray(settings.permissions?.allow)&&settings.permissions.allow.length)found.push(`${settings.permissions.allow.length} allow rule(s) in ${name}`);
      if(['acceptEdits','bypassPermissions','dontAsk','auto'].includes(settings.permissions?.defaultMode??''))found.push(`default mode ${settings.permissions!.defaultMode} in ${name}`);
    }catch{/* no such settings */}
  }
  return found.length?`Your Claude Code settings approve some tools by themselves (${found.join('; ')}); AvA's permissions and internet switch aren't asked for those.`:undefined;
}
// Whether the agent accepts images (ACP promptCapabilities.image, as it declared at startup and ACPX recorded).
// Grok Build declares false; the others true. Unknown counts as false, so an image is never sent where it can't be read.
function imageInput(stateDir:string,sessionKey:string){
  try{return (JSON.parse(readFileSync(join(stateDir,'sessions',`${sessionKey}.json`),'utf8')) as {agent_capabilities?:{promptCapabilities?:{image?:boolean}}}).agent_capabilities?.promptCapabilities?.image===true;}
  catch{return false;}
}
// Providers whose web tools don't ask permission: their web access is fixed when the process starts, so the internet
// switch restarts them (resuming the same session). Verified live (B13/B14): Codex and Grok Build.
export const LAUNCH_TIME_WEB=new Set<Provider>(['codex','grok-build','vercel']);
// Web tools that ask permission (ACP kind "fetch": Claude Code's WebSearch and WebFetch) are allowed only while the
// agent's internet switch is on, checked at the moment each one asks. Everything else falls through to deny-all.
// Web tools by name, for agents that report them under a general kind (Antigravity: kind "search", "Run search_web?").
// File searches share kind "search", so the name decides. The name must lead the title: a command or a file path that
// merely mentions "web search" is not a web tool (a title is free text), and edits, commands and reads never are.
const WEB_TOOL=/^(?:Run\s+)?(?:search_web|read_url_content|read_url|url_content|web[ _-]?search|web[ _-]?fetch|google_web_search|fetch_url|browse_url)\b/i;
const NEVER_WEB=new Set(['edit','execute','delete','move','read','think','switch_mode']);
export function webPermission(request:{inferredKind?:string;raw:{toolCall?:{kind?:string|null;title?:string|null}}},internet:boolean){
  const call=request.raw.toolCall,kind=call?.kind??request.inferredKind??'';
  const web=kind==='fetch'||request.inferredKind==='fetch'||!NEVER_WEB.has(kind)&&WEB_TOOL.test((call?.title??'').trim());
  return internet&&web?{outcome:'allow_once' as const}:undefined;
}
// AvA's answer to one tool permission request, and the line the agent's screen shows for it. In order: web tools follow
// the internet switch; bypass approves everything else; a Build workspace allows what stays inside it; anything else
// falls through to deny-all (undefined).
export function toolPermission(request:{inferredKind?:string;raw:{toolCall?:{kind?:string|null;title?:string|null;locations?:Array<{path?:string}>|null;rawInput?:unknown}}},
  state:{internet:boolean;bypass:boolean;workspace?:string|undefined}):{decision:{outcome:'allow_once'}|undefined;status?:string}{
  const title=request.raw.toolCall?.title??'a tool';
  if(webPermission(request,state.internet))return {decision:{outcome:'allow_once'},status:`Web access allowed (internet on): ${title}`};
  if(webPermission(request,true))return {decision:undefined,status:`Web access refused (internet off): ${title}`};
  if(state.bypass)return {decision:{outcome:'allow_once'},status:`Allowed (permissions: bypass): ${title}`};
  if(state.workspace){const build=buildPermission(request,state.workspace);return {decision:build.decision,status:build.decision?`Allowed in its copy: ${title}`:`Refused (${build.reason}): ${title}`};}
  return {decision:undefined,status:`Refused (permissions: ask; this mode allows no tools): ${title}`};
}
export class NativeParticipant implements ConfiguredParticipant {
  sessionId:string;
  private identitySealed=false;
  private closed=false;
  constructor(readonly runtime:AcpxRuntime,readonly handle:AcpRuntimeHandle,readonly accepted:ProviderConfig,readonly evidence:string,private alive:()=>boolean=()=>true,
    private internet:()=>boolean=()=>false,readonly launchedWithInternet?:boolean,readonly imageInput=false,private workspace:()=>string|undefined=()=>undefined,readonly cwd?:string,
    private bypass:()=>boolean=()=>false){
    this.sessionId=handle.agentSessionId??handle.backendSessionId??handle.acpxRecordId??'';
    if(!this.sessionId)throw new AvAError('NO_SESSION_ID','No native session identity was returned.');
  }
  isConnected(){return !this.closed&&this.alive();}
  // Codex works in its own sandbox: read-only normally, workspace-write (edit and run commands in its workspace) for
  // Build runs and a Build session's 1:1 lines, full access when its permissions are set to bypass. It is set before
  // each request. The other CLIs keep asking, and AvA's gate answers.
  private codexMode='read-only';
  private noticeShown=false;
  // The agent's latest usage report (for the room's context ring): its context window from usage_update events, and the
  // session's token totals and cost from its session record.
  private report?:AgentUsage;
  private requestUsage?:Record<string,AcpRuntimeUsageBreakdown>;
  usage(){return this.report;}
  noteSessionUsage(usage:AcpRuntimeSessionUsage|undefined){
    if(usage?.perRequest)this.requestUsage={...usage.perRequest};
    const c=usage?.cumulative;
    const tokens=usage?.perRequest?sumUsage(Object.values(usage.perRequest)):c?sumUsage([c]):undefined;
    if(!tokens&&!usage?.cost)return;
    this.report={...this.report,...(tokens?{tokens}:{}),...(usage?.cost?{cost:usage.cost}:{}),at:Date.now()};
  }
  async setBuildAccess(on:boolean){
    const mode=this.bypass()?'agent-full-access':on?'workspace-write':'read-only';
    if(!CODEX_HARNESS.has(this.accepted.provider)||this.codexMode===mode)return;
    await this.runtime.setConfigOption({handle:this.handle,key:'mode',value:mode,signal:AbortSignal.timeout(60_000),assertActive:()=>{}});
    this.codexMode=mode;
  }
  async catalog():Promise<Catalog>{
    const status=await this.runtime.getStatus({handle:this.handle});
    return {provider:this.accepted.provider,currentModel:status.models?.currentModelId??this.accepted.model,
      models:status.models?.availableModels?.map(m=>({id:m.modelId,name:m.name}))??status.models?.availableModelIds.map(id=>({id,name:id}))??[],controls:controls(status.details?.configOptions)};
  }
  async request(request:AgentRequest):Promise<AgentResult>{
    request.signal.throwIfAborted();
    const usageBefore=this.report?.tokens;
    const requestsBefore=this.requestUsage;
    if(this.accepted.provider==='claude'&&!this.noticeShown){this.noticeShown=true;const notice=claudeSettingsNotice();if(notice)request.onEvent({type:'status',text:notice});}
    // Codex's sandbox follows the agent's state at this moment (bypass, a Build run or a Build 1:1 line, or neither), so
    // a permissions change mid-run applies from its next turn.
    await this.setBuildAccess(!!this.workspace());
    // Images travel as ACP image content (ACPX maps image/* attachments); text files are already inlined in the prompt.
    // AvA times turns itself (a run's per-turn limit, a 1:1 line's limit) and cancels through the signal, so ACPX's
    // own turn timeout (its runtime default, 60 s) is lifted to the longest turn AvA allows; a build turn runs for minutes.
    const turn=this.runtime.startTurn({handle:this.handle,text:request.text,...(request.attachments?.length?{attachments:request.attachments}:{}),requestId:request.id,mode:'prompt',signal:request.signal,assertActive:()=>request.signal.throwIfAborted(),timeoutMs:3_600_000,
      // The gate's decisions on web tools show in the agent's activity, so the user sees the switch at work.
      onPermissionRequest:async permission=>{
        if(process.env.AVA_DEBUG_PERMISSIONS)process.stderr.write(`[permission] ${JSON.stringify({inferredKind:permission.inferredKind,toolCall:permission.raw.toolCall,options:permission.raw.options}).slice(0,1200)}\n`);
        const gate=toolPermission(permission,{internet:this.internet(),bypass:this.bypass(),workspace:this.workspace()});
        if(gate.status)request.onEvent({type:'status',text:gate.status});
        return gate.decision;
      }});
    const messages=new Map<string,string>();let last='default';
    const started=turn.promptStarted.then(()=>request.onStarted());
    const drain=(async()=>{for await(const event of turn.events){
      if(event.type==='text_delta'){
        // Codex writes a notice into the reply for models it has no metadata for (any Gateway model not its own): it
        // belongs in the agent's screen as status, not in the answer.
        if(CODEX_HARNESS.has(this.accepted.provider)&&CODEX_NOTICE.test(event.text)){request.onEvent({type:'status',text:event.text.trim()});continue;}
        const thought=event.stream==='thought'||event.tag==='agent_thought_chunk';
        request.onEvent({type:thought?'thought':'output',text:event.text});
        if(!thought){last=event.messageId??'default';const text=(messages.get(last)??'')+event.text;if(text.length>256000)throw new AvAError('OUTPUT_LIMIT','Provider output exceeded the capture limit.');messages.set(last,text);}
      }else if(event.type==='tool_call'){request.onEvent({type:'tool',text:event.text});}
      else if(event.type==='status'){
        // A usage report is kept for the context ring rather than shown as an activity line.
        if(event.tag==='usage_update'){if(event.used!=null&&event.size!=null&&event.size>0)this.report={...this.report,context:{used:event.used,size:event.size},...(event.cost?{cost:event.cost}:{}),at:Date.now()};continue;}
        request.onEvent({type:'status',text:event.text});
      }
    }})();
    try{
      const [,,result]=await Promise.all([started,drain,turn.result]);
      if(result.status==='failed')throw new AvAError(result.error.code??'PROVIDER_ERROR',result.error.message);
      const status=await this.runtime.getStatus({handle:this.handle});
      this.noteSessionUsage(status.usage);
      const currentId=status.agentSessionId??status.backendSessionId??status.acpxRecordId;
      if(currentId&&currentId!==this.sessionId){
        if(this.identitySealed)throw new AvAError('SESSION_CHANGED','The provider changed the native conversation identity.');
        this.sessionId=currentId;
      }
      this.identitySealed=true;
      // ACPX's field named cumulative can be the latest turn, not a monotonic total. Its perRequest map is authoritative.
      const usage=status.usage?.perRequest?requestUsageSince(requestsBefore,status.usage.perRequest):usageDelta(usageBefore,this.report?.tokens);
      return {status:result.status,text:messages.get(last)??'',stopReason:result.stopReason,usage};
    }catch(error){
      await turn.cancel({reason:'request_failed'}).catch(()=>{});await turn.result.catch(()=>{});await drain.catch(()=>{});
      // The Gateway refusing the key reaches Codex as a 401: say what to do about it.
      if(this.accepted.provider==='vercel'&&/Authentication required|401|unauthori[sz]ed/i.test(error instanceof Error?error.message:String(error)))
        throw new AvAError('GATEWAY_AUTH','The Vercel AI Gateway refused the key. Set a valid AI_GATEWAY_API_KEY, or store one with `npm run gateway-key -- set` (or create one from this agent’s menu: Gateway key).');
      throw error;
    }
  }
  // Closing twice must not fail forever: after shutdown ACPX rejects close(), so a retry only waits for the first attempt
  // and lets recovery move on to the process census, which decides whether anything survived.
  private closeAttempt?:Promise<void>;
  async close(){
    if(this.closeAttempt)return this.closeAttempt.catch(()=>{});
    this.closed=true;
    this.closeAttempt=(async()=>{try{await this.runtime.close({handle:this.handle,reason:'ava-close'});}finally{await this.runtime.shutdown();}})();
    return this.closeAttempt;
  }
}
function sumUsage(rows:AcpRuntimeUsageBreakdown[]):AgentUsage['tokens']{
  if(!rows.length)return undefined;
  const tokens:NonNullable<AgentUsage['tokens']>={};
  for(const [out,key] of [['input','inputTokens'],['output','outputTokens'],['cachedRead','cachedReadTokens'],['total','totalTokens']] as const){
    const values=rows.map(r=>r[key]);
    if(values.every((n):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0))tokens[out]=values.reduce((a,b)=>a+b,0);
  }
  return Object.keys(tokens).length?tokens:undefined;
}
export function requestUsageSince(before:Record<string,AcpRuntimeUsageBreakdown>|undefined,after:Record<string,AcpRuntimeUsageBreakdown>):AgentUsage['tokens']{
  if(!before)return undefined;
  return sumUsage(Object.entries(after).filter(([id])=>!Object.hasOwn(before,id)).map(([,usage])=>usage));
}
// Session totals include activation, direct messages, and earlier runs. Persist only this request's delta.
// Missing baselines or a counter reset are unknown, not zero and not a negative token count.
export function usageDelta(before:AgentUsage['tokens'],after:AgentUsage['tokens']):AgentUsage['tokens']{
  const delta:NonNullable<AgentUsage['tokens']>={};
  for(const key of ['input','output','cachedRead','total'] as const){
    const a=before?.[key],b=after?.[key];
    if(a!==undefined&&b!==undefined&&Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>=a)delta[key]=b-a;
  }
  return Object.keys(delta).length?delta:undefined;
}
export function loadProviderSetups(dataRoot:string):Partial<Record<Provider,ProviderSetup>>{
  const file=join(dataRoot,'providers.json');if(!existsSync(file))return {};
  const value=JSON.parse(readFileSync(file,'utf8')) as Partial<Record<Provider,ProviderSetup>>;
  for(const [provider,setup] of Object.entries(value)){
    if(!PROVIDERS.includes(provider as Provider)||!setup||!Array.isArray(setup.argv)||setup.argv.some(v=>typeof v!=='string'))throw new AvAError('INVALID_SETUP','providers.json must contain known providers and installed argv arrays.');
  }
  return value;
}
