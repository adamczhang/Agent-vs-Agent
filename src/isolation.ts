import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InstalledCli } from './clis.js';
import { AvAError } from './types.js';
export const CODEX_ISOLATION_FLAGS=['--disable','plugins','--disable','apps','--disable','remote_plugin','--disable','hooks'];

// An empty mcp_servers table merges with Codex's disk config: it does not remove servers.
// Ask the CLI for its effective list without starting servers, then disable every name.
// Never expose the returned transport definitions: they can contain credentials.
export async function codexMcpNames(cli: Pick<InstalledCli, 'command' | 'args'>, cwd: string, env: NodeJS.ProcessEnv, signal?: AbortSignal) {
  try {
    const { stdout } = await promisify(execFile)(cli.command, [...cli.args, ...CODEX_ISOLATION_FLAGS, 'mcp', 'list', '--json'], {
      cwd, env, signal, windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    });
    const rows: unknown = JSON.parse(stdout);
    if (!Array.isArray(rows) || rows.some(r => !r || typeof r.name !== 'string')) throw new Error('Invalid list');
    return rows.map(r => String(r.name));
  } catch {
    signal?.throwIfAborted();
    throw new AvAError('MCP_ISOLATION', 'Could not inspect Codex MCP settings. Agent startup was refused; run /ava doctor and check your Codex configuration.');
  }
}

export function disabledMcpNames(discovered: string[]) {
  return [...new Set(discovered)].sort();
}

export function codexIsolationArgs(names:string[]) {
  // CLI dotted paths split at dots even inside quoted segments. A TOML inline table preserves literal names
  // and merges enabled:false into each existing transport without including any transport credentials.
  const servers=names.map(name=>`${JSON.stringify(name)}={enabled=false}`).join(',');
  return [...CODEX_ISOLATION_FLAGS,...(names.length?['-c',`mcp_servers={${servers}}`]:[])];
}
