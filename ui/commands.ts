interface Pending {signature:string;method:string;params:Record<string,unknown>;requestId:string}
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export class CommandClient {
  private pending:Pending|undefined;
  constructor(private storage:Storage,private key:string){try{this.pending=JSON.parse(storage.getItem(key)||'null')||undefined;}catch{this.pending=undefined;}}
  get draft(){return typeof this.pending?.params.text==='string'?this.pending.params.text:'';}
  get hasPending(){return !!this.pending;}
  async execute(signature:string,method:string,params:Record<string,unknown>,send:(method:string,params:unknown)=>Promise<unknown>){
    if(this.pending?.signature!==signature){this.pending={signature,method,params,requestId:crypto.randomUUID()};this.storage.setItem(this.key,JSON.stringify(this.pending));}
    const pending=this.pending;
    try{
      const result=await send(pending.method,{...pending.params,requestId:pending.requestId});
      if(this.pending===pending){this.pending=undefined;this.storage.removeItem(this.key);}return result;
    }catch(error){
      if(error instanceof Error&&'definitive' in error&&error.definitive&&this.pending===pending){this.pending=undefined;this.storage.removeItem(this.key);}
      throw error;
    }
  }
}
