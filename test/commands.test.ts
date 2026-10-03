import test from 'node:test';
import assert from 'node:assert/strict';
import {CommandClient} from '../ui/commands.js';
test('lost start acknowledgement and viewer reload reuse the original start command instead of broadcasting twice',async()=>{
  const values=new Map<string,string>(),storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const sent:Array<{method:string;params:any}>=[];
  const first=new CommandClient(storage,'room');
  await assert.rejects(first.execute('send:pair:topic','run.start',{pairId:'pair',text:'topic'},async(method,params)=>{sent.push({method,params});throw new TypeError('Lost acknowledgement');}));
  const reloaded=new CommandClient(storage,'room');assert.equal(reloaded.draft,'topic');
  await reloaded.execute('send:pair:topic','run.broadcast',{runId:'run-now-visible',text:'topic'},async(method,params)=>{sent.push({method,params});return {};});
  assert.equal(sent[1]!.method,'run.start');assert.deepEqual(sent[1]!.params,sent[0]!.params);assert.equal(values.size,0);
});
