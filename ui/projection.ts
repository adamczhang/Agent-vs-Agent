import type { Seat } from '../src/types.js';
export interface Event {seq:number;type:string;time:string;data:Record<string,unknown>}
export interface ActivityLine {key:number;seat:Seat;turnId:string;type:string;text:string;late:boolean}
export function activityProjection(previous:ActivityLine[],events:Event[]):ActivityLine[]{
  const next=previous.map(line=>({...line}));
  for(const event of events){
    if(event.type!=='activity'||!['cli1','cli2'].includes(String(event.data.seat)))continue;
    const data=event.data,seat=data.seat as Seat,turnId=String(data.turnId),type=String(data.type),text=String(data.text??'');
    const last=next.findLast(line=>line.seat===seat);
    if(last&&['output','thought'].includes(type)&&last.turnId===turnId&&last.type===type&&last.late===!!data.late&&last.text.length+text.length<64000)last.text+=text;
    else next.push({key:event.seq,seat,turnId,type,text,late:!!data.late});
  }
  let size=0;
  return next.slice(-500).reverse().filter(line=>(size+=line.text.length)<=1000000).reverse();
}
// A Debate reply streams as AvA's JSON envelope ({"message": "...", "stop_requested": ...}). The agent's screen shows the
// message itself, decoded as it arrives (an unfinished reply shows what has come so far). Anything else, including an
// envelope that doesn't open with its message, is shown as written.
export function readableOutput(text:string){
  const open=/^\s*(?:```(?:json)?\s*)?\{\s*"message"\s*:\s*"/.exec(text);
  if(!open)return text;
  const ESCAPES:Record<string,string>={n:'\n',t:'\t',r:'',b:'',f:''};
  let out='';
  for(let i=open[0].length;i<text.length;i++){
    const c=text[i]!;
    if(c==='"')break;
    if(c!=='\\'){out+=c;continue;}
    const next=text[++i];if(next===undefined)break;
    if(next==='u'){const hex=text.slice(i+1,i+5);if(!/^[0-9a-fA-F]{4}$/.test(hex))break;out+=String.fromCharCode(parseInt(hex,16));i+=4;continue;}
    out+=ESCAPES[next]??next;
  }
  return out;
}