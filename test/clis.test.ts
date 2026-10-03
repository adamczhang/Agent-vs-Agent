import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MINIMUM, installedCli, launchOf, versionAtLeast } from '../src/clis.js';
import { participantEnvironment } from '../src/providers.js';
import { tempDir } from './temp.js';

const json = (file: string) => JSON.parse(readFileSync(join('node_modules', file), 'utf8'));
test('the minimum CLI versions are the adapters’ own requirements', () => {
  assert.equal(MINIMUM.codex, String(json('@agentclientprotocol/codex-acp/package.json').dependencies['@openai/codex']).replace(/^[\^~>=]+/, ''), 'codex-acp’s @openai/codex range');
  assert.equal(MINIMUM.claude, json('@anthropic-ai/claude-agent-sdk/package.json').claudeCodeVersion, 'the Claude Agent SDK’s Claude Code version');
});

test('versions compare by number, not text', () => {
  assert.ok(versionAtLeast('0.159.1', '0.159.1'));
  assert.ok(versionAtLeast('0.160.0', '0.159.1'));
  assert.ok(versionAtLeast('2.1.287', '2.1.286'));
  assert.ok(!versionAtLeast('0.155.1', '0.159.1'));
  assert.ok(!versionAtLeast('0.99.0', '0.159.1'));
  assert.ok(versionAtLeast('1.0.0', '0.159.1'));
});

// A global npm install as npm lays it out: the shim beside node_modules/<package>, whose "bin" names the entry file.
function npmInstall(name: 'codex' | 'claude', version: string) {
  const dir = tempDir(`ava-cli-${name}-`), pkg = name === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code', entry = name === 'codex' ? 'bin/codex.js' : 'cli.js';
  const root = join(dir, 'node_modules', ...pkg.split('/'));
  mkdirSync(join(root, 'bin'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: pkg, bin: { [name]: entry } }));
  writeFileSync(join(root, entry), `console.log(${JSON.stringify(name === 'codex' ? `codex-cli ${version}` : `${version} (Claude Code)`)});\n`);
  writeFileSync(join(dir, process.platform === 'win32' ? `${name}.cmd` : name), '@rem npm shim\n');
  return { dir, entry: join(root, entry) };
}
test('an npm-installed CLI runs through its own entry file with Node, never through the shim', () => {
  const { dir, entry } = npmInstall('codex', '0.160.0');
  const launch = launchOf(join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex'), 'codex');
  assert.deepEqual(launch, { name: 'codex', command: process.execPath, args: [entry], path: entry });
  const native = join(tempDir('ava-cli-native-'), process.platform === 'win32' ? 'claude.exe' : 'claude');
  writeFileSync(native, Buffer.from([0x4d, 0x5a]));
  assert.deepEqual(launchOf(native, 'claude'), { name: 'claude', command: native, args: [], path: native }, 'a native binary starts directly');
});

test('the installed CLI is found on PATH and must meet the adapter’s minimum version', async () => {
  const pathOf = (dir: string) => ({ PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' });
  const current = npmInstall('codex', '0.170.2'), old = npmInstall('claude', '2.0.1');
  const codex = await installedCli('codex', pathOf(current.dir));
  assert.deepEqual([codex.version, codex.command, codex.args], ['0.170.2', process.execPath, [current.entry]]);
  await assert.rejects(installedCli('claude', pathOf(old.dir)), /Claude Code 2\.0\.1 is older than AvA needs \(2\.1\.286 or newer\)\. Update it: claude update/);
  await assert.rejects(installedCli('codex', pathOf(tempDir('ava-cli-none-'))), /Codex isn't installed \(no `codex` on PATH/);
});

test('Codex agents start the installed CLI with integrations disabled; Claude agents are given the installed CLI', () => {
  const data = tempDir('ava-cli-env-'), cli = { command: process.execPath, args: ['C:\\tools\\codex\\bin\\codex.js'], path: 'C:\\tools\\codex\\bin\\codex.js' };
  const env = participantEnvironment('codex', {}, data, false, undefined, cli), wrapper = readFileSync(env.CODEX_PATH!, 'utf8');
  assert.ok(wrapper.includes(cli.args[0]!) && wrapper.includes('--disable plugins --disable apps --disable remote_plugin --disable hooks'), wrapper);
  assert.throws(() => participantEnvironment('codex', {}, data, false), /Codex isn’t installed/, 'never the adapter’s fallback copy');
  const claude=participantEnvironment('claude', {}, data, false, undefined, { command: 'C:\\x\\claude.exe', args: [], path: 'C:\\x\\claude.exe' });
  assert.match(readFileSync(claude.CLAUDE_CODE_EXECUTABLE!, 'utf8'), /--strict-mcp-config/);
});
