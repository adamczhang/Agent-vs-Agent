// Cursor's agent (roadmap F3), through ACPX's registry entry (`cursor-agent acp`).
// Launch: on Windows the installer puts a `cursor-agent.cmd` shim on PATH, which runs PowerShell, which runs the newest
// `versions/<version>/node.exe index.js`. A .cmd can't start without a shell (and AvA's job launcher has none), so AvA
// starts that bundled Node and entry file itself, choosing the version the way the shim does.
// Configuration: Cursor's agent reads its CLI settings from CURSOR_CONFIG_DIR. AvA gives the agents it starts their own
// folder there, so the user's Cursor settings (an allow list that runs some commands without asking, for one) don't
// decide for AvA's permissions. The sign-in isn't kept there, so the agent stays signed in.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Version folders: YYYY.MM.DD-commit, or YYYY.MM.DD-HH-MM-SS-commit (a build time before the commit).
const VERSION = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?-[a-f0-9]+$/;
const sortKey = (name: string) => { const m = VERSION.exec(name)!; return [m[1], m[2]!.padStart(2, '0'), m[3]!.padStart(2, '0'), m[4] ?? '00', m[5] ?? '00', m[6] ?? '00'].join(''); };
// The Node and entry file Cursor's shim would run, or undefined when the command isn't that shim.
export function cursorEntry(command: string): { node: string; entry: string; version: string } | undefined {
  if (!/^cursor-agent(\.cmd|\.ps1)?$/i.test(basename(command))) return undefined;
  const dir = dirname(command);
  if (existsSync(join(dir, 'node.exe')) && existsSync(join(dir, 'index.js'))) return { node: join(dir, 'node.exe'), entry: join(dir, 'index.js'), version: basename(dir) };
  let versions: string[] = [];
  try { versions = readdirSync(join(dir, 'versions'), { withFileTypes: true }).filter(e => e.isDirectory() && VERSION.test(e.name)).map(e => e.name); } catch { return undefined; }
  const newest = versions.sort((a, b) => sortKey(b).localeCompare(sortKey(a)) || b.localeCompare(a))[0];
  if (!newest) return undefined;
  const node = join(dir, 'versions', newest, process.platform === 'win32' ? 'node.exe' : 'node'), entry = join(dir, 'versions', newest, 'index.js');
  return existsSync(node) && existsSync(entry) ? { node, entry, version: newest } : undefined;
}
// ACPX's argv for Cursor ([shim, 'acp']) as AvA launches it: the bundled Node, the entry file, then the arguments.
export function cursorArgv(argv: string[]) {
  const found = argv[0] ? cursorEntry(argv[0]) : undefined;
  return found ? [found.node, found.entry, ...argv.slice(1)] : argv;
}

// The settings AvA's Cursor agents run with, applied over whatever the agent itself saved there (its model choice,
// display options): no command runs without asking, web searches ask too, and commits aren't attributed to the agent.
export const CURSOR_SETTINGS = {
  permissions: { allow: [] as string[], deny: [] as string[] },
  approvalMode: 'allowlist',
  autoAcceptWebSearch: false,
  attribution: { attributeCommitsToAgent: false, attributePRsToAgent: false },
};
// The folder for AvA's Cursor agents (one per data folder), with those settings in its cli-config.json.
export function cursorConfigDir(dataRoot: string) {
  const dir = join(dataRoot, 'providers', 'cursor'), file = join(dir, 'cli-config.json');
  mkdirSync(dir, { recursive: true });
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { /* first use, or unreadable: start over */ }
  const next = { version: 1, ...saved, ...CURSOR_SETTINGS };
  const text = JSON.stringify(next, null, 2) + '\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== text) writeFileSync(file, text);
  return dir;
}
// Cursor's agent environment: its own settings folder, and the name its shim would give it.
export function cursorEnvironment(dataRoot: string) {
  return { CURSOR_CONFIG_DIR: cursorConfigDir(dataRoot), CURSOR_INVOKED_AS: 'cursor-agent' };
}

// Cursor answers a request its plan doesn't cover with this text instead of a reply (seen on a Free plan, for every
// model). Activation then says so, rather than reporting a missing readiness marker.
export function cursorPlanRefusal(text: string) {
  return /^\s*Upgrade your plan to continue\b/i.test(text)
    ? 'Cursor refused the request: "Upgrade your plan to continue". This Cursor account\'s plan doesn\'t cover agent requests (a Free plan doesn\'t). Upgrade the plan, or sign in with another account (`cursor-agent login`).'
    : undefined;
}
// The account's plan, from `cursor-agent about` ("Subscription Tier   Free").
export const cursorTier = (about: string) => /Subscription Tier\s+(.+)/i.exec(about)?.[1]?.trim();