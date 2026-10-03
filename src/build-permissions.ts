import { lstatSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInside } from './workspace.js';

export interface ToolPermissionRequest {
  inferredKind?: string;
  raw: { toolCall?: { kind?: string | null; locations?: Array<{ path?: string }> | null; rawInput?: unknown; title?: string | null } };
}
const FILE_KINDS = new Set(['read', 'edit', 'delete', 'move', 'search']);
const PATH_KEYS = new Set(['path', 'paths', 'file_path', 'filepath', 'file', 'files', 'notebook_path', 'cwd', 'workdir', 'directory', 'dir', 'target', 'source', 'destination', 'old_path', 'new_path', 'uri', 'url']);
const COMMAND_KEYS = new Set(['command', 'cmd', 'commandline', 'command_line', 'script', 'code', 'args', 'argv', 'executable', 'program', 'shell']);
// Literal file contents are data, not permission metadata. Execution kinds are refused before inspecting them.
const CONTENT_KEYS = new Set(['content', 'contents', 'text', 'old_string', 'new_string', 'oldtext', 'newtext', 'old_text', 'new_text', 'diff', 'patch']);
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|\\\\|\/(?!\/))/;
const SETTINGS = /(^|[\\/])\.(claude|codex|gemini|grok)([\\/]|$)/i;
const ESCALATION_KEY = /escalat|sandbox_permissions|danger/i, ESCALATION_VALUE = /^(require_escalated|danger-full-access)$/i;
const norm = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;

function inspect(request: ToolPermissionRequest) {
  const call = request.raw.toolCall, paths: string[] = [];
  let execution = [call?.kind, request.inferredKind].some(kind => kind === 'execute' || kind === 'switch_mode'), escalates = false, invalid = false;
  const addPath = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) paths.push(value);
    else if (Array.isArray(value)) value.forEach(addPath);
    else invalid = true;
  };
  for (const location of call?.locations ?? []) addPath(location.path);
  const visit = (value: unknown, depth = 0) => {
    if (value === null || value === undefined) return;
    if (depth > 8) { invalid = true; return; }
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    if (typeof value !== 'object') { invalid = true; return; }
    for (const [rawKey, child] of Object.entries(value)) {
      const key = rawKey.toLowerCase();
      if (CONTENT_KEYS.has(key)) continue;
      if ((ESCALATION_KEY.test(key) && !!child && child !== 'use_default') || (typeof child === 'string' && ESCALATION_VALUE.test(child))) escalates = true;
      if (COMMAND_KEYS.has(key)) { execution = true; continue; }
      if (PATH_KEYS.has(key)) { addPath(child); continue; }
      if (typeof child === 'string' && (ABSOLUTE.test(child) || /^file:/i.test(child))) paths.push(child);
      else if (child && typeof child === 'object') visit(child, depth + 1);
    }
  };
  visit(call?.rawInput);
  return { paths, execution, escalates, invalid };
}

export const executionRequest = (request: ToolPermissionRequest) => inspect(request).execution;

// A working directory does not confine a program. Ask mode approves only recognized, explicitly scoped file
// operations; shell, process and interpreter execution needs a real sandbox, not a command-text blacklist.
export function buildPermission(request: ToolPermissionRequest, root: string) {
  const call = request.raw.toolCall, { paths, execution, escalates, invalid } = inspect(request);
  if (escalates) return { decision: undefined, reason: 'asks to leave its sandbox' };
  if (execution) return { decision: undefined, reason: 'command execution needs a sandbox; a working folder does not confine it' };
  if (!FILE_KINDS.has(call?.kind ?? request.inferredKind ?? '')) return { decision: undefined, reason: 'unrecognized file operation' };
  if (invalid || !paths.length) return { decision: undefined, reason: 'file operation has no complete, explicit paths' };
  const base = resolve(root);
  for (let path of paths) {
    if (/^file:/i.test(path)) { try { path = fileURLToPath(path); } catch { return { decision: undefined, reason: 'invalid file URL' }; } }
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return { decision: undefined, reason: 'remote paths are not workspace files' };
    const full = resolve(base, path);
    if (!isInside(norm(full), norm(base))) return { decision: undefined, reason: `outside its copy (${full})` };
    const local = relative(base, full);
    if (SETTINGS.test(local)) return { decision: undefined, reason: `a CLI's own settings folder (${local})` };
    if (process.platform === 'win32' && local.split(/[\\/]/).some(part => /[:<>"|?*\x00-\x1f]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) return { decision: undefined, reason: 'ambiguous Windows file path' };
    // Refuse links in any existing component, including the workspace itself. A not-yet-created file is fine.
    for (let cursor = full; ; cursor = dirname(cursor)) {
      try {
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || stat.isFile() && stat.nlink > 1) return { decision: undefined, reason: 'linked paths are not confined to the copy' };
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { decision: undefined, reason: 'cannot verify the file path' }; }
      if (norm(cursor) === norm(base)) break;
      if (dirname(cursor) === cursor) return { decision: undefined, reason: 'cannot verify the workspace boundary' };
    }
  }
  return { decision: { outcome: 'allow_once' as const }, reason: '' };
}
