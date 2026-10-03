import test from 'node:test';
import assert from 'node:assert/strict';
import { activityProjection,readableOutput,type Event } from '../ui/projection.js';
test('activity fragments stay in their own seat and never consume public events',()=>{
  const events:Event[]=[
    {seq:1,type:'activity',time:'',data:{seat:'cli1',turnId:'a',type:'thought',text:'private '}},
    {seq:2,type:'activity',time:'',data:{seat:'cli2',turnId:'b',type:'output',text:'peer'}},
    {seq:3,type:'activity',time:'',data:{seat:'cli1',turnId:'a',type:'thought',text:'plan'}},
    {seq:4,type:'room_committed',time:'',data:{messageId:'m'}},
  ];
  const result=activityProjection([],events);assert.equal(result.length,2);assert.equal(result[0]!.text,'private plan');assert.equal(result[1]!.text,'peer');
  const bounded=activityProjection([],Array.from({length:600},(_,i)=>({seq:i,type:'activity',time:'',data:{seat:'cli1',turnId:String(i),type:'tool',text:'x'.repeat(4000)}})));
  assert.ok(bounded.length<=500);assert.ok(bounded.reduce((n,l)=>n+l.text.length,0)<=1000000);
});
test('a Debate reply shows as its message, decoded as it streams, and anything else as written',()=>{
  assert.equal(readableOutput('{"message":"Tabs.\\nSpaces win: \\"always\\" \\u00e9","stop_requested":false,"stop_reason":null}'),'Tabs.\nSpaces win: "always" é');
  assert.equal(readableOutput('{"message":"Half a rep'),'Half a rep','an unfinished reply shows what has arrived');
  assert.equal(readableOutput('```json\n{"message":"fenced"}\n```'),'fenced');
  assert.equal(readableOutput('Plain answer with {"message":"inside"}'),'Plain answer with {"message":"inside"}');
  assert.equal(readableOutput('{"stop_requested":true,"message":"x"}'),'{"stop_requested":true,"message":"x"}','only an envelope that opens with its message');
});