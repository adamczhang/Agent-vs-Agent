// Build mode: each agent works in its own copy of a project, inside its private workspace folder, so the two agents
// can't overwrite each other and the original is never touched.
import { closeSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { AvAError, type PlantedBug } from './types.js';
import { count, plantBugs } from './bug-hunt.js';

export const COPY_LIMITS = { files: 20_000, bytes: 500 * 1024 * 1024 };
// Folders that are rebuilt rather than reviewed, skipped when the project isn't a git repository.
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', 'venv', '__pycache__', '.pytest_cache', 'target', 'bin', 'obj', '.idea', '.vs']);

// The agent's workspace (its session's working folder); providers.ts opens each session there.
// Files that commonly hold secrets: environment files (their examples aside), private keys and certificates, and
// credential files. A Review prompt names them but leaves their contents in the agent's copy.
const SECRET_FILE = /^\.env(?!\.(?:example|sample|template)$)(?:\..+)?$|\.(?:pem|key|p12|pfx|jks|keystore|ppk)$|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|^(?:\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials(?:\.json)?)$/i;
// A small project's text files, numbered by line, for a Review prompt. Agents that read files only through commands
// (Codex, whose commands Ask refuses) can then still review it. '' when the project is too big (over 40 files or 64 KB
// of text), has nothing to show, or can't be read. Left out: git data, dependencies and build output, links, binary
// files, and files that may hold secrets (listed by name).
export function inlineProject(dir: string, maxFiles = 40, maxBytes = 64_000) {
  const files: string[] = [], secrets: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || entry.isDirectory() && SKIP.has(entry.name)) continue;
      if (entry.isDirectory()) walk(path); else if (entry.isFile()) (SECRET_FILE.test(entry.name) ? secrets : files).push(path);
      if (files.length > maxFiles) return;
    }
  };
  try {
    walk('');
    if (!files.length || files.length > maxFiles) return '';
    let total = 0; const parts: string[] = [];
    for (const path of files) {
      // The size first, so a large file is never read whole just to find it is too big. A binary file (a NUL byte in
      // its first 8 KB) is skipped whatever its size.
      const file = join(dir, path), size = statSync(file).size, head = Buffer.alloc(Math.min(size, 8192)), fd = openSync(file, 'r');
      try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
      if (head.includes(0)) continue;
      total += size; if (total > maxBytes) return '';
      parts.push(`--- ${path} ---\n${readFileSync(file).toString('utf8').replace(/\r\n/g, '\n').split('\n').map((line, i) => `${String(i + 1).padStart(4)} | ${line}`).join('\n')}`);
    }
    if (secrets.length) parts.push(`(Not shown here because they may hold secrets: ${secrets.join(', ')}.)`);
    return parts.join('\n\n');
  } catch { return ''; }
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
export const GIT_FLAGS = ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'commit.gpgsign=false'];
export const GIT_OPTIONS = { encoding: 'buffer' as const, windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 };
const git = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => spawnSync('git', [...GIT_FLAGS, ...args], { cwd, ...GIT_OPTIONS, ...(env ? { env } : {}) });
// The same, without blocking the service while git hashes a large copy (the Changes view, Q6).
const gitAsync = (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => new Promise<{ status: number; stdout: Buffer }>(done => {
  execFile('git', [...GIT_FLAGS, ...args], { cwd, ...GIT_OPTIONS, ...(env ? { env } : {}) }, (error, stdout) => done({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? '') }));
});
// AvA's record of a copy's baseline: a bare repository outside the agent's workspace, cloned from the copy's first
// commit before the agent starts. The agent can rewrite its copy's own .git (settings, worktree settings, a filter that
// names a program, hooks), so AvA's git never opens that repository: it reads the copy's files as a work tree only.
export function participantBaseline(dataRoot: string, scope: { pairId: string; seat: string; generation: number }, folder: string) {
  return join(dataRoot, 'baselines', scope.pairId, scope.seat, String(scope.generation), `${folder}.git`);
}
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// A copy made before AvA kept its own baseline: the commit its HEAD names, read from the copy's files as text (reading
// runs nothing; its objects are then only read as data).
function copyHead(dotGit: string) {
  let value = readFileSync(join(dotGit, 'HEAD'), 'utf8').trim();
  for (let depth = 0; value.startsWith('ref:') && depth < 5; depth++) {
    const name = value.slice(4).trim();
    if (!/^refs\/[\w./-]+$/.test(name) || name.split('/').includes('..')) return undefined;
    const loose = join(dotGit, name);
    if (existsSync(loose)) value = readFileSync(loose, 'utf8').trim();
    else { try { value = readFileSync(join(dotGit, 'packed-refs'), 'utf8').split(/\r?\n/).find(line => line.endsWith(` ${name}`))?.split(' ')[0] ?? ''; } catch { return undefined; } }
  }
  return OBJECT_ID.test(value) ? value : undefined;
}
// Git's own variables (GIT_DIR and the like) from the service's environment never reach these calls.
export const gitEnv = (extra: Record<string, string>) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))), ...extra });

