import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package root is the nearest folder with package.json: this checkout in development, the plugin folder when packaged.
function findRoot() {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    if (dirname(dir) === dir) throw new Error('Agent vs Agent could not find its package root.');
  }
}
export const projectRoot = findRoot();
export const packageVersion = (JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as { version: string }).version;
// Whether version a (x.y.z) is newer than b. A missing or unreadable version counts as oldest.
export function newerVersion(a: string | undefined, b: string | undefined) {
  const parts = (v?: string) => { const p = (v ?? '').split(/[.+-]/); return [0, 1, 2].map(i => Number(p[i]) || 0); };
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}
// scripts/package.ts writes packaged.json into the plugin; its absence means a development checkout.
export const packaged = existsSync(join(projectRoot, 'packaged.json'));
// Data lives outside the install folder so upgrades and removal never delete runs or transcripts. Order:
// 1. AVA_DATA_DIR (tests, throwaway checks);
// 2. package.json "config.dataDir", when a build sets it (scripts/package.ts copies it into every packaged plugin);
// 3. otherwise .ava-data in a development checkout, or AgentVsAgent in the user's home folder when packaged
//    (%USERPROFILE%\AgentVsAgent on Windows).
// Every host (Codex, Claude Code) therefore resolves one folder: one service and one shared history. The home folder,
// not AppData, because packaged Windows apps such as the Claude desktop app redirect AppData into private storage.
// asPackaged: resolve as a plugin built from this root would (the scripts and tools that act on the installed plugins'
// data from a checkout: the Gateway key, the Antigravity override, a history import).
export function dataRootFor(root: string, env: NodeJS.ProcessEnv = process.env, asPackaged = existsSync(join(root, 'packaged.json'))) {
  // Absolute, so the MCP proxy and the service it starts (different working folders) agree on the same folder.
  if (env.AVA_DATA_DIR) return resolve(env.AVA_DATA_DIR);
  const configured = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { config?: { dataDir?: string } }).config?.dataDir;
  if (configured) return resolve(root, configured);
  if (!asPackaged) return join(root, '.ava-data');
  return join((process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir(), 'AgentVsAgent');
}
export function defaultDataRoot() { return dataRootFor(projectRoot); }
// The data folder the installed plugins use (built from this checkout), even when called from the checkout itself.
export function installedDataRoot(root = projectRoot) { return dataRootFor(root, process.env, true); }
export const MIN_NODE_MAJOR = 24;
export function assertNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) throw new Error(`Agent vs Agent needs Node.js ${MIN_NODE_MAJOR} or newer (found ${process.versions.node}). Install a current Node.js and restart Codex or Claude Code.`);
}
