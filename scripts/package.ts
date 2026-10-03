// Builds the self-contained plugin and a local marketplace under release/marketplace (Stage C).
// Run through `npm run package`, which builds first. Nothing in the output may reference this checkout.
// `npm run package -- --out <dir>` builds somewhere else instead (a staging build: the Claude desktop app runs the plugin
// straight from release/marketplace, so building there deploys it).
import {cpSync,existsSync,linkSync,mkdirSync,readFileSync,readdirSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=resolve('.'),pkg=JSON.parse(readFileSync('package.json','utf8')) as {name:string;version:string;license?:string;author?:string;engines:Record<string,string>;dependencies:Record<string,string>;config?:{dataDir?:string}};
const outAt=process.argv.indexOf('--out'),out=outAt>=0?resolve(process.argv[outAt+1]!):join(root,'release','marketplace'),plugin=join(out,'plugins','agent-vs-agent');
for(const required of ['dist/src/server.js','dist/web/index.html'])if(!existsSync(required))throw new Error(`Missing ${required}; run npm run build first.`);
rmSync(out,{recursive:true,force:true});mkdirSync(plugin,{recursive:true});

for(const dir of ['.codex-plugin','assets','hooks','skills',join('dist','src'),join('dist','web')])cpSync(join(root,dir),join(plugin,dir),{recursive:true});
// Both manifests carry the package's version (the Claude Code one is stamped below).
const codexManifest=join(plugin,'.codex-plugin','plugin.json');writeFileSync(codexManifest,JSON.stringify({...JSON.parse(readFileSync(codexManifest,'utf8')),version:pkg.version},null,2));
// Runtime package only: production dependencies, ESM, the Node requirement the code checks at startup, and the shared
// data folder (config.dataDir), so the Codex and Claude Code plugins use the same history and background service.
writeFileSync(join(plugin,'package.json'),JSON.stringify({name:pkg.name,version:pkg.version,license:pkg.license,author:pkg.author,private:true,type:'module',engines:pkg.engines,config:pkg.config,dependencies:pkg.dependencies},null,2));
cpSync(join(root,'package-lock.json'),join(plugin,'package-lock.json'));
// Run npm's own script with this Node, so no shell is involved.
const npmCli=[join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),join(dirname(process.execPath),'..','lib','node_modules','npm','bin','npm-cli.js')].find(existsSync);
if(!npmCli)throw new Error('npm-cli.js not found next to this Node installation.');
execFileSync(process.execPath,[npmCli,'ci','--omit=dev','--prefer-offline','--no-audit','--no-fund'],{cwd:plugin,stdio:'inherit'});
// The adapters' own copies of the Codex and Claude Code CLIs (platform packages, about 660 MB) stay out: AvA runs the
// user's installed CLIs (src/clis.ts). Removed wherever npm placed them, before the notices are written.
const BUNDLED_CLI=/^(codex|claude-agent-sdk)-(win32|darwin|linux)-/;
const dropBundledClis=(modules:string):void=>{
  for(const entry of existsSync(modules)?readdirSync(modules,{withFileTypes:true}):[]){
    if(!entry.isDirectory())continue;
    const scoped=entry.name.startsWith('@')?readdirSync(join(modules,entry.name)).map(n=>join(entry.name,n)):[entry.name];
    for(const name of scoped){
      const dir=join(modules,name);
      if(/^@(openai|anthropic-ai)[\\/]/.test(name)&&BUNDLED_CLI.test(name.split(/[\\/]/)[1]!))rmSync(dir,{recursive:true,force:true});
      else dropBundledClis(join(dir,'node_modules'));
    }
  }
};
dropBundledClis(join(plugin,'node_modules'));
writeFileSync(join(plugin,'packaged.json'),JSON.stringify({name:pkg.name,version:pkg.version,builtAt:new Date().toISOString(),node:pkg.engines.node,data:`${pkg.config?.dataDir??'%USERPROFILE%\\AgentVsAgent'} unless AVA_DATA_DIR is set`},null,2));
// Codex does not expand ${PLUGIN_ROOT} in .mcp.json (C5 lifecycle test). Like OpenAI's bundled plugins, use a path relative
// to cwd "." (the installed plugin root) and forward the environment AvA and the provider CLIs need. Tool approval stays
// with the user (no default_tools_approval_mode).
// AVA_PARTICIPANT must pass through so the server's guard still refuses to start inside a participant agent.
// Proxy and CA variables keep provider sign-ins working on managed networks. API keys are deliberately not forwarded
// (subscription logins only); the API route then reports MISSING_API_AUTH instead of silently switching billing.
const ENV_VARS=['PATH','PATHEXT','SYSTEMROOT','SYSTEMDRIVE','WINDIR','COMSPEC','TEMP','TMP','USERNAME','USERPROFILE','HOMEDRIVE','HOMEPATH','HOME','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMDATA',
  'CODEX_HOME','GEMINI_HOME','GOOGLE_CLOUD_PROJECT','CLAUDE_CONFIG_DIR','CLAUDE_CODE_GIT_BASH_PATH','HTTPS_PROXY','HTTP_PROXY','NO_PROXY','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE',
  'AVA_PARTICIPANT','AVA_DATA_DIR','AVA_IDLE_TIMEOUT_MS'];
