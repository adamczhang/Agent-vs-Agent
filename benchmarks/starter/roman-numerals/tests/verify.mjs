import assert from 'node:assert/strict';
import {toRoman,fromRoman} from '../roman.js';
for(const [n,r] of [[1,'I'],[4,'IV'],[9,'IX'],[14,'XIV'],[40,'XL'],[90,'XC'],[400,'CD'],[1994,'MCMXCIV'],[2026,'MMXXVI'],[3999,'MMMCMXCIX']]){assert.equal(toRoman(n),r);assert.equal(fromRoman(r),n);}
for(let n=1;n<=3999;n++)assert.equal(fromRoman(toRoman(n)),n);
for(const bad of [0,4000,1.5,-3,NaN])assert.throws(()=>toRoman(bad),RangeError);
for(const bad of ['','IIII','VX','IC','mcm','MMMM','XIIII','ABC'])assert.throws(()=>fromRoman(bad),RangeError);
console.log('roman numerals passed');
