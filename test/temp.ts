// Every temporary folder a test file makes lives under one root for its process, removed when the process exits.
// On Windows SQLite keeps its files open until then, so a root that can't be removed is swept by a later run.
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PREFIX = 'ava-test-', STALE_MS = 60 * 60 * 1000;
for (const name of readdirSync(tmpdir())) {
  if (!name.startsWith(PREFIX)) continue;
  const path = join(tmpdir(), name);
  try { if (Date.now() - statSync(path).mtimeMs > STALE_MS) rmSync(path, { recursive: true, force: true }); } catch { /* still in use */ }
}
const root = mkdtempSync(join(tmpdir(), PREFIX));
process.on('exit', () => { try { rmSync(root, { recursive: true, force: true }); } catch { /* swept by a later run */ } });
export const tempDir = (prefix: string) => mkdtempSync(join(root, prefix));