writeFileSync(join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{ava:{command:'node',args:['./dist/src/server.js','--mcp'],cwd:'.',env_vars:ENV_VARS,startup_timeout_sec:30}}},null,2));
if(existsSync(join(root,'scripts','notices.ts')))execFileSync(process.execPath,['--import','tsx',join(root,'scripts','notices.ts'),plugin],{stdio:'inherit'});
mkdirSync(join(out,'.agents','plugins'),{recursive:true});
writeFileSync(join(out,'.agents','plugins','marketplace.json'),JSON.stringify({name:'ava',interface:{displayName:'Agent vs Agent'},plugins:[{name:'agent-vs-agent',source:{source:'local',path:'./plugins/agent-vs-agent'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}]},null,2));

const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);

// Claude Code wrapper: the same core (dist, node_modules, runtime package, notices) under a Claude Code manifest,
// /ava command, skill, and MCP config. A separate folder, because Claude Code auto-loads hooks/hooks.json and .mcp.json
// from a plugin root, which would pick up the Codex wrapper's files. Core files are hard links (no extra disk space).
const claudePlugin=join(out,'plugins','agent-vs-agent-claude');
const share=(from:string,to:string)=>{for(const file of walk(from)){const target=join(to,file.slice(from.length));mkdirSync(dirname(target),{recursive:true});try{linkSync(file,target);}catch{cpSync(file,target);}}};
for(const core of ['dist','node_modules'])share(join(plugin,core),join(claudePlugin,core));
for(const file of ['package.json','package-lock.json','packaged.json','THIRD_PARTY_NOTICES.md'])if(existsSync(join(plugin,file)))cpSync(join(plugin,file),join(claudePlugin,file));
cpSync(join(root,'wrappers','claude'),claudePlugin,{recursive:true});
const claudeManifest=join(claudePlugin,'.claude-plugin','plugin.json'),manifest=JSON.parse(readFileSync(claudeManifest,'utf8'));
manifest.version=pkg.version;writeFileSync(claudeManifest,JSON.stringify(manifest,null,2));
mkdirSync(join(out,'.claude-plugin'),{recursive:true});
writeFileSync(join(out,'.claude-plugin','marketplace.json'),JSON.stringify({name:'ava',owner:{name:'Agent vs Agent'},metadata:{description:'Local marketplace for the Agent vs Agent plugin.'},plugins:[{name:'agent-vs-agent',source:'./plugins/agent-vs-agent-claude',description:manifest.description,version:pkg.version}]},null,2));

const files=walk(plugin),bytes=files.reduce((n,f)=>n+statSync(f).size,0);
console.log(JSON.stringify({marketplace:out,codexPlugin:plugin,claudePlugin,version:pkg.version,files:files.length,megabytes:Math.round(bytes/1048576)}));
