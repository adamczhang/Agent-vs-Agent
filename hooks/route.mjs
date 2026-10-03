// Agent vs Agent prompt hook (0.2.0+). Routes typed /ava commands to the plugin's ava_command MCP tool, which runs
// outside the chat's sandbox and can be approved once. Only a strictly validated command and the chat ID are passed on:
// no files are written, no shell command is suggested, and no other prompt text reaches the context.
import { readFileSync } from 'node:fs';
let event={};try{event=JSON.parse(readFileSync(0,'utf8'));}catch{}
const prompt=typeof event.prompt==='string'?event.prompt.trim():'';
const say=text=>process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'UserPromptSubmit',additionalContext:text}}));
// Same grammar as normalizeCommand in src/text-client.ts (test/hooks.test.ts checks they agree).
function normalize(command){
  const words=command.trim().split(/\s+/),sub=words[1]?.toLowerCase(),choice=words[2]?.toLowerCase();
  if(words[0]?.toLowerCase()!=='/ava'||words.length>3)return null;
  if(!sub)return '/ava';
  if(!['cli1','cli2','start','status','reconcile','doctor'].includes(sub))return null;
  if(choice!==undefined&&(!sub.startsWith('cli')||!/^(\d{1,3}|b|x)$/.test(choice)))return null;
  return ['/ava',sub.toUpperCase(),choice?.toUpperCase()].filter(Boolean).join(' ');
}
if(process.env.AVA_PARTICIPANT!=='1'&&/^\/ava(?:\s|$)/i.test(prompt)){
  const thread=String(event.thread_id??event.session_id??process.env.CODEX_THREAD_ID??''),command=normalize(prompt);
  if(!/^[\w-]{1,200}$/.test(thread))say('Agent vs Agent cannot identify this Codex chat. Do not start agents; report the missing chat identity.');
  else if(!command)say('This /ava command is not recognized. Tell the user the commands are /ava, /ava doctor, /ava CLI1, /ava CLI2, /ava start, /ava status, and /ava reconcile, and menu choices look like /ava CLI1 2. Do not call any tool.');
  else say(`This is an Agent vs Agent control command. Call the MCP tool ava_command (server "ava") with thread "${thread}" and command "${command}". Show the returned text faithfully. If it returns a room URL, open it with open_in_codex in this chat's browser panel. Do not run a shell command for it, forward it to either agent, or create agents yourself. If the tool fails, show the specific error. Ordinary software-development work stays with Codex.`);
}
