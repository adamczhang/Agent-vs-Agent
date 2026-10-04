// Bug hunts from the web (H7): a hunt can name a public git repository and a commit instead of a local folder, so it
// runs the same on any computer. AvA fetches the code itself, never the agents: a clone with its history would show
// every planted bug in a diff, and Ask doesn't let an agent fetch anything. The fetch takes that one commit without its
// history or file contents, then only the files the copies take (the slice), in one batch, into a cache in the data
// folder: one bare repository per address. Every copy is made from there, so a later run downloads nothing.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AvAError, FULL_COMMIT } from './types.js';
import { CACHE_ENV, COPY_LIMITS, GIT_FLAGS, checkHunt, gitEnv, taken } from './workspace.js';

// The address, checked: https (or file), with no user name, password or query in it.
export function checkRepoUrl(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new AvAError('INVALID_PROJECT', 'Give the repository’s address, for example https://github.com/owner/repo.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'file:') throw new AvAError('INVALID_PROJECT', 'A repository on the web is its https:// address, for example https://github.com/owner/repo.');
  if (url.username || url.password || url.search || url.hash) throw new AvAError('INVALID_PROJECT', 'Give the repository’s public address, without a user name, password or query.');
  const path = url.pathname.replace(/\/+$/, '');
  if (url.protocol === 'https:' && (!url.hostname || path.length < 2)) throw new AvAError('INVALID_PROJECT', 'Give the repository’s address, for example https://github.com/owner/repo.');
  return `${url.protocol}//${url.host}${path}`;
}
// The repository's name, for the copies' folder: https://github.com/owner/repo.git is repo.
export const repoName = (url: string) => basename(url.replace(/\/+$/, '')).replace(/\.git$/i, '') || 'repository';
// The cache for an address: one bare repository, named so a person can tell which it is.
export function repoCache(dataRoot: string, url: string) {
  const hash = createHash('sha256').update(url.toLowerCase()).digest('hex').slice(0, 12);
  return join(dataRoot, 'repos', `${repoName(url).replace(/[^\w.-]+/g, '-').slice(0, 40)}-${hash}.git`);
}

// Network calls never ask for a password (a public repository needs none) and never use the user's saved ones, speak
// only https (or file, for a mirror), and check every object received.
const NETWORK = ['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always', '-c', 'credential.helper=', '-c', 'core.askPass=', '-c', 'transfer.fsckObjects=true'];
const quiet = () => gitEnv({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...CACHE_ENV });
function run(cwd: string, args: string[], input?: string, timeout = 300_000) {
  return new Promise<{ status: number; stdout: string; stderr: string }>(done => {
    const child = execFile('git', [...GIT_FLAGS, ...NETWORK, ...args], { cwd, env: { ...quiet(), SSH_ASKPASS: '' }, windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => done({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
    if (input !== undefined) child.stdin?.end(input); else child.stdin?.end();
  });
}
// What went wrong, in git's own words (its last line), for the person who wrote the hunt. A host asks for a password
// when the repository doesn't exist or isn't public, as GitHub does.
const why = (stderr: string) => /could not read (?:username|password)|authentication failed/i.test(stderr) ? 'it doesn’t exist, or isn’t public'
  : stderr.trim().split(/\r?\n/).filter(line => !/^(?:warning|hint):/i.test(line)).pop()?.replace(/^fatal:\s*/i, '').slice(0, 300) || 'git gave no reason';

// The commit the repository's default branch is at now.
export async function remoteHead(url: string) {
  const listed = await run(tmpdir(), ['ls-remote', '--', url, 'HEAD'], undefined, 60_000);
  const head = listed.stdout.trim().split(/\s+/)[0] ?? '';
  if (listed.status !== 0 || !FULL_COMMIT.test(head)) throw new AvAError('REPO_FETCH', `Could not reach ${url}: ${listed.status !== 0 ? why(listed.stderr) : 'it has no default branch'}.`);
  return head.toLowerCase();
}

// One fetch per cache at a time; a second hunt from the same repository waits, then finds what it needs there.
const fetching = new Map<string, Promise<unknown>>();
function serial<T>(key: string, work: () => Promise<T>) {
  const next = (fetching.get(key) ?? Promise.resolve()).catch(() => undefined).then(work), tail = next.catch(() => undefined);
  fetching.set(key, tail); void tail.then(() => { if (fetching.get(key) === tail) fetching.delete(key); });
  return next;
}

// The commit and the files its copies take, fetched into the cache unless they are there already. Returns the cache
// (a bare repository, for copyProject's bare option) and what a copy holds.
export async function fetchRepo(dataRoot: string, url: string, commit: string, slice: { include?: string[]; exclude?: string[] } = {}) {
  if (!FULL_COMMIT.test(commit)) throw new AvAError('HUNT_COMMIT', 'A repository on the web needs the commit’s full hash (40 characters), so every run copies the same code. Check gives it.');
  const gitDir = repoCache(dataRoot, url);
  return serial(gitDir, async () => {
    if (!existsSync(gitDir)) {
      // Made beside its place and renamed into it, so a cache is never half set up.
      const made = `${gitDir}.new-${randomUUID().slice(0, 8)}`;
      mkdirSync(dirname(gitDir), { recursive: true });
      const set = async (args: string[]) => { if ((await run(dirname(gitDir), args)).status !== 0) throw new AvAError('REPO_FETCH', `Could not set up the cache for ${url}.`); };
      try {
        await set(['init', '--bare', '-q', '--template=', made]);
        for (const [name, value] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.url', url], ['remote.origin.promisor', 'true'], ['remote.origin.partialclonefilter', 'blob:none'], ['gc.auto', '0']])
          await set([`--git-dir=${made}`, 'config', name!, value!]);
        renameSync(made, gitDir);
      } catch (error) { rmSync(made, { recursive: true, force: true }); if (!existsSync(gitDir)) throw error; }
    }
    const git = (args: string[], input?: string) => run(gitDir, [`--git-dir=${gitDir}`, ...args], input);
    if ((await git(['cat-file', '-e', `${commit}^{commit}`])).status !== 0) {
      const fetched = await git(['fetch', '-q', '--depth=1', '--filter=blob:none', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', 'origin', commit]);
      if (fetched.status !== 0) throw new AvAError('REPO_FETCH', `Could not fetch commit ${commit.slice(0, 7)} from ${url}: ${why(fetched.stderr)}.`);
      // A ref keeps the commit (and the files fetched for it) from ever counting as unreachable.
      if ((await git(['update-ref', `refs/ava/${commit.toLowerCase()}`, commit])).status !== 0) throw new AvAError('REPO_FETCH', `Could not record commit ${commit.slice(0, 7)} in the cache for ${url}.`);
    }
    // The files a copy takes, and which of them the cache doesn't hold yet.
    const rows = (await git(['ls-tree', '-r', '-z', commit])).stdout.split('\0').map(row => row.match(/^\S+ blob (\S+)\t([\s\S]*)$/)).filter((m): m is RegExpMatchArray => !!m && taken(m[2]!, slice.exclude, slice.include));
    if (rows.length > COPY_LIMITS.files) throw new AvAError('PROJECT_TOO_LARGE', `More than ${COPY_LIMITS.files} files. Leave some out, or take a slice of the repository.`);
    const objects = [...new Set(rows.map(m => m[1]!))];
    const sizes = async () => new Map((await git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], objects.join('\n') + '\n')).stdout.split('\n').map(line => line.split(' ')).filter(([, size]) => /^\d+$/.test(size ?? '')).map(([id, size]) => [id!, Number(size)]));
    let have = objects.length ? await sizes() : new Map<string, number>();
    const missing = objects.filter(id => !have.has(id));
    if (missing.length) {
      const fetched = await git(['-c', 'fetch.negotiationAlgorithm=noop', 'fetch', '-q', '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no', '--filter=blob:none', '--stdin', 'origin'], missing.join('\n') + '\n');
      if (fetched.status !== 0) throw new AvAError('REPO_FETCH', `Could not fetch the files of commit ${commit.slice(0, 7)} from ${url}: ${why(fetched.stderr)}.`);
      have = await sizes();
      if (objects.some(id => !have.has(id))) throw new AvAError('REPO_FETCH', `${url} didn’t send every file of commit ${commit.slice(0, 7)}.`);
    }
    const bytes = rows.reduce((sum, m) => sum + (have.get(m[1]!) ?? 0), 0);
    if (bytes > COPY_LIMITS.bytes) throw new AvAError('PROJECT_TOO_LARGE', `More than ${Math.round(COPY_LIMITS.bytes / 1048576)} MB. Leave some out, or take a slice of the repository.`);
    return { gitDir, files: rows.length, bytes };
  });
}

// The Bug hunt builder's check for a repository on the web: where its default branch is now, whether the commit can be
// fetched, what a copy would hold, and each planted bug. It fills the cache, so the first run starts at once.
export async function checkRemoteHunt(dataRoot: string, url: string, options: { commit?: string; exclude?: string[]; include?: string[]; bugs?: Array<{ file: string; find: string }> } = {}) {
  let head: string | null = null, problem: string | undefined;
  try { head = await remoteHead(url); } catch (error) { problem = error instanceof Error ? error.message : String(error); }
  // A short commit that starts the default branch's hash is that commit.
  const commit = options.commit && head && !FULL_COMMIT.test(options.commit) && head.startsWith(options.commit.toLowerCase()) ? head : options.commit ?? head ?? undefined;
  if (commit && !FULL_COMMIT.test(commit)) throw new AvAError('HUNT_COMMIT', 'A repository on the web needs the commit’s full hash (40 characters). Use Check without a commit, then Use, for the default branch’s.');
  const none = { folder: url, head, commitFound: options.commit ? false : null, files: 0, bytes: 0, bugs: (options.bugs ?? []).map(() => 'no-file' as const) };
  if (!commit) return { ...none, ...(problem ? { problem } : {}) };
  try {
    const fetched = await fetchRepo(dataRoot, url, commit, options);
    const checked = checkHunt(fetched.gitDir, { commit, ...(options.exclude ? { exclude: options.exclude } : {}), ...(options.include ? { include: options.include } : {}), ...(options.bugs ? { bugs: options.bugs } : {}), bare: true });
    return { ...checked, folder: url, head, commitFound: options.commit ? true : null, files: fetched.files, bytes: fetched.bytes, ...(problem ? { problem } : {}) };
  } catch (error) {
    if (!(error instanceof AvAError) || error.code !== 'REPO_FETCH') throw error;
    return { ...none, problem: error.message };
  }
}
