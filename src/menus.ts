import { randomUUID } from 'node:crypto';
import { AvAError, PROVIDERS, type Provider, type ProviderConfig, type Seat } from './types.js';
import type { Catalog } from './providers.js';
import { makerName, type GatewayModel } from './gateway.js';
import { Store } from './store.js';
import { ActivationManager } from './activation.js';

export const LABELS:Record<Provider,string>={claude:'Claude Code',codex:'Codex CLI','grok-build':'Grok Build',antigravity:'Antigravity',vercel:'Vercel AI Gateway'};
export interface MenuChoice { label:string; value:string; config?:ProviderConfig }
// context: where a long model list stands (the Vercel AI Gateway's: a maker, a page, or a search). search: the room may
// offer a search box for this menu.
export interface MenuContext { maker?:string; page?:number; query?:string }
export interface Menu { id:string; pairId:string; seat:Seat; generation:number; phase:'home'|'provider'|'model'|'effort'|'speed'|'auth'|'permissions'|'gateway-key'; title:string; choices:MenuChoice[]; text:string; context?:MenuContext; search?:boolean }
// How each CLI's own name for "approve everything" reads, so the choice is recognisable.
const BYPASS_NAMES:Record<Provider,string>={claude:'bypass permissions',codex:'full access','grok-build':'always allow',antigravity:'YOLO',vercel:'full access'};
export const PERMISSION_LABELS={ask:'Ask: tools only where the mode allows (a Build session’s own folder)',bypass:'Bypass: approve every tool request, in every mode'};
// The Vercel AI Gateway's side of the menus: its model list, and AvA's Gateway key (status only; never the key).
export interface GatewayMenus {
  models():Promise<GatewayModel[]>;
  keyStatus():{source:'environment'|'stored'|'none';ending?:string;name?:string;budget?:string};
  createKey(budget:number):Promise<unknown>;
  forgetKey():void;
}
const PAGE=20,SEARCH_LIMIT=40,BUDGETS=[25,100];
const date=(seconds:number)=>seconds?new Date(seconds*1000).toISOString().slice(0,7):'';
const modelLabel=(m:GatewayModel,withMaker=false)=>`${withMaker?`${makerName(m.maker)} · `:''}${m.name} (${m.id})${m.released?` · ${date(m.released)}`:''}`;
export class Menus {
  // The menus table comes from schema migration 5. setPermissions applies the permissions choice (the service's).
  constructor(private store:Store,private activation:ActivationManager,private catalog:(provider:Provider,model:string,auth:ProviderConfig['auth'])=>Promise<Catalog>,
    private setPermissions:(pairId:string,seat:Seat,level:'ask'|'bypass')=>Promise<unknown>=async(pairId,seat,level)=>store.setSlotPermissions(pairId,seat,level),
    private gateway?:GatewayMenus){}
  private save(menu:Menu){this.store.db.prepare('INSERT INTO menus VALUES(?,?,?) ON CONFLICT(pair_id,seat) DO UPDATE SET data=excluded.data').run(menu.pairId,menu.seat,JSON.stringify(menu));return menu;}
  current(pairId:string,seat:Seat):Menu|undefined{const row=this.store.db.prepare('SELECT data FROM menus WHERE pair_id=? AND seat=?').get(pairId,seat);return row?JSON.parse(String(row.data)) as Menu:undefined;}
  private keyLine(){
    const status=this.gateway?.keyStatus()??{source:'none' as const};
    return status.source==='environment'?`AI_GATEWAY_API_KEY from the environment (…${status.ending})`:status.source==='stored'?`Agent vs Agent’s key (…${status.ending}${status.budget?`, ${status.budget}`:''})`:'missing: create one with your Vercel login';
  }
  async show(pairId:string,seat:Seat,phase:Menu['phase']='home',context:MenuContext={}):Promise<Menu>{
    const slot=this.store.pair(pairId).slots[seat],config=slot.config;
    let choices:MenuChoice[]=[],title='Settings',search=false;
    if(!config&&phase==='home')phase='provider';
    if(phase==='provider'){title='Choose a CLI';choices=PROVIDERS.map(p=>({label:p==='vercel'?`${LABELS[p]} (hundreds of models; API key)`:LABELS[p],value:p}));}
    else if(phase==='home'&&config){
      const bypass=slot.permissions==='bypass',vercel=config.provider==='vercel';
      choices=[{label:`Provider: ${LABELS[config.provider]}`,value:'provider'},{label:`Model: ${config.model||'Select model'}`,value:'model'},{label:`Effort: ${config.effort?.value??'Provider / model default'}`,value:'effort'},
        // The Gateway has one route (its key) and no speed setting.
        ...(vercel?[{label:`Gateway key: ${this.keyLine()}`,value:'gateway-key'}]:[{label:`Speed: ${config.speed?.value??'Provider default'}`,value:'speed'},{label:`Access: ${config.auth}`,value:'auth'}]),
        {label:`Permissions: ${bypass?`Bypass (${BYPASS_NAMES[config.provider]})`:'Ask'}`,value:'permissions'},
        {label:slot.state==='ready'?'Reactivate with these settings (fresh session; one short model request)':'Activate and verify (one short model request)',value:'activate'}];
    }
    else if(phase==='auth'){title='Choose account route';choices=[{label:'Existing provider login',value:'provider-login'},{label:'Configured API credential',value:'api'}];}
    else if(phase==='permissions'){title='Choose tool permissions (applies at once; no new session)';choices=[{label:PERMISSION_LABELS.ask,value:'ask'},{label:`${PERMISSION_LABELS.bypass}${config?` (${BYPASS_NAMES[config.provider]})`:''}`,value:'bypass'}];}
    else if(phase==='gateway-key'){
      const status=this.gateway?.keyStatus()??{source:'none' as const};
      title=`AI Gateway key: ${this.keyLine()}`;
      choices=status.source==='none'?[...BUDGETS.map(b=>({label:`Create a key named "agent-vs-agent" with your Vercel login, with a $${b} monthly budget`,value:`create:${b}`})),{label:'I’ll set AI_GATEWAY_API_KEY myself (then reopen this menu)',value:'keep'}]
        :status.source==='stored'?[{label:'Keep this key',value:'keep'},{label:'Forget Agent vs Agent’s key (it stays in your Vercel account until you remove it there)',value:'forget'}]
        :[{label:'Keep using it',value:'keep'}];
    }
    else if(config?.provider==='vercel'&&phase==='model'){
      // Hundreds of models: by maker, then a maker's models newest first, a page at a time; or a search.
      const models=await this.gatewayModels();search=true;
      if(context.query){
        const q=context.query.toLowerCase(),found=models.filter(m=>m.id.toLowerCase().includes(q)||m.name.toLowerCase().includes(q)).sort((a,b)=>a.maker.localeCompare(b.maker)||b.released-a.released);
        title=found.length?`Models matching “${context.query}” (${found.length}${found.length>SEARCH_LIMIT?`, first ${SEARCH_LIMIT} shown`:''})`:`No model matches “${context.query}”`;
        choices=found.slice(0,SEARCH_LIMIT).map(m=>({label:modelLabel(m,true),value:m.id}));
      }else if(context.maker){
        const own=models.filter(m=>m.maker===context.maker).sort((a,b)=>b.released-a.released||a.id.localeCompare(b.id)),pages=Math.max(1,Math.ceil(own.length/PAGE)),page=Math.min(Math.max(0,context.page??0),pages-1);
        title=`${makerName(context.maker)} models (${own.length})${pages>1?` · page ${page+1} of ${pages}`:''}`;
        choices=own.slice(page*PAGE,page*PAGE+PAGE).map(m=>({label:modelLabel(m),value:m.id}));
        if(page+1<pages)choices.push({label:`More ${makerName(context.maker)} models (page ${page+2} of ${pages})`,value:`page:${page+1}`});
        if(page>0)choices.push({label:`Previous page (${page} of ${pages})`,value:`page:${page-1}`});
      }else{
        const counts=new Map<string,number>();for(const m of models)counts.set(m.maker,(counts.get(m.maker)??0)+1);
        title=`Choose a model maker (${models.length} tool-using models)`;
        choices=[...counts].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([maker,n])=>({label:`${makerName(maker)} (${n})`,value:`maker:${maker}`}));
      }
    }
    else if(config?.provider==='vercel'&&phase==='effort'){
      const model=(await this.gatewayModels()).find(m=>m.id===config.model);
      title=`Choose effort for ${config.model||'the model'}`;
      choices=[...(model?.efforts??[]).map(e=>({label:e,value:e,config:{...config,effort:{key:'model_reasoning_effort',value:e}}})),{label:'Model default',value:'default',config:{...config,effort:undefined}}];
    }
    else if(config?.provider==='vercel'&&phase==='speed'){choices=[{label:'Provider default — control unavailable',value:'default',config:{...config,speed:undefined}}];}
    else if(config){
      const data=await this.catalog(config.provider,phase==='model'?'':config.model,config.auth);
      if(phase==='model'){title='Choose a model';choices=data.models.map(m=>({label:m.name,value:m.id}));}
      else {
        const control=data.controls.find(c=>phase==='effort'?/effort/i.test(c.id):/fast|speed|service.tier/i.test(c.id));
        title=`Choose ${phase}`;
        if(control){choices=control.options.map(v=>({label:v.name,value:v.value,config:{...config,[phase]:{key:control.id,value:v.value}}}));}
        else if(phase==='effort'&&config.provider==='antigravity'){
          const current=data.models.find(m=>m.id===config.model),base=current?.name.replace(/\s*\((?:High|Medium|Low)\)$/,'');
          choices=data.models.filter(m=>base&&m.name.replace(/\s*\((?:High|Medium|Low)\)$/,'')===base).map(m=>({label:m.name,value:m.id,config:{...config,model:m.id,effort:undefined}}));
        }
        if(!choices.length)choices=[{label:'Provider default — control unavailable',value:'default',config:{...config,[phase]:undefined}}];
      }
    }
    const current=this.store.pair(pairId).slots[seat];if(current.generation!==slot.generation)throw new AvAError('STALE_MENU','Slot changed while the menu loaded. Open it again.');
    const id=randomUUID();
    const text=[`Agent vs Agent · ${seat.toUpperCase()}`,title,`Status: ${slot.state}`,...choices.map((c,i)=>`${i+1}. ${c.label}`),'B. Back    X. Cancel',`Reply: /ava ${seat.toUpperCase()} <number>`].join('\n');
    return this.save({id,pairId,seat,generation:slot.generation,phase,title,choices,text,...(Object.keys(context).length?{context}:{}),...(search?{search}:{})});
  }
  private async gatewayModels(){if(!this.gateway)throw new AvAError('GATEWAY_UNAVAILABLE','The Vercel AI Gateway isn’t available here.');return this.gateway.models();}
  // A search over the Gateway's models (the room's search box); the result is an ordinary numbered menu.
  async search(pairId:string,seat:Seat,query:string){
    const config=this.store.pair(pairId).slots[seat].config;
    if(config?.provider!=='vercel')throw new AvAError('NO_SEARCH','Model search is for the Vercel AI Gateway.');
    return this.show(pairId,seat,'model',query.trim()?{query:query.trim()}:{});
  }
  async choose(pairId:string,seat:Seat,menuId:string,choice:string):Promise<{menu:Menu;activation?:unknown}>{
    const menu=this.current(pairId,seat),slot=this.store.pair(pairId).slots[seat];
    if(!menu||menu.id!==menuId||menu.generation!==slot.generation)throw new AvAError('STALE_MENU','That menu is out of date. Open the slot menu again.');
    // Back from a maker's models (or a search) goes to the makers; from anything else, to the settings.
    if(choice.toLowerCase()==='b')return {menu:menu.phase==='model'&&(menu.context?.maker||menu.context?.query)?await this.show(pairId,seat,'model'):await this.show(pairId,seat)};
    if(choice.toLowerCase()==='x'){
      this.activation.cancel(pairId,seat);this.store.db.prepare('DELETE FROM menus WHERE pair_id=? AND seat=?').run(pairId,seat);
      return {menu:{...menu,id:randomUUID(),choices:[],text:`${seat.toUpperCase()} menu closed. Current state: ${this.store.pair(pairId).slots[seat].state}`}};
    }
    const index=Number(choice)-1,item=menu.choices[index];
    if(!Number.isInteger(index)||!item)throw new AvAError('INVALID_CHOICE','Choose a number from the displayed menu.');
    if(menu.phase==='home'){
      if(item.value==='activate'){
        if(!slot.config?.model)throw new AvAError('SELECT_MODEL','Select a model before activation.');
        const activation=await this.activation.activate(pairId,seat,slot.config);return {activation,menu:await this.show(pairId,seat)};
      }
      return {menu:await this.show(pairId,seat,item.value as Menu['phase'])};
    }
    // Permissions don't change the agent or its session: the gate reads them at each request.
    if(menu.phase==='permissions'){await this.setPermissions(pairId,seat,item.value as 'ask'|'bypass');return {menu:await this.show(pairId,seat)};}
    if(menu.phase==='gateway-key'){
      if(item.value.startsWith('create:'))await this.gateway?.createKey(Number(item.value.slice(7)));
      else if(item.value==='forget')this.gateway?.forgetKey();
      return {menu:await this.show(pairId,seat)};
    }
    if(menu.phase==='model'&&item.value.startsWith('maker:'))return {menu:await this.show(pairId,seat,'model',{maker:item.value.slice(6)})};
    if(menu.phase==='model'&&item.value.startsWith('page:'))return {menu:await this.show(pairId,seat,'model',{...menu.context,page:Number(item.value.slice(5))})};
    let config=slot.config??{provider:'codex',model:'',auth:'provider-login'} as ProviderConfig;
    // The Gateway has only API access.
    if(menu.phase==='provider'){config={provider:item.value as Provider,model:'',auth:item.value==='vercel'?'api':'provider-login'};}
    if(menu.phase==='model'){config={...config,model:item.value,effort:undefined,speed:undefined};}
    if(menu.phase==='auth'){config={...config,auth:item.value as ProviderConfig['auth']};}
    if(item.config)config=item.config;
    await this.activation.configure(pairId,seat,config);
    return {menu:await this.show(pairId,seat)};
  }
}
