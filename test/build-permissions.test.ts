import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPermission, toolPermission } from '../src/providers.js';
import { tempDir } from './temp.js';

const request = (kind: string, rawInput: unknown, locations: Array<{ path: string }> = []) => ({ inferredKind: kind, raw: { toolCall: { kind, title: 'Tool request', rawInput, locations } } });
test('the incident command and every shell request stay refused even with a legitimate workspace path', () => {
  const workspace = tempDir('build-permission-');
  // These are strings passed to the permission decision, never executed.
  for (const command of ['Get-Process node | Stop-Process -Force', `Set-Location '${workspace}'; Get-Process node | Stop-Process -Force`, 'taskkill /F /IM node.exe', 'spps -Name node -Force', 'pwsh -EncodedCommand opaque', 'node script.js', 'npm test', 'echo harmless']) {
    for (const kind of ['execute', 'edit', 'fetch', 'other']) {
      const call = request(kind, { command, cwd: workspace }, [{ path: join(workspace, 'index.html') }]);
      const result = toolPermission(call, { workspace, internet: true, bypass: false });
      assert.equal(result.decision, undefined, `${kind}: ${command}`); assert.match(result.status!, /sandbox/);
    }
  }
});
test('alternate executable argument shapes, missing paths, unknown tools, and mode changes fail closed', () => {
  const root = tempDir('build-shapes-');
  for (const raw of [{ CommandLine: 'anything', path: root }, { script: 'anything', path: root }, { args: ['anything'], path: root }, { nested: { code: 'anything' }, path: root }, { program: 'node', path: root }]) assert.equal(buildPermission(request('edit', raw), root).decision, undefined);
  for (const call of [request('execute', {}), request('switch_mode', { path: root }), request('other', { path: root }), request('edit', {}), request('edit', { paths: [root, null] }), request('edit', 'unstructured')]) assert.equal(buildPermission(call, root).decision, undefined);
  let deep: unknown = { destination: 'outside' }; for (let n = 0; n < 10; n++) deep = { nested: deep };
  assert.equal(buildPermission(request('edit', { path: root, deep }), root).decision, undefined);
});
test('scoped typed files remain usable, while all source and destination paths must be inside', () => {
  const root = tempDir('build-files-'), outside = tempDir('build-outside-');
  for (const kind of ['read', 'edit', 'delete', 'move', 'search']) assert.equal(buildPermission(request(kind, { path: join(root, 'new.txt') }), root).decision?.outcome, 'allow_once');
  assert.equal(buildPermission(request('edit', { file_path: join(root, 'source.js'), content: 'Get-Process node | Stop-Process -Force' }), root).decision?.outcome, 'allow_once', 'writing text does not execute it');
  assert.equal(buildPermission(request('read', { uri: pathToFileURL(join(root, 'new.txt')).href }), root).decision?.outcome, 'allow_once');
  for (const raw of [{ source: join(root, 'a'), destination: join(outside, 'b') }, { path: join(root, 'a'), extra: [join(outside, 'b')] }, { uri: pathToFileURL(join(outside, 'b')).href }, { path: join(root, '.claude', 'settings.json') }]) assert.equal(buildPermission(request('edit', raw), root).decision, undefined);
});
test('junctions, symlinks, and hard links cannot make outside files appear scoped', () => {
  const root = tempDir('build-links-'), outside = tempDir('build-target-'); writeFileSync(join(outside, 'file.txt'), 'keep');
  symlinkSync(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(buildPermission(request('edit', { path: join(root, 'linked', 'file.txt') }), root).decision, undefined);
  linkSync(join(outside, 'file.txt'), join(root, 'hard.txt'));
  assert.equal(buildPermission(request('edit', { path: join(root, 'hard.txt') }), root).decision, undefined);
  mkdirSync(join(root, 'ordinary')); assert.equal(buildPermission(request('edit', { path: join(root, 'ordinary', 'new.txt') }), root).decision?.outcome, 'allow_once');
});
test('only an explicit Bypass setting preserves unrestricted execution approval', () => {
  const call = request('execute', { command: 'arbitrary command' });
  assert.equal(toolPermission(call, { internet: false, bypass: false, workspace: tempDir('build-bypass-') }).decision, undefined);
  assert.equal(toolPermission(call, { internet: false, bypass: true }).decision?.outcome, 'allow_once');
});
