import { parentPort,workerData } from 'node:worker_threads';
const {pattern,flags,text}=workerData as {pattern:string;flags?:string;text:string};
try{parentPort!.postMessage({passed:new RegExp(pattern,flags).test(text)});}catch{parentPort!.postMessage({passed:false,error:'Invalid regular expression'});}