// The files to copy: in a git repository, tracked and untracked-but-not-ignored files (so uncommitted work is
// included and build output isn't); otherwise everything except the usual generated folders.
function projectFiles(source: string) {
  const listed = git(source, ['ls-files', '-co', '--exclude-standard', '-z']);
  if (listed.status === 0) {
    const files = listed.stdout.toString('utf8').split('\0').filter(Boolean).filter(f => existsSync(join(source, f)));
    // Nothing listed in a folder that has files: it's inside a repository that ignores it (a home folder's dotfiles
    // repository, another project's build/). It's copied like a folder outside git instead of empty (Q6).
    if (files.length || !readdirSync(source).some(name => name.toLowerCase() !== '.git')) return { git: true, files };
  }
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
// A bug hunt's copy (H2): one commit of the repository instead of its folder as it is, files and folders left out, and
// bugs planted before the baseline.
// A hunt may also take only some folders (a slice, H7), and its repository may be AvA's cache of one on the web (bare).
export interface CopyOptions { commit?: string; exclude?: string[]; include?: string[]; plant?: PlantedBug[]; bare?: boolean }
// Whether a file is one of these paths or inside one of them.
export const within = (file: string, paths: string[]) => {
  const path = file.replace(/\\/g, '/').toLowerCase();
  return paths.some(e => { const part = e.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '').toLowerCase(); return !!part && (path === part || path.startsWith(`${part}/`)); });
};
// The files a copy takes: none of those left out and, with a slice, only those in it.
export const taken = (file: string, exclude: string[] = [], include: string[] = []) => !within(file, exclude) && (!include.length || within(file, include));
// AvA's cache of a repository on the web holds only the files its copies take, and git never fetches another one
// behind AvA's back. Its copies are the same on every computer: line endings as stored, links as plain files, and
// large-file pointers left as they are.
export const CACHE_ENV = { GIT_NO_LAZY_FETCH: '1' };
const CACHE_FLAGS = ['-c', 'core.autocrlf=false', '-c', 'core.symlinks=false', '-c', 'filter.lfs.smudge=', '-c', 'filter.lfs.process=', '-c', 'filter.lfs.required=false'];
// One commit's files, written into folder through a temporary index: nothing in the repository is written, and the
// copy holds no history. The commit is a hash, so it can't be read as an option. A bare repository (AvA's cache) is
// read with folder as its work tree.
function commitFiles(source: string, commit: string, folder: string, exclude: string[], include: string[] = [], bare = false) {
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new AvAError('HUNT_COMMIT', 'A commit is its hash (7 to 64 hexadecimal characters).');
  const index = join(tmpdir(), `ava-commit-index-${randomUUID()}`), env = gitEnv({ GIT_INDEX_FILE: index, ...(bare ? CACHE_ENV : {}) });
  const at = bare ? [`--git-dir=${source}`, `--work-tree=${folder}`] : [], cwd = bare ? folder : source;
  try {
    if (git(cwd, [...at, 'read-tree', commit], env).status !== 0) throw new AvAError('HUNT_COMMIT', `${source} has no commit ${commit}. Choose the repository it belongs to, or another commit.`);
    const files = git(cwd, [...at, 'ls-files', '-z'], env).stdout.toString('utf8').split('\0').filter(Boolean).filter(f => taken(f, exclude, include));
    if (files.length > COPY_LIMITS.files) throw new AvAError('PROJECT_TOO_LARGE', `More than ${COPY_LIMITS.files} files. Choose a smaller folder.`);
    const checkout = bare ? [...CACHE_FLAGS, ...at, 'checkout-index', '-z', '--stdin', '-f'] : ['checkout-index', '-z', '--stdin', '-f', `--prefix=${folder.replace(/\\/g, '/')}/`];
    const written = spawnSync('git', [...GIT_FLAGS, ...checkout], { cwd, ...GIT_OPTIONS, env, input: Buffer.from(files.join('\0')) });
    if (written.status !== 0) throw new AvAError('COPY_FAILED', `Could not copy commit ${commit} of ${source}.`);
    return files.filter(f => existsSync(join(folder, f)));
  } finally { rmSync(index, { force: true }); rmSync(`${index}.lock`, { force: true }); }
}
// A Bug hunt's repository, checked before the hunt is saved (H3): its current commit, whether the chosen commit is there,
// what a copy would hold, and whether each planted bug's original code appears exactly once where the copy takes it
// from. It only reads the repository.
export type BugCheck = 'ok' | 'missing' | 'ambiguous' | 'no-file' | 'excluded';
// A bare repository is AvA's cache of one on the web (H7), whose own HEAD means nothing; it holds the copies' files.
export function checkHunt(source: string, options: { commit?: string; exclude?: string[]; include?: string[]; bugs?: Array<{ file: string; find: string }>; bare?: boolean } = {}) {
  const exclude = options.exclude ?? [], include = options.include ?? [], env = options.bare ? gitEnv(CACHE_ENV) : undefined;
  const current = options.bare ? undefined : git(source, ['rev-parse', 'HEAD']), head = current?.status === 0 ? current.stdout.toString('utf8').trim() : null;
  let commitFound: boolean | null = null, files = 0, bytes = 0;
  if (options.commit) {
    if (!/^[0-9a-f]{7,64}$/i.test(options.commit)) throw new AvAError('HUNT_COMMIT', 'A commit is its hash (7 to 64 hexadecimal characters).');
    commitFound = git(source, ['cat-file', '-e', `${options.commit}^{commit}`], env).status === 0;
    if (commitFound) for (const row of git(source, ['ls-tree', '-r', '-l', '-z', options.commit], env).stdout.toString('utf8').split('\0')) {
      const m = row.match(/^\S+ blob \S+\s+(\d+|BAD)\t([\s\S]*)$/); if (m && taken(m[2]!, exclude, include)) { files++; bytes += Number(m[1]) || 0; }
    }
  } else for (const file of projectFiles(source).files.filter(f => taken(f, exclude, include))) { files++; try { bytes += lstatSync(join(source, file)).size; } catch { /* gone */ } }
  const bugs = (options.bugs ?? []).map((bug): BugCheck => {
    if (!taken(bug.file, exclude, include)) return 'excluded';
    let text: string | null = null;
    if (options.commit) { if (commitFound) { const shown = git(source, ['show', `${options.commit}:${bug.file.replace(/\\/g, '/').replace(/^\.\//, '')}`], env); text = shown.status === 0 ? shown.stdout.toString('utf8') : null; } }
    else { const full = resolve(source, bug.file); if (inside(full, resolve(source))) try { text = readFileSync(full, 'utf8'); } catch { /* not there */ } }
    if (text === null) return 'no-file';
    const n = count(text, text.includes('\r\n') ? bug.find.replace(/\r?\n/g, '\r\n') : bug.find);
    return n === 1 ? 'ok' : n ? 'ambiguous' : 'missing';
  });
  return { head, commitFound, files, bytes, bugs };
}
export function copyProject(source: string, target: string, history?: string, options: CopyOptions = {}) {
  if (existsSync(target)) throw new AvAError('COPY_EXISTS', `${target} already exists.`);
  const exclude = options.exclude ?? [], include = options.include ?? [];
  const listed = options.commit ? undefined : projectFiles(source), files = listed ? listed.files.filter(f => taken(f, exclude, include)) : [];
  if (files.length > COPY_LIMITS.files) throw new AvAError('PROJECT_TOO_LARGE', `More than ${COPY_LIMITS.files} files. Choose a smaller folder.`);
  const isRepo = listed ? listed.git : true, partial = `${target}.partial-${randomUUID().slice(0, 8)}`;
  let bytes = 0, copied = 0, planted: PlantedBug[] | undefined;
  try {
    mkdirSync(partial, { recursive: true });
    if (options.commit) for (const file of commitFiles(source, options.commit, partial, exclude, include, options.bare)) {
      bytes += lstatSync(join(partial, file)).size; copied++;
      if (bytes > COPY_LIMITS.bytes) throw new AvAError('PROJECT_TOO_LARGE', `More than ${Math.round(COPY_LIMITS.bytes / 1048576)} MB. Choose a smaller folder.`);
    }
    for (const file of files) {
      const from = join(source, file), info = lstatSync(from);
      if (!info.isFile()) continue;
      bytes += info.size;
      if (bytes > COPY_LIMITS.bytes) throw new AvAError('PROJECT_TOO_LARGE', `More than ${Math.round(COPY_LIMITS.bytes / 1048576)} MB. Choose a smaller folder.`);
      const to = join(partial, file); if (!inside(resolve(to), resolve(partial))) continue;
      mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); copied++;
    }
    // Planted before the baseline, so the seeded code is where both agents start.
    if (options.plant?.length) planted = plantBugs(partial, options.plant);
    renameSync(partial, target);
  } catch (error) { rmSync(partial, { recursive: true, force: true }); throw error; }
  return { files: copied, bytes, gitSource: isRepo, baseline: baselineCommit(target, 'Baseline copy', history), name: basename(source), ...(planted ? { planted } : {}) };
}
// Building from scratch: an empty folder, with an empty baseline commit so its changes show the same way.
export function startProject(target: string, history?: string) {
  if (existsSync(target)) throw new AvAError('COPY_EXISTS', `${target} already exists.`);
  mkdirSync(target, { recursive: true });
  return { files: 0, bytes: 0, gitSource: false, baseline: baselineCommit(target, 'Empty start', history), name: '' };
}
// The copy's own repository (the agent may use git there) with its first commit, then AvA's record of that commit
// (history), cloned while the copy's .git is still the one AvA just made.
function baselineCommit(target: string, message: string, history?: string) {
  const committed = git(target, ['init', '-q']).status === 0 && git(target, ['add', '-A']).status === 0
    && git(target, ['-c', 'user.name=Agent vs Agent', '-c', 'user.email=ava@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', message]).status === 0;
  if (!committed || !history) return committed;
  rmSync(history, { recursive: true, force: true }); mkdirSync(dirname(history), { recursive: true });
  return git(dirname(history), ['clone', '--bare', '--no-hardlinks', '-q', target, history], gitEnv({})).status === 0;
}
// A folder name for one run's copy: the project name plus a short unique suffix.
export const copyFolder = (source: string, key: string) => `${basename(source).replace(/[^\w.-]+/g, '-').slice(0, 40) || 'project'}-${key.replace(/[^\w]/g, '').slice(0, 8)}`;

