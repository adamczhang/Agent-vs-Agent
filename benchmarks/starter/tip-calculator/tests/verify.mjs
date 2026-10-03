import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calcTip} from '../tip.js';
assert.deepEqual(calcTip(50,20,2),{tip:10,perPerson:30});
assert.deepEqual(calcTip(0,0,1),{tip:0,perPerson:0});
assert.ok(Math.abs(calcTip(12.5,12,3).perPerson-14/3)<1e-10);
for(const args of [[-1,10,1],[10,-1,1],[10,10,0],[10,10,1.5],[Infinity,10,1],[10,NaN,1],[10,10,Infinity]])assert.throws(()=>calcTip(...args));
assert.ok((readFileSync('index.html','utf8').match(/<input\b/gi)??[]).length>=3,'the page needs bill, percentage and people inputs');
console.log('Tip calculation, invalid inputs and page inputs passed.');
