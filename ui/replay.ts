// Reveal times (ms after the run started) for replaying a saved run. Replies are timed by their
// room_committed event and human broadcasts by room_queued; the opening topic has no event of its own.
// Times never go backwards, so playback keeps the recorded message order.
export interface TimedEvent {type:string;time:string;data:Record<string,unknown>}
export function replayTimeline(messages:Array<{id:string}>,events:TimedEvent[]){
  const start=Date.parse(events.find(e=>e.type==='run_started')?.time??events[0]?.time??'');
  const recorded:Record<string,number>={};
  for(const e of events){const id=e.data.messageId;if(typeof id==='string'&&(e.type==='room_committed'||e.type==='room_queued'))recorded[id]=Date.parse(e.time)-start;}
  const offsets:Record<string,number>={};let last=0;
  for(const m of messages){const at=recorded[m.id];last=Math.max(last,Number.isFinite(at)?at!:last);offsets[m.id]=last;}
  return {offsets,total:last};
}
