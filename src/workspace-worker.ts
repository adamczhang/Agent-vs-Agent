import { parentPort, workerData } from 'node:worker_threads';
import { copyProject, startProject } from './workspace.js';
import { AvAError } from './types.js';

try {
  const { source, target, history } = workerData as { source: string; target: string; history?: string };
  parentPort!.postMessage({ result: source ? copyProject(source, target, history) : startProject(target, history) });
} catch (error) {
  parentPort!.postMessage({ error: { code: error instanceof AvAError ? error.code : 'COPY_FAILED', message: error instanceof Error ? error.message : 'Project copy failed.' } });
}
