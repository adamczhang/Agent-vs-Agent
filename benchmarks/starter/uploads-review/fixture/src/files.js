import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = '/srv/uploads';

export async function readUpload(name) {
  const path = join(ROOT, name);
  return readFile(path, 'utf8');
}

export function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} MB`;
}
