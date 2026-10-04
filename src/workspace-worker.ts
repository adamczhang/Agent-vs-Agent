import { parentPort, workerData } from 'node:worker_threads';
import { copyProject, startProject, type CopyOptions } from './workspace.js';
import { AvAError } from './types.js';

try {
  const { source, target, history, options } = workerData as { source: string; target: string; history?: string; options?: CopyOptions };
  parentPort!.postMessage({ result: source ? copyProject(source, target, history, options) : startProject(target, history) });
} catch (error) {
  parentPort!.postMessage({ error: { code: error instanceof AvAError ? error.code : 'COPY_FAILED', message: error instanceof Error ? error.message : 'Project copy failed.' } });
}
