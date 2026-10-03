import test from 'node:test';
import assert from 'node:assert/strict';
import {providerToolActivity} from '../src/providers.js';

test('Antigravity approval placeholders are attributed without suppressing genuine operation failures',()=>{
  const report='tool call (failed): Tool call was approved but never executed.';
  const warning=providerToolActivity('antigravity',report);
  assert.equal(warning.type,'status');assert.match(warning.text,/Antigravity approval warning/);assert.ok(warning.text.includes(report),'retain the original diagnostic');
  for(const text of ['tool call (failed): Permission denied','tool call (failed): Could not write index.html','tool call (completed): Create index HTML file'])assert.deepEqual(providerToolActivity('antigravity',text),{type:'tool',text});
  assert.deepEqual(providerToolActivity('claude',report),{type:'tool',text:report});
});