export interface FileChange { path: string; status: 'added' | 'modified' | 'deleted' | 'changed'; added: number | null; removed: number | null }
const STATUS: Record<string, FileChange['status']> = { A: 'added', M: 'modified', D: 'deleted' };
const MAX_LISTED = 2000;
// What an agent changed in its copy since the baseline, new files included. Git runs in a scratch repository of AvA's
// own (its settings, a temporary index), which reads the baseline's objects from history (AvA's record, see
// participantBaseline) or, for a copy made before that record existed, from the copy's own object store as data. The
// copy is only its work tree, so the agent's git state is untouched and its git settings never apply. Ignored files,
// such as build output, aren't listed. Binary files have no line counts.
export async function projectChanges(copy: string, history?: string, maxPatch = 400_000) {
  const scratch = mkdtempSync(join(tmpdir(), 'ava-changes-')), repo = join(scratch, 'repo.git'), env = gitEnv({ GIT_INDEX_FILE: join(scratch, 'index') });
  const noBaseline = () => new AvAError('NO_BASELINE', 'This copy has no baseline to compare with.');
  try {
    let objects: string, head: string | undefined;
    if (history && existsSync(history)) {
      const named = await gitAsync(scratch, [`--git-dir=${history}`, 'rev-parse', 'HEAD'], gitEnv({}));
      objects = join(history, 'objects'); head = named.status === 0 ? named.stdout.toString('utf8').trim() : undefined;
    } else {
      const dotGit = join(copy, '.git');
      if (!existsSync(dotGit) || !statSync(dotGit).isDirectory()) throw noBaseline();
      objects = join(dotGit, 'objects'); head = copyHead(dotGit);
    }
    if (!head || !OBJECT_ID.test(head)) throw noBaseline();
    if ((await gitAsync(scratch, ['init', '--bare', '-q', '--template=', `--object-format=${head.length === 64 ? 'sha256' : 'sha1'}`, repo], gitEnv({}))).status !== 0) throw new AvAError('CHANGES_FAILED', 'Could not read the changes in this copy.');
    mkdirSync(join(repo, 'objects', 'info'), { recursive: true });
    writeFileSync(join(repo, 'objects', 'info', 'alternates'), `${objects.replaceAll('\\', '/')}\n`);
    const run = (args: string[]) => gitAsync(copy, [`--git-dir=${repo}`, `--work-tree=${copy}`, ...args], env);
    // The baseline is the first commit (the copy's own history may have grown since).
    const roots = await run(['rev-list', '--max-parents=0', head]);
    const base = roots.status === 0 ? roots.stdout.toString('utf8').trim().split(/\s+/).pop() : undefined;
    if (!base) throw noBaseline();
    if ((await run(['add', '-A'])).status !== 0) throw new AvAError('CHANGES_FAILED', 'Could not read the changes in this copy.');
    const diff = (args: string[]) => run(['diff', '--cached', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', ...args, base, '--']);
    const names = (await diff(['--name-status', '-z'])).stdout.toString('utf8').split('\0'), counts = new Map<string, [number | null, number | null]>();
    for (const row of (await diff(['--numstat', '-z'])).stdout.toString('utf8').split('\0')) {
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
    const patch = files.length <= MAX_LISTED ? (await diff([])).stdout : Buffer.alloc(0);
    return {
      files: listed, totalFiles: files.length,
      added: files.reduce((n, f) => n + (f.added ?? 0), 0), removed: files.reduce((n, f) => n + (f.removed ?? 0), 0),
      patch: patch.subarray(0, maxPatch).toString('utf8'), truncated: patch.length > maxPatch || files.length > MAX_LISTED,
    };
  } finally { await rm(scratch, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); }
}
export { inside as isInside, sep };
