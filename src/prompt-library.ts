import { randomUUID, createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { AvAError } from './types.js';
import { attachmentKind } from './attachment-files.js';
import type { Store } from './store.js';
import { defaultDebate, withStances, type DebateSetup, type PromptFile, type PromptSave, type PromptSummary, type SavedPrompt } from './prompt-types.js';
import { DEBATE_STARTERS, RETIRED_STARTERS, type Starter } from './debate-starters.js';

const key = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const filename = z.string().min(1).max(160).refine(name =>
  name === name.trim() && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) &&
  !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name), 'Use a plain filename without path separators or reserved Windows names.');
const fields = {
  name: z.string().trim().min(1).max(120), text: z.string().min(1).max(16000).refine(t => !!t.trim() && !t.includes('\0'), 'Enter prompt text.'),
  mode: z.enum(['all', 'benchmark', 'conversation', 'build']), buildKind: z.enum(['build', 'review']),
};
// stance: the agent's assigned side (G6); absent in files saved before sides, which read as Agent 1 for, Agent 2 against.
const debateAgent = z.object({ stance: z.enum(['for', 'against']).optional(), context: z.string().max(8000), internet: z.boolean() }).strict();
export const debateSchema = z.object({ rounds: z.number().int().min(1).max(100), speechMinutes: z.number().min(0).max(30).optional(), agents: z.object({ cli1: debateAgent, cli2: debateAgent }).strict() }).strict()
  .refine(d => withStances(d).agents.cli1.stance !== withStances(d).agents.cli2.stance, 'The two debaters need opposite sides.');
export const promptSaveSchema = z.object({
  id: key, revision: z.string().max(100).nullable(), ...fields,
  files: z.array(z.object({ id: key, name: filename, attachmentId: z.string().min(1).max(200).optional() }).strict()).max(8),
  debate: debateSchema.optional(),
}).strict();
// A debate prompt's template lives beside prompt.md in debate.json, so versions before G2 still read the prompt.
const debateFile = z.object({ version: z.literal(1), rounds: z.number().int().min(1).max(100), speechMinutes: z.number().min(0).max(30).optional(), agents: z.object({ cli1: debateAgent, cli2: debateAgent }).strict() }).strict();
export const promptKeySchema = key;
const metadata = z.object({
  version: z.literal(1), id: key, name: fields.name, mode: fields.mode, buildKind: fields.buildKind,
  createdAt: z.string(), updatedAt: z.string(),
  files: z.array(z.object({ id: key, name: filename, mediaType: z.string().max(100), kind: z.enum(['text', 'image']), size: z.number().int().min(0).max(8 * 1024 * 1024) }).strict()).max(8),
}).strict();

const STARTER_SET = '3';
const STARTERS: Starter[] = [
  { id: 'starter-state-tracking', name: 'Track the shuffled objects', mode: 'benchmark', buildKind: 'build', text: '# Track the objects\n\nAva has a red ball, Ben has a blue ball, and Cam has a green ball.\n1. Ava and Ben swap balls.\n2. Ben and Cam swap balls.\n3. Ava and Cam swap balls.\n\nReturn one raw JSON object mapping Ava, Ben, and Cam to their final ball colors. Do not use Markdown fences, backticks, or explanatory text.' },
  { id: 'starter-intervals', name: 'Merge overlapping intervals', mode: 'benchmark', buildKind: 'build', text: '# Merge intervals\n\nWrite a function that merges overlapping closed intervals. Handle empty input, unsorted input, and intervals that share an endpoint. Explain its time complexity and include three tests.' },
  ...DEBATE_STARTERS,
  { id: 'starter-snake', name: 'Build a browser Snake game', mode: 'build', buildKind: 'build', text: '# Browser Snake\n\nBuild a polished Snake game that runs in the browser. Include arrow-key controls, score, increasing speed, a game-over screen, and a restart button. Keep it self-contained with no external dependencies. Verify that it works and provide the app link.' },
  { id: 'starter-review', name: 'Review a project for bugs', mode: 'build', buildKind: 'review', text: '# Review this project\n\nFind actionable bugs and risky behavior in the supplied project. Read the relevant code and run existing tests where useful. For each finding, give the file and line, triggering input, expected behavior, actual behavior, and severity. Report only findings supported by evidence. Do not modify the project.' },
];

