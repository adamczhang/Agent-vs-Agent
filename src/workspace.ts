// Build mode: each agent works in its own copy of a project, inside its private workspace folder, so the two agents
// can't overwrite each other and the original is never touched.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { AvAError } from './types.js';

export const COPY_LIMITS = { files: 20_000, bytes: 500 * 1024 * 1024 };
// Folders that are rebuilt rather than reviewed, skipped when the project isn't a git repository.
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', '.pytest_cache', 'target', 'bin', 'obj', '.idea', '.vs']);

// The agent's workspace (its session's working folder); providers.ts opens each session there.
// A small project's text files, numbered by line, for a Review prompt. Agents that read files only through commands
// (Codex, whose commands Ask refuses) can then still review it. '' when the project is too big (over 40 files or 64 KB
// of text) or has nothing to show; git data, dependencies, links and binary files are left out.
export function inlineProject(dir: string, maxFiles = 40, maxBytes = 64_000) {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || ['.git', 'node_modules'].includes(entry.name)) continue;
      if (entry.isDirectory()) walk(path); else if (entry.isFile()) files.push(path);
      if (files.length > maxFiles) return;
    }
  };
  try { walk(''); } catch { return ''; }
  if (!files.length || files.length > maxFiles) return '';
  let total = 0; const parts: string[] = [];
  for (const path of files) {
    const bytes = readFileSync(join(dir, path));
    if (bytes.includes(0)) continue;
    total += bytes.length; if (total > maxBytes) return '';
    parts.push(`--- ${path} ---\n${bytes.toString('utf8').replace(/\r\n/g, '\n').split('\n').map((line, i) => `${String(i + 1).padStart(4)} | ${line}`).join('\n')}`);
  }
  return parts.join('\n\n');
}
export function participantWorkspace(dataRoot: string, scope: { pairId: string; seat: string; generation: number }) {
  return join(dataRoot, 'workspaces', scope.pairId, scope.seat, String(scope.generation));
}
const inside = (child: string, parent: string) => { const rel = relative(parent, child); return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel)); };
const same = (a: string) => process.platform === 'win32' ? a.toLowerCase() : a;

// A project folder the user may hand to the agents: an existing directory, not a drive root, not AvA's own data.
export function checkProject(path: string, dataRoot: string) {
  if (!path.trim() || !isAbsolute(path)) throw new AvAError('INVALID_PROJECT', 'Give the full path of the project folder, for example D:\\Projects\\my-app.');
  const full = resolve(path);
  if (!existsSync(full) || !statSync(full).isDirectory()) throw new AvAError('INVALID_PROJECT', `${full} is not a folder.`);
  if (parse(full).root === full) throw new AvAError('INVALID_PROJECT', 'Choose a project folder, not a whole drive.');
  if (inside(same(resolve(dataRoot)), same(full)) || inside(same(full), same(resolve(dataRoot)))) throw new AvAError('INVALID_PROJECT', 'That folder holds Agent vs Agent data. Choose a project folder.');
  return full;
}
// AvA's own git calls ignore anything that would run a program (a file-system monitor, hooks) and anything from the
// user's global setup that would stop or prompt (commit signing), and give up after two minutes.
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => spawnSync('git', ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'commit.gpgsign=false', ...args],
  { cwd, encoding: 'buffer', windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...(env ? { env } : {}) });
// The agent can write its copy's .git, so before AvA runs git there, the repository's own config must not name any
// program to run (filters, diff drivers, an fsmonitor, hooks, a pager) or pull in other config. Reading it as a file
// runs nothing.
const UNSAFE_GIT_CONFIG = /^\s*(?:\[\s*(?:filter|diff|merge|include|includeif)\b|(?:fsmonitor|hookspath|pager|editor|sshcommand|gitproxy|askpass|textconv|command|driver|process|clean|smudge)\s*=)/im;
function assertSafeRepository(copy: string) {
  const dotGit = join(copy, '.git');
  if (!existsSync(dotGit) || !statSync(dotGit).isDirectory()) throw new AvAError('NO_BASELINE', 'This copy has no baseline to compare with.');
  let config = ''; try { config = readFileSync(join(dotGit, 'config'), 'utf8'); } catch { /* no config */ }
  if (UNSAFE_GIT_CONFIG.test(config)) throw new AvAError('UNSAFE_REPOSITORY', 'The git settings in this copy were changed to run programs, so AvA won’t read its changes.');
}

// The files to copy: in a git repository, tracked and untracked-but-not-ignored files (so uncommitted work is
// included and build output isn't); otherwise everything except the usual generated folders.
function projectFiles(source: string) {
  const listed = git(source, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (listed.status === 0) return { git: true, files: listed.stdout.toString('utf8').split('\0').filter(Boolean).filter(f => existsSync(join(source, f))) };
  const files: string[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(join(source, dir), { withFileTypes: true })) {
    const rel = dir ? join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) { if (!SKIP.has(entry.name)) walk(rel); } else if (entry.isFile()) files.push(rel);
    if (files.length > COPY_LIMITS.files) throw new AvAError('PROJECT_TOO_LARGE', `More than ${COPY_LIMITS.files} files. Choose a smaller folder.`);
  } };
  walk('');
  return { git: false, files };
}

