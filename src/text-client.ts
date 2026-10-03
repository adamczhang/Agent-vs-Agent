import { randomUUID } from 'node:crypto';
import type { Menu } from './menus.js';
import type { Pair,Seat } from './types.js';

export type Rpc=(method:string,params:unknown)=>Promise<unknown>;
const SUBCOMMANDS=['cli1','cli2','start','status','reconcile'];
// Strict grammar for typed commands. hooks/route.mjs applies the same rule before routing, so no other text reaches a tool.
export function normalizeCommand(command:string):string|null{
  const words=command.trim().split(/\s+/),sub=words[1]?.toLowerCase(),choice=words[2]?.toLowerCase();
  if(words[0]?.toLowerCase()!=='/ava'||words.length>3)return null;
  if(!sub)return '/ava';
  if(!SUBCOMMANDS.includes(sub))return null;
  if(choice!==undefined&&(!sub.startsWith('cli')||!/^(\d{1,3}|b|x)$/.test(choice)))return null;
  return ['/ava',sub.toUpperCase(),choice?.toUpperCase()].filter(Boolean).join(' ');
}
export interface TextCommand{rpc:Rpc;thread:string;command:string;roomUrl(roomId:string):string}
// Hook-routed /ava commands. Returns the exact text the CLI prints; errors propagate to the caller.
export async function runCommand({rpc,thread,command:typed,roomUrl}:TextCommand):Promise<string>{
  // Every entry point (MCP tool, terminal, legacy hook request file) goes through the same strict grammar.
  const command=normalizeCommand(typed);
  if(!command)throw new Error('Use /ava, /ava CLI1, /ava CLI2, /ava start, /ava status, or /ava reconcile (menu choices look like /ava CLI1 2).');
  if(!/^[\w-]{1,200}$/.test(thread))throw new Error('Agent vs Agent could not identify this chat.');
  const pair=await rpc('pair.create',{thread}) as Pair;
  const words=command.trim().split(/\s+/).slice(1),first=words[0]?.toLowerCase();
  if(!first)return 'Agent vs Agent\n/ava CLI1 — configure and activate the first agent\n/ava CLI2 — configure and activate the second agent\n/ava start — open the room (agents not yet active can be activated there)\n/ava status — inspect the pair\n/ava reconcile — release a pair whose conversation needs attention';
  if(first==='status')return JSON.stringify(await rpc('pair.get',{pairId:pair.id}),null,2);
  if(first==='reconcile'){
    const view=await rpc('pair.get',{pairId:pair.id}) as Pair&{activeRun:{id:string;status:string}|null};
    if(view.activeRun?.status!=='needs_attention')return 'This pair has no conversation that needs attention.';
    return JSON.stringify(await rpc('run.reconcile',{runId:view.activeRun.id,requestId:randomUUID()}),null,2);
  }
  if(first==='start'){
    const prepared=await rpc('room.prepare',{pairId:pair.id}) as {ticket?:string;roomId?:string};
    const room=prepared.roomId?prepared:await rpc('room.open',{ticket:prepared.ticket}) as {roomId:string};
    const view=await rpc('pair.get',{pairId:pair.id}) as Pair,ready=(['cli1','cli2'] as const).every(s=>view.slots[s].state==='ready');
    return JSON.stringify({message:prepared.roomId?'Reopen the existing room without changing its agents.':ready?'Both agents verified. Open the room in your browser panel.':'Open the room in your browser panel, then activate each agent there (the Activate button above its screen).',url:roomUrl(room.roomId!),roomId:room.roomId});
  }
  if(first!=='cli1'&&first!=='cli2')throw new Error('Use /ava CLI1, /ava CLI2, /ava start, /ava status, or /ava reconcile.');
  const seat=first as Seat;
  if(!words[1])return (await rpc('menu.show',{pairId:pair.id,seat}) as Menu).text;
  // The service's current menu for this chat's pair and seat is the one the user last saw,
  // whether the text client or the MCP tools displayed it.
  const current=await rpc('menu.current',{pairId:pair.id,seat}) as Menu|null;
  if(!current)throw new Error(`Open /ava ${seat.toUpperCase()} before choosing an option.`);
  const result=await rpc('menu.choose',{pairId:pair.id,seat,menuId:current.id,choice:words[1]}) as {menu:Menu;activation?:unknown};
  return (result.activation?'Activation verified:\n'+JSON.stringify(result.activation,null,2)+'\n\n':'')+result.menu.text;
}
