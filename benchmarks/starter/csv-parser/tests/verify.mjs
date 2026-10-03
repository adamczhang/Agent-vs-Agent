import assert from 'node:assert/strict';
import {parseCsv} from '../csv.js';
assert.deepEqual(parseCsv(''),[]);
assert.deepEqual(parseCsv('a,b,c'),[['a','b','c']]);
assert.deepEqual(parseCsv('name,qty\r\npen,2\r\n'),[['name','qty'],['pen','2']]);
assert.deepEqual(parseCsv('"Smith, Jo",42\n"say ""hi""",x'),[['Smith, Jo','42'],['say "hi"','x']]);
assert.deepEqual(parseCsv('"line one\nline two",end\n'),[['line one\nline two','end']]);
assert.deepEqual(parseCsv('a,,c\n,\n'),[['a','','c'],['','']]);
console.log('csv parser passed');
