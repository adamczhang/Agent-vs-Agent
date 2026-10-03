// Simulation room for UI development: scripted agents, temporary data, no provider processes or model requests.
// The room URL (it carries the bearer token) is written to <data>/dev-url.txt, never printed.
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AvAService} from '../src/service.js';
import {listen} from '../src/http.js';
import {SimulationFactory} from '../src/simulation.js';
import {SEATS,type Pair} from '../src/types.js';

const args=process.argv.slice(2),option=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const port=Number(option('--port')??0),delay=Number(option('--delay')??900);
const dataRoot=resolve(option('--data')??mkdtempSync(join(tmpdir(),'ava-sim-')));
const service=new AvAService(dataRoot,new SimulationFactory(delay),'simulation');
let pair=await service.call('pair.create',{thread:'dev-sim'}) as Pair;
if(!pair.activeRunId){
  const providers={cli1:'codex',cli2:'claude'} as const;
  for(const seat of SEATS){
    if(!pair.slots[seat].config)await service.call('slot.configure',{pairId:pair.id,seat,config:{provider:providers[seat],model:'sim-model',auth:'provider-login'}});
    await service.call('slot.activate',{pairId:pair.id,seat});
  }
  pair=await service.call('pair.get',{pairId:pair.id}) as Pair;
}
const prepared=await service.call('room.prepare',{pairId:pair.id}) as {ticket?:string;roomId?:string};
const room=prepared.roomId?prepared:await service.call('room.open',{ticket:prepared.ticket}) as {roomId:string};
const http=await listen(service,resolve('dist','web'),port);
const urlFile=join(dataRoot,'dev-url.txt');
writeFileSync(urlFile,`http://127.0.0.1:${http.port}/#token=${http.token}&room=${room.roomId}`,{mode:0o600});
console.log(JSON.stringify({status:'listening',mode:'simulation',port:http.port,dataRoot,urlFile}));
const stop=()=>{void http.close().finally(()=>{service.store.close();process.exit(0);});};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
