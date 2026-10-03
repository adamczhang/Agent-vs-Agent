const round=value=>Math.round(value*10)/10;
const check=value=>{if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError('Enter a finite number.');};
export function cToF(c){check(c);return round(c*9/5+32);}
export function fToC(f){check(f);return round((f-32)*5/9);}
