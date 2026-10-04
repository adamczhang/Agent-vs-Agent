import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { AvAError, SEATS, type HuntResult, type PlantedBug, type Seat } from './types.js';

// Bug hunts (owner, 2026-10-04): both agents hunt for bugs in their own copies of a repository. A scored hunt plants bugs
// in every copy before AvA records its baseline, so the agents start from the same, seeded code and never see the
// original. Each bug is a small edit (an exact piece of the original code, and what it becomes) with a note of what's
// wrong. The agents report each bug on its own BUG line; AvA counts a planted bug as found when a report names its file
// and a line at it (a few lines either side count).

// How every bug hunt asks for its findings: one line per bug, the faulty code's file and line.
export const BUG_FORMAT = 'Report each bug you find on its own line in exactly this form: BUG: <file path inside the project>:<line> — <what is wrong>. For example: BUG: src/parser.py:42 — an empty input raises instead of returning an empty list. Give the line of the faulty code, one line per bug, and only bugs you can point to.';
// How far a reported line may be from the planted code and still count.
export const LINE_SLACK = 3;

const unixPath = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '');
const samePath = (a: string, b: string) => unixPath(a).toLowerCase() === unixPath(b).toLowerCase();
// A planted bug's file, which must be a relative path inside the copy.
function inside(root: string, file: string) {
  const full = resolve(root, file), rel = relative(root, full);
  if (!file.trim() || isAbsolute(file) || !rel || rel.startsWith('..') || isAbsolute(rel)) throw new AvAError('HUNT_PLANT', `A planted bug's file must be a path inside the project: ${file}`);
  return full;
}
export const count = (text: string, part: string) => { let n = 0; for (let at = text.indexOf(part); at >= 0; at = text.indexOf(part, at + 1)) n++; return n; };

// Plants the bugs in a copy (root), in order, then finds where each one ended up. Each original piece of code must appear
// exactly once (else the repository has changed since the hunt was written), and so must each planted piece afterwards,
// so its line is certain. A file with Windows line endings is matched and edited with them.
export function plantBugs(root: string, bugs: PlantedBug[]): PlantedBug[] {
  const edit = (bug: PlantedBug, text: string) => {
    const crlf = text.includes('\r\n'), line = (s: string) => crlf ? s.replace(/\r?\n/g, '\r\n') : s;
    return { crlf, find: line(bug.find), replace: line(bug.replace) };
  };
  for (const bug of bugs) {
    const file = inside(root, bug.file);
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { throw new AvAError('HUNT_PLANT', `${bug.file} isn't in the copy, so its planted bug can't go in.`); }
    const { find, replace } = edit(bug, text);
    if (count(text, find) !== 1) throw new AvAError('HUNT_PLANT', `${bug.file}: the code a planted bug replaces ${count(text, find) ? 'appears more than once' : 'isn’t there'}. The repository has changed since the hunt was written; pin the hunt to a commit, or update the bug.`);
    // The file keeps the time it had when it was copied: a listing sorted by time (as agents' file search tools sort
    // it) would otherwise put the planted files first (H5, seen live).
    const { atime, mtime } = statSync(file);
    writeFileSync(file, text.replace(find, () => replace));
    utimesSync(file, atime, mtime);
  }
  return bugs.map(bug => {
    const text = readFileSync(inside(root, bug.file), 'utf8'), { replace } = edit(bug, text);
    if (!replace || count(text, replace) !== 1) throw new AvAError('HUNT_PLANT', `${bug.file}: a planted bug's new code must appear exactly once in the file, so its line is known. Include a line of context around it.`);
    const at = text.indexOf(replace), line = text.slice(0, at).split('\n').length;
    return { ...bug, line, endLine: line + replace.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length - 1 };
  });
}

