// Writes THIRD_PARTY_NOTICES.md for a built plugin from its installed production dependencies, and reports any
// license that is not a common permissive one so the user can decide (Claude does not decide license questions).
// Usage: node --import tsx scripts/notices.ts <pluginDir> [--summary <file.json>]
import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';

const args=process.argv.slice(2),plugin=resolve(args[0]??'release/marketplace/plugins/agent-vs-agent'),summaryIndex=args.indexOf('--summary');
const PERMISSIVE=new Set(['MIT','ISC','BSD-2-Clause','BSD-3-Clause','Apache-2.0','0BSD','BlueOak-1.0.0','Unlicense','CC0-1.0','Python-2.0','MIT-0','Zlib']);
interface Entry{name:string;version:string;license:string;text:string|null;flag:string|null}
const entries=new Map<string,Entry>();
function licenseOf(pkg:Record<string,unknown>){
  const l=pkg.license??pkg.licenses;
  if(typeof l==='string')return l;
  if(Array.isArray(l))return l.map(x=>typeof x==='string'?x:(x as {type?:string}).type??'?').join(' OR ');
  if(l&&typeof l==='object')return (l as {type?:string}).type??'UNKNOWN';
  return 'UNKNOWN';
}
function flagFor(license:string){
  if(license==='UNKNOWN')return 'no license declared';
  const parts=license.replace(/[()]/g,'').split(/\s+(?:OR|AND)\s+/);
  // An OR expression is fine if any branch is permissive; AND needs all of them.
  const ok=/\sAND\s/.test(license)?parts.every(p=>PERMISSIVE.has(p)):parts.some(p=>PERMISSIVE.has(p));
  return ok?null:`license "${license}" needs review`;
}
function visit(modules:string){
  if(!existsSync(modules))return;
  for(const entry of readdirSync(modules,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    const dir=join(modules,entry.name);
    if(entry.name.startsWith('@')){visit(dir);continue;}
    const manifest=join(dir,'package.json');
    if(existsSync(manifest)){
      const pkg=JSON.parse(readFileSync(manifest,'utf8')) as Record<string,unknown>,key=`${pkg.name}@${pkg.version}`;
      if(!entries.has(key)){
        const file=readdirSync(dir).find(f=>/^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i.test(f));
        const license=licenseOf(pkg);
        entries.set(key,{name:String(pkg.name),version:String(pkg.version),license,text:file?readFileSync(join(dir,file),'utf8').trim():null,flag:flagFor(license)});
      }
    }
    visit(join(dir,'node_modules'));
  }
}
visit(join(plugin,'node_modules'));
const sorted=[...entries.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
const lines=['# Third-party notices','',`Agent vs Agent bundles the following ${sorted.length} packages (production dependencies, generated ${new Date().toISOString().slice(0,10)}).`,''];
for(const e of sorted){lines.push(`## ${e.name} ${e.version}`,'',`License: ${e.license}`,'');if(e.text)lines.push('```text',e.text,'```','');else lines.push('_No license file is included in this package._','');}
writeFileSync(join(plugin,'THIRD_PARTY_NOTICES.md'),lines.join('\n'));
const flagged=sorted.filter(e=>e.flag).map(e=>({package:`${e.name}@${e.version}`,reason:e.flag}));
const counts=Object.entries(sorted.reduce<Record<string,number>>((m,e)=>(m[e.license]=(m[e.license]??0)+1,m),{})).sort((a,b)=>b[1]-a[1]);
const summary={plugin,packages:sorted.length,missingLicenseText:sorted.filter(e=>!e.text).length,licenses:Object.fromEntries(counts),flagged};
if(summaryIndex>=0){const out=resolve(args[summaryIndex+1]!);mkdirSync(dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(summary,null,2));}
console.log(JSON.stringify({notices:join(plugin,'THIRD_PARTY_NOTICES.md'),packages:summary.packages,flagged:flagged.length}));
if(flagged.length)console.log('Needs the user\'s review:\n'+flagged.map(f=>`  ${f.package}: ${f.reason}`).join('\n'));
