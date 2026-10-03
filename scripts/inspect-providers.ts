// Lists the providers AvA can launch here; with --discover [--provider=<id>], also each one's models and settings
// (starts the agent, sends no prompt). Prints JSON.
import { NativeFactory,loadProviderSetups } from '../src/providers.js';
import { PROVIDERS } from '../src/types.js';
const root=process.env.AVA_DATA_DIR??new URL('../.ava-data/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
const factory=new NativeFactory(root,loadProviderSetups(root));
console.log(JSON.stringify(factory.list(),null,2));
if(process.argv.includes('--discover')){
  const picked=process.argv.find(a=>a.startsWith('--provider='))?.split('=')[1];
  for(const provider of PROVIDERS.filter(p=>!picked||p===picked)){
    if(factory.inspect(provider)?.launch.kind!=='installed')continue;
    try{
      const catalog=await factory.discover(provider,AbortSignal.timeout(120000));
      console.log(JSON.stringify({provider,catalog}));
    }catch(e){console.log(JSON.stringify({provider,error:e instanceof Error?e.message:String(e)}));}
  }
}
