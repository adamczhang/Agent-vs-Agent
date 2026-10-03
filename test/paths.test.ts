import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataRootFor } from '../src/paths.js';
import { tempDir } from './temp.js';

const root = (pkg: object, packagedPlugin = false) => {
  const dir = tempDir('ava-paths-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'agent-vs-agent', version: '0.0.0', ...pkg }));
  if (packagedPlugin) writeFileSync(join(dir, 'packaged.json'), '{}');
  return dir;
};

test('every host resolves the same shared data folder from config.dataDir, and AVA_DATA_DIR still overrides it', () => {
  const shared = join(tempDir('ava-shared-'), 'AvA-Data'), config = { config: { dataDir: shared } };
  // The dev checkout, the packaged Codex plugin, and the packaged Claude Code plugin all carry the same config.
  for (const dir of [root(config), root(config, true), root(config, true)]) assert.equal(dataRootFor(dir, {}), shared);
  // A packaged app's private LOCALAPPDATA (the Claude desktop app's MSIX redirection) doesn't move it.
  assert.equal(dataRootFor(root(config, true), { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local\\Packages\\Claude_x\\LocalCache\\Local' }), shared);
  assert.equal(dataRootFor(root(config, true), { AVA_DATA_DIR: 'throwaway' }), resolve('throwaway'));
});

test('without config.dataDir a checkout keeps .ava-data and a packaged plugin uses the home folder, never AppData', () => {
  const dev = root({});
  assert.equal(dataRootFor(dev, {}), join(dev, '.ava-data'));
  const home = process.platform === 'win32' ? { USERPROFILE: 'C:\\Users\\someone' } : { HOME: '/home/someone' };
  assert.equal(dataRootFor(root({}, true), { ...home, LOCALAPPDATA: 'C:\\Users\\someone\\AppData\\Local' }), join(Object.values(home)[0]!, 'AgentVsAgent'));
  // A relative config.dataDir is resolved against the package root, not the caller's working folder.
  const relative = root({ config: { dataDir: '../AvA-Data' } });
  assert.equal(dataRootFor(relative, {}), resolve(relative, '../AvA-Data'));
});