// Each prompt is a portable folder: prompt.md, prompt.json, and files/<original filename>.
// Writes build a complete sibling folder before swapping it in. A backup bridges the two directory renames,
// so a crash there recovers either the last complete save or the new complete save, never mixed file versions.
export class PromptLibrary {
  readonly directory: string;
  private initialized = false;
  constructor(dataRoot: string, private readonly store: Store) { this.directory = resolve(dataRoot, 'prompts'); }
  private safe(path: string, directory: boolean) {
    const target = resolve(path);
    if (target !== this.directory && !target.startsWith(this.directory + sep)) throw new AvAError('PROMPT_PATH', 'Invalid prompt path.');
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1)) throw new AvAError('PROMPT_PATH', 'Linked or unexpected prompt files are not supported.');
  }
  private tree(path: string) {
    this.safe(path, true);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) this.tree(child); else this.safe(child, false);
    }
  }
  private remove(path: string) { this.tree(path); rmSync(path, { recursive: true, force: true }); }
  private init() {
    if (!existsSync(this.directory)) mkdirSync(this.directory, { recursive: true });
    this.safe(this.directory, true);
    if (this.initialized) return;
    for (const entry of readdirSync(this.directory)) {
      if (!entry.startsWith('.previous-')) continue;
      const id = key.parse(entry.slice(10)), backup = join(this.directory, entry), target = join(this.directory, id);
      this.tree(backup);
      if (!existsSync(target)) renameSync(backup, target); else { this.tree(target); this.remove(backup); }
    }
    this.initialized = true;
    // The marker records which starters a library has had: 1, the first six; 2, the G3 debate prompts; 3, the formal
    // debates (G8), which replace every earlier debate starter. Each set is added once, so a starter the user deleted
    // never comes back; a retired starter is removed only while it is exactly as shipped.
    const marker = join(this.directory, '.initialized'), had = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : '';
    if (!had) {
      for (const starter of STARTERS) if (!existsSync(join(this.directory, starter.id))) this.save({ ...starter, revision: null, files: [] });
    } else if (had === '1' || had === '2') {
      for (const [id, shipped] of Object.entries(RETIRED_STARTERS)) {
        if (!existsSync(join(this.directory, id))) continue;
        try { const current = this.get(id); if (!current.files.length && shipped.includes(this.fingerprint(id))) this.delete(id, current.revision); }
        catch { /* unreadable: left for the user, like any damaged prompt */ }
      }
      for (const starter of DEBATE_STARTERS) if (!existsSync(join(this.directory, starter.id))) this.save({ ...starter, revision: null, files: [] });
    }
    // A newer version's marker stays as it is.
    if (!had || had === '1' || had === '2') writeFileSync(marker, `${STARTER_SET}\n`, { mode: 0o600 });
  }
  // A starter as shipped: its name, prompt.md and debate.json exactly (see RETIRED_STARTERS).
  private fingerprint(id: string) {
    const { data, text, debateRaw } = this.read(id);
    return createHash('sha256').update(data.name).update('\0').update(text).update('\0').update(debateRaw?.toString('utf8') ?? '').digest('hex').slice(0, 24);
  }
  private folder(id: string) { this.init(); const path = join(this.directory, key.parse(id)); this.safe(path, true); return path; }
  list() {
    this.init();
    const prompts: PromptSummary[] = [], warnings: string[] = [];
    for (const entry of readdirSync(this.directory).filter(n => !n.startsWith('.'))) {
      // Browsing/searching does not read every image in the library. A specific open/save/load verifies its files.
      try { const { data, text, debate } = this.read(entry); const { version: _version, ...prompt } = data; prompts.push({ ...prompt, ...(debate ? { debate } : {}), text, excerpt: text.slice(0, 180) }); }
      catch { warnings.push(`${entry}: couldn't read this prompt. Its files were left untouched.`); }
    }
    prompts.sort((a, b) => a.name.localeCompare(b.name));
    return { directory: this.directory, prompts, warnings };
  }
  get(id: string): SavedPrompt {
    const { folder, raw, data, text, debate, debateRaw } = this.read(id), hash = createHash('sha256').update(raw).update(text);
    if (debateRaw) hash.update(debateRaw);
    for (const file of data.files) hash.update(this.readFile(folder, file));
    return { id, name: data.name, mode: data.mode, buildKind: data.buildKind, files: data.files, createdAt: data.createdAt, updatedAt: data.updatedAt, text, ...(debate ? { debate } : {}), revision: hash.digest('hex').slice(0, 32) };
  }
  private read(id: string) {
    const folder = this.folder(id), manifest = join(folder, 'prompt.json'), body = join(folder, 'prompt.md'), sidecar = join(folder, 'debate.json');
    this.safe(manifest, false); this.safe(body, false);
    if (lstatSync(manifest).size > 32000 || lstatSync(body).size > 64000) throw new AvAError('PROMPT_INVALID', 'Prompt files are too large.');
    const raw = readFileSync(manifest), data = metadata.parse(JSON.parse(raw.toString('utf8')));
    if (data.id !== id) throw new AvAError('PROMPT_INVALID', 'Prompt identity does not match its folder.');
    const text = fields.text.parse(readFileSync(body, 'utf8'));
    this.unique(data.files);
    let debate: DebateSetup | undefined, debateRaw: Buffer | undefined;
    if (data.mode === 'conversation' && existsSync(sidecar)) {
      this.safe(sidecar, false);
      if (lstatSync(sidecar).size > 32000) throw new AvAError('PROMPT_INVALID', 'Prompt files are too large.');
      debateRaw = readFileSync(sidecar); const { version: _version, ...setup } = debateFile.parse(JSON.parse(debateRaw.toString('utf8'))); debate = withStances(setup);
    } else if (data.mode === 'conversation') debate = defaultDebate();
    return { folder, raw, data, text, debate, debateRaw };
  }
  private unique(files: Array<{ id: string; name: string }>) {
    if (new Set(files.map(f => f.name.toLowerCase())).size !== files.length || new Set(files.map(f => f.id)).size !== files.length) throw new AvAError('PROMPT_FILES', 'File names and IDs must be unique within a prompt.');
  }
  private readFile(folder: string, file: PromptFile) {
    const files = join(folder, 'files'), path = join(files, filename.parse(file.name));
    this.safe(files, true); this.safe(path, false);
    if (lstatSync(path).size > (file.kind === 'image' ? 8 * 1024 * 1024 : 512 * 1024)) throw new AvAError('FILE_TOO_LARGE', 'A saved file is too large.');
    const bytes = readFileSync(path);
    if (bytes.length !== file.size || attachmentKind(file.name, file.mediaType, bytes) !== file.kind) throw new AvAError('PROMPT_FILES', 'A saved file changed on disk. Remove it and attach the updated file.');
    return bytes;
  }
  file(id: string, fileId: string) {
    const prompt = this.get(id), file = prompt.files.find(f => f.id === fileId);
    if (!file) throw new AvAError('NOT_FOUND', 'Prompt file not found.');
    return { ...file, data: this.readFile(this.folder(id), file).toString('base64') };
  }
  save(input: PromptSave): SavedPrompt {
    const p = promptSaveSchema.parse(input); this.init(); this.unique(p.files);
    const target = join(this.directory, p.id), current = existsSync(target) ? this.get(p.id) : null;
    if ((current?.revision ?? null) !== p.revision) throw new AvAError('PROMPT_CONFLICT', 'This prompt changed in another window. Reload it before saving.');
    const content = p.files.map(f => {
      const old = current?.files.find(old => old.id === f.id);
      if (!f.attachmentId && !old) throw new AvAError('NOT_FOUND', 'The saved prompt file no longer exists.');
      const original = f.attachmentId ? this.store.attachment(f.attachmentId) : old!;
      const bytes = f.attachmentId ? this.store.attachmentData(f.attachmentId) : this.readFile(target, old!);
      const kind = attachmentKind(f.name, original.mediaType, bytes);
      return { meta: { id: f.id, name: f.name, mediaType: original.mediaType, kind, size: bytes.length }, bytes };
    });
    const stage = join(this.directory, `.pending-${p.id}-${randomUUID()}`), backup = join(this.directory, `.previous-${p.id}`);
    if (existsSync(backup)) this.remove(backup);
    mkdirSync(join(stage, 'files'), { recursive: true });
    let installed = false;
    try {
      const now = new Date().toISOString();
      writeFileSync(join(stage, 'prompt.md'), p.text, { mode: 0o600 });
      writeFileSync(join(stage, 'prompt.json'), JSON.stringify({ version: 1, id: p.id, name: p.name, mode: p.mode, buildKind: p.buildKind, createdAt: current?.createdAt ?? now, updatedAt: now, files: content.map(f => f.meta) }, null, 2) + '\n', { mode: 0o600 });
      if (p.debate && p.mode === 'conversation') writeFileSync(join(stage, 'debate.json'), JSON.stringify({ version: 1, ...withStances(p.debate) }, null, 2) + '\n', { mode: 0o600 });
      for (const file of content) writeFileSync(join(stage, 'files', file.meta.name), file.bytes, { flag: 'wx', mode: 0o600 });
      if (current) { this.tree(target); renameSync(target, backup); }
      renameSync(stage, target); installed = true;
    } finally {
      if (!installed && existsSync(backup) && !existsSync(target)) renameSync(backup, target);
      if (existsSync(stage)) this.remove(stage);
    }
    // A locked backup is harmless and can be removed on the next startup/save.
    if (existsSync(backup)) { try { this.remove(backup); } catch { /* keep the previous complete save */ } }
    return this.get(p.id);
  }
  delete(id: string, revision: string) {
    const prompt = this.get(id);
    if (prompt.revision !== revision) throw new AvAError('PROMPT_CONFLICT', 'This prompt changed in another window. Reload it before deleting.');
    const backup = join(this.directory, `.previous-${id}`);
    if (existsSync(backup)) this.remove(backup);
    this.remove(this.folder(id)); return { deleted: true };
  }
  prepare(id: string, revision: string) {
    const prompt = this.get(id);
    if (prompt.revision !== revision) throw new AvAError('PROMPT_CONFLICT', 'This prompt changed in another window. Reload it before using it.');
    const folder = this.folder(id);
    // Independent message attachments: deleting/editing the library must never alter a queued or completed run.
    const attachments = prompt.files.map(f => this.store.saveAttachment(f.name, f.mediaType, f.kind, this.readFile(folder, f)));
    return { prompt, attachments };
  }
}
