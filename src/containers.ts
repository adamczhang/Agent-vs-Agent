import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

// The container backend for benchmark verifiers (roadmap X2, X4): a task marked `isolation: container` (an imported or
// otherwise untrusted bundle) runs its `run:` checks in Docker, never on the host. The container has no network, a
// read-only root filesystem with a small writable /tmp, no capabilities or privilege escalation, limits on processes,
// memory and CPU, a non-root user, and only the attempt folder, mounted read-only. The image is pinned by digest and
// is never pulled implicitly: without it (or without Docker's Linux engine), such tasks are refused with what to run.
export const VERIFIER_IMAGE = { tag: 'node:24-alpine', digest: 'sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1' };
export const imageRef = () => `node@${VERIFIER_IMAGE.digest}`;
export const pullCommand = () => `docker pull ${VERIFIER_IMAGE.tag}@${VERIFIER_IMAGE.digest}`;

export interface ContainerStatus { available: boolean; reason?: string; image?: string }
export interface ContainerRun { exitCode: number | null; output: string; timedOut: boolean }
// The Docker command line, injectable for tests.
export type Docker = (args: string[], options: { timeoutMs: number; signal?: AbortSignal; name?: string }) => Promise<ContainerRun>;

const exec = promisify(execFile);
const OUTPUT_LIMIT = 8000;
export const docker: Docker = (args, { timeoutMs, signal, name }) => new Promise(resolve => {
  let output = '', settled = false, timedOut = false;
  const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { if (name) void exec('docker', ['kill', name], { windowsHide: true, timeout: 15_000 }).catch(() => {}); child.kill(); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  const cancel = () => stop();
  const finish = (code: number | null) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve({ exitCode: code, output: output.slice(0, OUTPUT_LIMIT), timedOut }); };
  const collect = (chunk: Buffer) => { if (output.length < OUTPUT_LIMIT) output += chunk.toString('utf8'); };
  child.stdout.on('data', collect); child.stderr.on('data', collect);
  child.on('error', () => { output ||= 'Docker could not be started.'; finish(null); });
  child.on('close', finish);
  signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
});

// Docker's Linux engine running, and the pinned image present. Read-only: nothing is pulled or started.
export async function containerStatus(run: Docker = docker): Promise<ContainerStatus> {
  const info = await run(['info', '--format', '{{.OSType}}'], { timeoutMs: 15_000 });
  if (info.exitCode !== 0) return { available: false, reason: 'Docker is not running (or not installed). Start Docker Desktop to run container-isolated tasks.' };
  if (info.output.trim() !== 'linux') return { available: false, reason: 'Docker is running Windows containers. Switch Docker Desktop to Linux containers.' };
  const image = await run(['image', 'inspect', '--format', '{{.Id}}', imageRef()], { timeoutMs: 15_000 });
  if (image.exitCode !== 0) return { available: false, reason: `The verifier image isn't present. Download it once with: ${pullCommand()}` };
  return { available: true, image: VERIFIER_IMAGE.digest };
}

// The hardened `docker run` for one verifier. The attempt folder is mounted read-only at /work, its working directory.
export function containerArgs(attempt: string, verifier: string, name: string) {
  return ['run', '--rm', '--name', name, '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,size=64m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
    '--user', 'node', '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--mount', `type=bind,source=${attempt},target=/work,readonly`, '--workdir', '/work',
    imageRef(), 'node', '--max-old-space-size=256', verifier];
}

export async function runInContainer(attempt: string, verifier: string, timeoutMs: number, signal?: AbortSignal, run: Docker = docker) {
  // Container start-up isn't the verifier's time: allow it on top of the check's own limit.
  const name = `ava-verify-${randomUUID()}`;
  return run(containerArgs(attempt, verifier, name), { timeoutMs: timeoutMs + 20_000, signal, name });
}
