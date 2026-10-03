import assert from 'node:assert/strict';
import {topWords} from '../words.js';
assert.deepEqual(topWords('The cat and the hat. THE end!',2),[['the',3],['and',1]]);
assert.deepEqual(topWords("Don't stop; don't quit. 'Stop' now.",3),[["don't",2],['stop',2],['now',1]]);
assert.deepEqual(topWords('b a c b a',5),[['a',2],['b',2],['c',1]]);
assert.deepEqual(topWords('',3),[]);
for(const bad of [0,-1,1.5,'2'])assert.throws(()=>topWords('a',bad),RangeError);
console.log('word frequency passed');
