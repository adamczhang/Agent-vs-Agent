import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { AvAService } from '../src/service.js';
import { runCommand } from '../src/text-client.js';
import type { Pair } from '../src/types.js';
import { speedName, type Menu } from '../src/menus.js';
import { TestFactory } from './fakes.js';
import { tempDir } from './temp.js';

function fixture(thread:string){
  const factory=new TestFactory(),service=new AvAService(tempDir('ava-menus-'),factory,'simulation');
  const text=(command:string)=>runCommand({rpc:(method,params)=>service.call(method,params),thread,command,roomUrl:roomId=>'room:'+roomId});
  return {service,factory,text,close:async()=>{await service.shutdown();service.store.close();}};
}
test('text menu choices work when only the text client is used',async()=>{
  const {service,factory,text,close}=fixture('text-only'),pair=await service.call('pair.create',{thread:'text-only'}) as Pair;
  try{
    assert.match(await text('/ava CLI1'),/Choose a CLI/);
    assert.match(await text('/ava CLI1 1'),/Provider: Claude Code/);
    assert.equal(service.store.pair(pair.id).slots.cli1.config?.provider,'claude');assert.equal(factory.agents.length,0);
  }finally{await close();}
});
test('a text menu choice still applies after the MCP path re-shows the same slot menu',async()=>{
  const {service,factory,text,close}=fixture('mixed'),pair=await service.call('pair.create',{thread:'mixed'}) as Pair;
  try{
    await text('/ava CLI1');
    await service.call('menu.show',{pairId:pair.id,seat:'cli1'});
    assert.match(await text('/ava CLI1 1'),/Provider: Claude Code/);
    assert.equal(service.store.pair(pair.id).slots.cli1.config?.provider,'claude');assert.equal(factory.agents.length,0);
  }finally{await close();}
});
test('an MCP choice must name the latest displayed menu, even when the text client displayed it',async()=>{
  const {service,text,close}=fixture('reverse'),pair=await service.call('pair.create',{thread:'reverse'}) as Pair;
  try{
    const old=await service.call('menu.show',{pairId:pair.id,seat:'cli1'}) as Menu;
    await text('/ava CLI1');
    await assert.rejects(service.call('menu.choose',{pairId:pair.id,seat:'cli1',menuId:old.id,choice:'1'}),/out of date/);
    const current=await service.call('menu.current',{pairId:pair.id,seat:'cli1'}) as Menu;
    await service.call('menu.choose',{pairId:pair.id,seat:'cli1',menuId:current.id,choice:'2'});
    assert.equal(service.store.pair(pair.id).slots.cli1.config?.provider,'codex');
  }finally{await close();}
});
test('a text choice without a displayed menu, or after cancel, asks to open the menu',async()=>{
  const {service,text,close}=fixture('closed'),pair=await service.call('pair.create',{thread:'closed'}) as Pair;
  try{
    await assert.rejects(text('/ava CLI2 1'),/Open \/ava CLI2 before choosing/);
    await text('/ava CLI2');assert.match(await text('/ava CLI2 x'),/menu closed/);
    await assert.rejects(text('/ava CLI2 1'),/Open \/ava CLI2 before choosing/);
    assert.equal(service.store.pair(pair.id).slots.cli2.config,null);
  }finally{await close();}
});

test('speed reads Default or Fast, and every default choice reads Default',async()=>{
  assert.deepEqual([speedName('on','On'),speedName('off','Off'),speedName('fast'),speedName('default'),speedName('turbo','Turbo')],['Fast','Default','Fast','Default','Turbo']);
  const {service,text,close}=fixture('defaults');await service.call('pair.create',{thread:'defaults'});
  try{
    await text('/ava CLI1');const home=await text('/ava CLI1 1');
    assert.match(home,/Effort: Default/);assert.match(home,/Speed: Default/);assert.doesNotMatch(home,/Provider default|model default/i);
    const speed=await text('/ava CLI1 4');
    assert.match(speed,/1\. Default/);assert.doesNotMatch(speed,/control unavailable/);
  }finally{await close();}
});