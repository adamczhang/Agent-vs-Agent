import { createServer,type Server } from 'node:http';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { existsSync,readFileSync,writeFileSync,mkdirSync,unlinkSync } from 'node:fs';
import { join,resolve,extname } from 'node:path';
import { AvAService } from './service.js';
import { ZodError } from 'zod';
import { AvAError } from './types.js';

export async function listen(service:AvAService,webRoot:string,requestedPort=0):Promise<{server:Server;port:number;token:string;lastRequestAt():number;close():Promise<void>}>{
  const token=randomBytes(32).toString('hex');let port=0,lastRequest=Date.now();
  const server=createServer(async(req,res)=>{
    const host=`127.0.0.1:${port}`;
    const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(req.headers.host!==host){json(403,{error:'Invalid host'});return;}
    if(req.headers.origin&&req.headers.origin!==`http://${host}`){json(403,{error:'Origin not allowed'});return;}
    if(req.url==='/api'&&req.method==='POST'){
      const supplied=req.headers.authorization?.replace(/^Bearer /,'')??'';
      if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(token))){json(401,{error:'Authentication required'});return;}
      lastRequest=Date.now();
      try{
        const chunks:Buffer[]=[];let size=0;
        for await(const chunk of req){const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>12_500_000)throw new AvAError('BODY_TOO_LARGE','Request too large.');chunks.push(bytes);}
        const body=Buffer.concat(chunks).toString('utf8');
        const call=JSON.parse(body) as {method:string;params:unknown;version?:number};
        if(call.version!==undefined&&call.version!==1)throw new AvAError('SCHEMA_VERSION','Unsupported AvA command version.');
        if(typeof call.method!=='string')throw new AvAError('INVALID_REQUEST','A method is required.');
        json(200,{result:await service.call(call.method,call.params??{})});
      }catch(error){
        // A refusal AvA explains (409), a malformed request (400), or a failure of AvA itself (500), each said as such.
        const known=error instanceof AvAError,invalid=error instanceof ZodError||error instanceof SyntaxError;
        json(known?409:invalid?400:500,{error:error instanceof Error?error.message:'Request failed',code:known?error.code:invalid?'INVALID_REQUEST':'INTERNAL'});
      }return;
    }
    if(req.method!=='GET'){json(405,{error:'Method not allowed'});return;}
    let pathname:string;try{pathname=new URL(req.url??'/',`http://${host}`).pathname;}catch{json(400,{error:'Invalid URL'});return;}
    const relative=pathname==='/'?'index.html':pathname.replace(/^\//,'');
    const path=resolve(webRoot,relative);
    if(!path.startsWith(resolve(webRoot)+requireSeparator())||!existsSync(path)){json(404,{error:'Not found'});return;}
    try{
      const mime=extname(path)==='.js'?'text/javascript':extname(path)==='.css'?'text/css':'text/html';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-src http://127.0.0.1:* http://localhost:*; frame-ancestors 'none'"});res.end(readFileSync(path));
    }catch{json(404,{error:'Not found'});}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(requestedPort,'127.0.0.1',resolve);});
  const addr=server.address();if(!addr||typeof addr==='string')throw new Error('No local address');port=addr.port;
  mkdirSync(service.dataRoot,{recursive:true});
  const runtimeFile=join(service.dataRoot,'server.json');writeFileSync(runtimeFile,JSON.stringify({pid:process.pid,port,token,mode:service.mode}),{mode:0o600});
  return {server,port,token,lastRequestAt:()=>lastRequest,async close(){await service.shutdown();await new Promise<void>(resolve=>server.close(()=>resolve()));try{const current=JSON.parse(readFileSync(runtimeFile,'utf8'));if(current.pid===process.pid&&current.token===token)unlinkSync(runtimeFile);}catch{/* Another owner may already have replaced the rendezvous. */}}};
}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}
