// The user's own Codex and Claude Code. AvA's ACP adapters drive these installed CLIs (found on PATH) rather than the
// copies the adapters bundle: the user has them installed and signed in anyway, as with Grok Build and Antigravity, and
// leaving the bundled copies out makes the plugin about 660 MB smaller. Each adapter needs a minimum CLI version.
import { execFile } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { AvAError } from './types.js';

export type CliName = 'codex' | 'claude';
// command + args start the CLI; path is what an adapter that takes a single path is given (a .js entry runs with Node).
export interface InstalledCli { name: CliName; command: string; args: string[]; path: string; version: string }
// Kept equal to the adapters' own requirements (test/clis.test.ts checks): @agentclientprotocol/codex-acp depends on
// @openai/codex ^0.159.1, and @anthropic-ai/claude-agent-sdk declares claudeCodeVersion 2.1.286.
export const MINIMUM: Record<CliName, string> = { codex: '0.159.1', claude: '2.1.286' };
const CLI: Record<CliName, { label: string; npmPackage: string; install: string; update: string }> = {
  codex: { label: 'Codex', npmPackage: '@openai/codex', install: 'npm install -g @openai/codex, then sign in', update: 'npm install -g @openai/codex@latest' },
  claude: { label: 'Claude Code', npmPackage: '@anthropic-ai/claude-code', install: 'see https://claude.com/claude-code, then sign in', update: 'claude update' },
};

// The first file named like the command in a PATH folder (Windows: with a PATHEXT extension, or none).
export function findOnPath(name: string, env: NodeJS.ProcessEnv = process.env) {
  const extensions = process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase())] : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const file = join(dir, name + ext);
      try { if (statSync(file).isFile()) return file; } catch { /* not here */ }
    }
  }
  return undefined;
}
// How to start what PATH found: a native executable directly; an npm shim (Windows .cmd/.ps1 or a script) through the
// package's own entry file, run with this Node. A .cmd can't be started without a shell, so it is never run itself.
export function launchOf(found: string, name: CliName): Omit<InstalledCli, 'version'> | undefined {
  const real = realpathSync(found), ext = extname(real).toLowerCase();
  if (/^\.(js|mjs|cjs)$/.test(ext)) return { name, command: process.execPath, args: [real], path: real };
  if (process.platform === 'win32' ? ext === '.exe' : !/^\.(cmd|ps1|sh)$/.test(ext) && !isScript(real)) return { name, command: real, args: [], path: real };
  // npm's global layout: the shim sits beside node_modules/<package> (Windows), or links into it (elsewhere).
  const manifest = join(dirname(found), 'node_modules', CLI[name].npmPackage, 'package.json');
  if (!existsSync(manifest)) return undefined;
  const bin = (JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> }).bin;
  const entry = typeof bin === 'string' ? bin : bin?.[name];
  if (!entry) return undefined;
  const file = join(dirname(manifest), entry);
  return existsSync(file) ? launchOf(file, name) : undefined;
}
// A script starts with "#!" (only its first bytes are read: the native CLIs are hundreds of megabytes).
function isScript(file: string) {
  try { const fd = openSync(file, 'r'), head = Buffer.alloc(2); try { readSync(fd, head, 0, 2, 0); } finally { closeSync(fd); } return head.toString() === '#!'; } catch { return false; }
}

export const versionAtLeast = (version: string, minimum: string) => {
  const a = version.split('.').map(Number), b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
const run = promisify(execFile);
const versions = new Map<string, string>();
// The installed CLI, checked against the adapter's minimum version. The version is read once per file (and change).
export async function installedCli(name: CliName, env: NodeJS.ProcessEnv = process.env): Promise<InstalledCli> {
  const { label, install, update } = CLI[name];
  const found = findOnPath(name, env), launch = found ? launchOf(found, name) : undefined;
  if (!launch) throw new AvAError('MISSING_PROVIDER', `${label} isn't installed (no \`${name}\` on PATH that AvA can start). Install it (${install}).`);
  const key = `${launch.path}:${statSync(launch.path).mtimeMs}`;
  let version = versions.get(key);
  if (!version) {
    const { stdout } = await run(launch.command, [...launch.args, '--version'], { windowsHide: true, timeout: 30_000 }).catch(() => ({ stdout: '' }));
    version = /\d+\.\d+\.\d+/.exec(stdout)?.[0];
    if (!version) throw new AvAError('MISSING_PROVIDER', `${label} at ${launch.path} didn't report its version.`);
    versions.set(key, version);
  }
  if (!versionAtLeast(version, MINIMUM[name])) throw new AvAError('PROVIDER_TOO_OLD', `${label} ${version} is older than AvA needs (${MINIMUM[name]} or newer). Update it: ${update}`);
  return { ...launch, version };
}
