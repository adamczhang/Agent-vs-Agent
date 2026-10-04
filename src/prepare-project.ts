import { Worker } from 'node:worker_threads';
import { AvAError } from './types.js';
import type { copyProject } from './workspace.js';

// Enumeration, copying, and the baseline git commands all run off the service thread.
// history: where AvA keeps its own record of the baseline (participantBaseline).
export function prepareProject(source: string, target: string, history?: string): Promise<ReturnType<typeof copyProject>> {
  return new Promise((resolve, reject) => {
    const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
    const worker = new Worker(new URL(`./workspace-worker.${ext}`, import.meta.url), { workerData: { source, target, history } });
    let received = false;
    worker.once('message', (message: { result: ReturnType<typeof copyProject>; error?: { code: string; message: string } }) => {
      received = true;
      if (message.error) reject(new AvAError(message.error.code, message.error.message)); else resolve(message.result);
    });
    worker.once('error', reject);
    worker.once('exit', code => { if (!received) reject(new AvAError('COPY_FAILED', `Project copy worker exited (${code}).`)); });
  });
}
