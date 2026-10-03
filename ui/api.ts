const fragment = new URLSearchParams(location.hash.slice(1));
const token = fragment.get('token') || sessionStorage.getItem('ava-token') || '';
export const roomId = fragment.get('room') || sessionStorage.getItem('ava-room') || '';
// The mode a New thread page opens in (from the page that opened it).
export const initialMode = fragment.get('mode');
// The link to another room on this service, as the hosts open rooms: the capability travels in the fragment only.
export const roomLink = (room: string, mode: string) => `${location.origin}/#token=${encodeURIComponent(token)}&room=${encodeURIComponent(room)}&mode=${encodeURIComponent(mode)}`;
if(token)sessionStorage.setItem('ava-token',token);
if(roomId)sessionStorage.setItem('ava-room',roomId);
// The capability never enters query strings, referrers, or page markup.
if(location.hash)history.replaceState(null,'',location.pathname);
// A room link opened over this page (some browsers treat it as an in-page jump) loads that room.
addEventListener('hashchange',()=>{const next=new URLSearchParams(location.hash.slice(1));if(next.get('room')){sessionStorage.setItem('ava-room',next.get('room')!);if(next.get('token'))sessionStorage.setItem('ava-token',next.get('token')!);location.reload();}});
// An answer from AvA (a refusal or a failure it reported); anything else thrown by rpc means AvA couldn't be reached.
export class RpcError extends Error {readonly definitive=true;constructor(message:string,readonly code=''){super(message);}}
export async function rpc<T>(method:string,params:unknown):Promise<T>{
  const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({method,params}),signal:AbortSignal.timeout(130000)});
  // A room link carries the token of the service that opened it; after AvA restarts, that token is no longer valid.
  if(response.status===401)throw new RpcError('This room link has expired because AvA restarted since it was opened. Open the room again: /ava start in Codex, /agent-vs-agent:ava start in Claude Code.','AUTH');
  const body=await response.json().catch(()=>({})) as {result?:T;error?:string;code?:string};
  if(!response.ok||body.error)throw new RpcError(body.error||`Request failed (${response.status})`,body.code);
  return body.result as T;
}