// What a hunt's prompt says about scoring, beyond the BUG line itself (H6): the cap on BUG lines that count, and that a
// report of correct code counts against the agent. Nothing about the planted bugs themselves.
export function huntRules(hunt?: { bugs: PlantedBug[]; maxReports?: number }) {
  if (!hunt) return '';
  return [hunt.maxReports === 1 ? 'Only your first BUG line counts, so give the bug you are surest of.' : hunt.maxReports ? `Only your first ${hunt.maxReports} BUG lines count, so put the ones you are surest of first.` : '', hunt.bugs.some(b => b.decoy) ? 'A BUG line on code that is in fact correct counts against you.' : ''].filter(Boolean).join(' ');
}

// The BUG lines in a report: each one's file (relative to the project, whatever prefix the agent wrote) and line.
export function bugReports(text: string, folder: string) {
  const reports: Array<{ file: string; line: number; endLine: number }> = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = raw.replace(/[*`]/g, '').match(/^\s*(?:[-•]\s*|\d+[.)]\s*)?BUG\s*[:：]\s*(.+?):(\d+)(?:\s*[-–]\s*(\d+))?(?=$|[\s,;)\]—–:-])/i);
    if (!m) continue;
    let file = unixPath(m[1]!.trim().replace(/^["'(]+|["')]+$/g, ''));
    // A path written from the working directory, or in full, starts with (or runs through) the copy's own folder.
    const at = file.toLowerCase().lastIndexOf(`${folder.toLowerCase()}/`);
    if (at >= 0) file = file.slice(at + folder.length + 1);
    const line = Number(m[2]), endLine = m[3] ? Math.max(line, Number(m[3])) : line;
    reports.push({ file, line, endLine });
  }
  return reports;
}

// The hunt's result: which planted bugs each agent found, which decoys it reported, how many BUG lines it gave, and its
// time. Only the first maxReports BUG lines count, when the hunt sets it (H6). The winner found more planted bugs, then
// fell for fewer decoys, then was sooner; with no bug found by either, there's no winner.
export function huntResult(bugs: PlantedBug[], folder: string, replies: Partial<Record<Seat, { text: string; ms: number | null }>>, maxReports?: number): HuntResult {
  // Each BUG line lands on at most one planted change (a bug or a decoy): the nearest one in its file that no other line
  // has landed on.
  const distance = (r: { line: number; endLine: number }, bug: PlantedBug) => { const from = bug.line ?? 0, to = bug.endLine ?? from; return r.endLine < from ? from - r.endLine : r.line > to ? r.line - to : 0; };
  const seats = Object.fromEntries(SEATS.map(seat => {
    const reply = replies[seat], reports = reply ? bugReports(reply.text, folder) : [], landed: number[] = [];
    for (const report of maxReports ? reports.slice(0, maxReports) : reports) {
      const nearest = bugs.map((bug, index) => ({ index, gap: samePath(report.file, bug.file) ? distance(report, bug) : Infinity }))
        .filter(c => c.gap <= LINE_SLACK && !landed.includes(c.index)).sort((a, b) => a.gap - b.gap)[0];
      if (nearest) landed.push(nearest.index);
    }
    const found = landed.filter(i => !bugs[i]!.decoy).sort((a, b) => a - b), decoys = landed.filter(i => bugs[i]!.decoy).sort((a, b) => a - b);
    return [seat, { found, ...(bugs.some(b => b.decoy) ? { decoys } : {}), reports: reports.length, ms: reply?.ms ?? null }];
  })) as HuntResult['seats'];
  const fell = (s: Seat) => seats[s].decoys?.length ?? 0;
  const ranked = SEATS.filter(s => seats[s].found.length).sort((a, b) => seats[b].found.length - seats[a].found.length || fell(a) - fell(b) || (seats[a].ms ?? Infinity) - (seats[b].ms ?? Infinity));
  return { bugs: bugs.map(b => ({ file: b.file, line: b.line ?? null, endLine: b.endLine ?? null, what: b.what, ...(b.decoy ? { decoy: true } : {}) })), seats, ...(ranked[0] ? { winner: ranked[0] } : {}), ...(maxReports ? { maxReports } : {}) };
}