// Copies the project into target (which must not exist yet) and records a baseline commit there when git is available,
// so the agent's changes can be shown later. Returns what was copied.
// The copy is made in a temporary folder beside the target and renamed into place, so a copy that fails part-way leaves
// nothing behind (and a retry starts clean). Entries that aren't plain files (a nested repository or a submodule the
// git listing names as a folder, a link) are skipped.
export function copyProject(source: string, target: string) {
  if (existsSync(target)) throw new AvAError('COPY_EXISTS', `${target} already exists.`);
  const { git: isRepo, files } = projectFiles(source);
  if (files.length > COPY_LIMITS.files) throw new AvAError('PROJECT_TOO_LARGE', `More than ${COPY_LIMITS.files} files. Choose a smaller folder.`);
  const partial = `${target}.partial-${randomUUID().slice(0, 8)}`;
  let bytes = 0, copied = 0;
  try {
    mkdirSync(partial, { recursive: true });
    for (const file of files) {
      const from = join(source, file), info = lstatSync(from);
      if (!info.isFile()) continue;
      bytes += info.size;
      if (bytes > COPY_LIMITS.bytes) throw new AvAError('PROJECT_TOO_LARGE', `More than ${Math.round(COPY_LIMITS.bytes / 1048576)} MB. Choose a smaller folder.`);
      const to = join(partial, file); if (!inside(resolve(to), resolve(partial))) continue;
      mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); copied++;
    }
    renameSync(partial, target);
  } catch (error) { rmSync(partial, { recursive: true, force: true }); throw error; }
  return { files: copied, bytes, gitSource: isRepo, baseline: baselineCommit(target, 'Baseline copy'), name: basename(source) };
}
// Building from scratch: an empty folder, with an empty baseline commit so its changes show the same way.
export function startProject(target: string) {
  if (existsSync(target)) throw new AvAError('COPY_EXISTS', `${target} already exists.`);
  mkdirSync(target, { recursive: true });
  return { files: 0, bytes: 0, gitSource: false, baseline: baselineCommit(target, 'Empty start'), name: '' };
}
function baselineCommit(target: string, message: string) {
  return git(target, ['init', '-q']).status === 0 && git(target, ['add', '-A']).status === 0
    && git(target, ['-c', 'user.name=Agent vs Agent', '-c', 'user.email=ava@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', message]).status === 0;
}
// A folder name for one run's copy: the project name plus a short unique suffix.
export const copyFolder = (source: string, key: string) => `${basename(source).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'project'}-${key.replace(/[^\w]/g, '').slice(0, 8)}`;

export interface FileChange { path: string; status: 'added' | 'modified' | 'deleted' | 'changed'; added: number | null; removed: number | null }
const STATUS: Record<string, FileChange['status']> = { A: 'added', M: 'modified', D: 'deleted' };
const MAX_LISTED = 2000;
// What an agent changed in its copy since the baseline (the copy's first commit), new files included. It is compared
// through a temporary index, so the agent's own git state is untouched. Ignored files, such as build output, aren't
// listed. Binary files have no line counts.
export function projectChanges(copy: string, maxPatch = 400_000) {
  assertSafeRepository(copy);
  const roots = git(copy, ['rev-list', '--max-parents=0', 'HEAD']);
  const base = roots.status === 0 ? roots.stdout.toString('utf8').trim().split(/\s+/).pop() : undefined;
  if (!base) throw new AvAError('NO_BASELINE', 'This copy has no baseline to compare with.');
  const index = join(tmpdir(), `ava-index-${randomUUID()}`), env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    if (git(copy, ['add', '-A'], env).status !== 0) throw new AvAError('CHANGES_FAILED', 'Could not read the changes in this copy.');
    const diff = (args: string[]) => git(copy, ['diff', '--cached', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', ...args, base, '--'], env);
    const names = diff(['--name-status', '-z']).stdout.toString('utf8').split('\0'), counts = new Map<string, [number | null, number | null]>();
    for (const row of diff(['--numstat', '-z']).stdout.toString('utf8').split('\0')) {
      const [added, removed, ...path] = row.split('\t');
      if (path.length) counts.set(path.join('\t'), [added === '-' ? null : Number(added), removed === '-' ? null : Number(removed)]);
    }
    const files: FileChange[] = [];
    for (let i = 0; i + 1 < names.length; i += 2) {
      const path = names[i + 1]!, [added, removed] = counts.get(path) ?? [null, null];
      files.push({ path, status: STATUS[names[i]!.charAt(0)] ?? 'changed', added, removed });
    }
    const listed = files.slice(0, MAX_LISTED);
    // A very large change (say, installed packages that weren't ignored) gets its file list without the patch.
    const patch = files.length <= MAX_LISTED ? diff([]).stdout : Buffer.alloc(0);
    return {
      files: listed, totalFiles: files.length,
      added: files.reduce((n, f) => n + (f.added ?? 0), 0), removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
      patch: patch.subarray(0, maxPatch).toString('utf8'), truncated: patch.length > maxPatch || files.length > MAX_LISTED,
    };
  } finally { rmSync(index, { force: true }); rmSync(`${index}.lock`, { force: true }); }
}
export { inside as isInside, sep };
