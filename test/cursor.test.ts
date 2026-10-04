import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURSOR_SETTINGS, cursorArgv, cursorConfigDir, cursorEntry, cursorPlanRefusal, cursorTier } from '../src/cursor.js';
import { participantEnvironment } from '../src/providers.js';
import { ActivationManager, type ConfiguredParticipant } from '../src/activation.js';
import { Store } from '../src/store.js';
import type { ProviderConfig } from '../src/types.js';
import { FakeClock, FakeParticipant, flush } from './fakes.js';
import { tempDir } from './temp.js';

// An install like Cursor's: the shim on PATH, and version folders each with their own Node and entry file.
function install(versions: string[]) {
  const root = tempDir('ava-cursor-install-'), shim = join(root, 'cursor-agent.cmd');
  writeFileSync(shim, '@echo off\r\n');
  for (const version of versions) {
    const dir = join(root, 'versions', version); mkdirSync(dir, { recursive: true });
    for (const file of ['node.exe', 'node', 'index.js']) writeFileSync(join(dir, file), '');
  }
  mkdirSync(join(root, 'versions', 'not-a-version'), { recursive: true });
  return { root, shim };
}

test('Cursor starts through the newest installed version\'s own Node and entry file, never its .cmd shim', () => {
  const { root, shim } = install(['2026.09.28-64d2043', '2026.10.1-aaaa111', '2026.10.01-05-00-00-bbbb222', '2026.9.30-cccc333']);
  const found = cursorEntry(shim)!;
  assert.equal(found.version, '2026.10.01-05-00-00-bbbb222', 'the date, then the build time, decides');
  assert.equal(found.entry, join(root, 'versions', found.version, 'index.js'));
  assert.deepEqual(cursorArgv([shim, 'acp']), [found.node, found.entry, 'acp']);
  assert.deepEqual(cursorArgv(['C:\\Tools\\grok.exe', 'agent']), ['C:\\Tools\\grok.exe', 'agent'], 'other commands pass through');
  assert.equal(cursorEntry(install([]).shim), undefined, 'no version installed: no launch');
});

test('AvA\'s Cursor agents run with their own settings: nothing runs without asking, web searches ask, no commit attribution', () => {
  const data = tempDir('ava-cursor-config-'), dir = cursorConfigDir(data), file = join(dir, 'cli-config.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, ...CURSOR_SETTINGS });
  // What the agent saves there itself (its model) stays; the settings AvA depends on are put back.
  writeFileSync(file, JSON.stringify({ version: 1, model: { modelId: 'composer-2.5' }, permissions: { allow: ['Shell(ls)'], deny: [] }, approvalMode: 'auto', autoAcceptWebSearch: true, attribution: { attributeCommitsToAgent: true } }));
  cursorConfigDir(data);
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.model, { modelId: 'composer-2.5' });
  assert.deepEqual([saved.permissions.allow, saved.approvalMode, saved.autoAcceptWebSearch, saved.attribution.attributeCommitsToAgent], [[], 'allowlist', false, false]);
  const env = participantEnvironment('cursor', {}, data);
  assert.deepEqual([env.CURSOR_CONFIG_DIR, env.CURSOR_INVOKED_AS, env.AVA_PARTICIPANT], [dir, 'cursor-agent', '1']);
  assert.equal(participantEnvironment('grok-build', {}, data).CURSOR_CONFIG_DIR, undefined, 'only Cursor gets them');
});

test('Cursor\'s plan refusal and plan tier are read from its own words', () => {
  assert.match(cursorPlanRefusal('\n\nUpgrade your plan to continue')!, /plan doesn't cover agent requests/);
  assert.equal(cursorPlanRefusal('AVA_READY_x'), undefined);
  assert.equal(cursorTier('About Cursor CLI\n\nSubscription Tier   Free\nOS   win32'), 'Free');
  assert.equal(cursorTier('nothing here'), undefined);
});

test('a Cursor activation refused for its plan says so, instead of a missing readiness marker', async () => {
  const config: ProviderConfig = { provider: 'cursor', model: 'composer-2.5[fast=true]', auth: 'provider-login' };
  const store = new Store(':memory:'), pair = store.createPair('cursor-plan'), agent = new FakeParticipant('cursor-1') as FakeParticipant & ConfiguredParticipant;
  agent.accepted = config; agent.evidence = 'fake';
  const manager = new ActivationManager(store, { open: async () => agent }, new FakeClock(), 1000);
  const pending = manager.activate(pair.id, 'cli1', config).catch((error: Error & { code?: string }) => error);
  await flush(); agent.raw('\n\nUpgrade your plan to continue');
  const error = await pending as Error & { code?: string };
  assert.equal(error.code, 'PROVIDER_PLAN'); assert.match(error.message, /Upgrade the plan, or sign in with another account/);
  assert.equal(store.pair(pair.id).slots.cli1.state, 'failed');
  await manager.closeAll(); store.close();
});
