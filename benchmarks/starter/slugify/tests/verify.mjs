import assert from 'node:assert/strict';
import {slugify} from '../slugify.js';
assert.equal(slugify('Hello, World!'),'hello-world');
assert.equal(slugify('  Crème Brûlée  recipe '),'creme-brulee-recipe');
assert.equal(slugify('---already--slugged---'),'already-slugged');
assert.equal(slugify('Version 2.0 (beta)'),'version-2-0-beta');
assert.equal(slugify('!!!'),'');
assert.throws(()=>slugify(42),TypeError);
console.log('slugify passed');
