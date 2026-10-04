import { homedir } from 'node:os';
import { passAtK } from './bench-results.js';
import type { BenchAttempt, BenchJob } from './bench-runner.js';
import type { Seat } from './types.js';

// A shareable report of one benchmark job (roadmap B9): a standalone HTML page (inline styles, no scripts) or Markdown.
// It shows each agent's pass rate, pass@k, time and tokens; each task's result per agent; and every check's evidence.
// It carries no room link or token: 64-hex tokens and Gateway keys are redacted (image digests stay), and the data
// folder and home folder are replaced in check details, which can quote paths from the attempt folder.
export type ReportFormat = 'html' | 'md';
const SEATS: Seat[] = ['cli1', 'cli2'];

// A folder as a pattern that matches it however a check detail writes it: any case (Windows paths aren't case
// sensitive), either separator (single or escaped), and, for a home folder, its 8.3 short name (C:\Users\RUNNER~1).
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function folderPattern(path: string, shortName: boolean) {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]+/).filter(Boolean), last = parts.pop() ?? '';
  const sep = '(?:\\\\{1,2}|/)', parent = parts.map(escapeRegex).join(sep) + (parts.length ? sep : '');
  const short = shortName && /[^A-Za-z0-9]|.{9,}/.test(last) ? `|${escapeRegex(last.replace(/[^A-Za-z0-9]/g, '').slice(0, 6))}~\\d+` : '';
  return new RegExp(`${path.startsWith('/') ? '/' : ''}${parent}(?:${escapeRegex(last)}${short})(?![A-Za-z0-9_-])`, 'gi');
}
function scrubber(dataRoot: string) {
  const data = dataRoot ? folderPattern(dataRoot, false) : undefined, home = folderPattern(homedir(), true);
  return (text: string) => {
    let out = text.replace(/(?<!sha256:)\b[a-f0-9]{64}\b|vck_[A-Za-z0-9_-]{20,}/gi, '[redacted]');
    if (data) out = out.replace(data, '<data>');
    return out.replace(home, '~');
  };
}
const agentName = (a: BenchAttempt['agent']) => `${a.provider} · ${a.model}${a.effort ? ` · ${a.effort.value}` : ''}`;
const seconds = (ms: number | null) => ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`;
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`;
const sumOrNull = (values: Array<number | null>) => values.length && values.every((v): v is number => v !== null) ? values.reduce((a, b) => a + b, 0) : null;

// The judge's average score over this agent's judged attempts (roadmap B7), apart from pass or fail.
const rubricOf = (mine: BenchAttempt[]) => { const scores = mine.map(a => a.rubric?.score).filter((s): s is number => typeof s === 'number'); return { rubric: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, judged: scores.length }; };
const judgeLine = (a: BenchAttempt) => !a.rubric ? '' : a.rubric.score === null ? `Rubric: no score from ${agentName(a.rubric.judge)} (${a.rubric.error ?? 'no answer'}).` : `Rubric: ${a.rubric.score}/10 from ${agentName(a.rubric.judge)}. ${a.rubric.reason ?? ''}`.trim();
interface AgentSummary { seat: Seat; agent: string; pass: number; graded: number; errors: number; passRate: number | null; passAtK: Array<{ k: number; value: number }>; avgMs: number | null; inputTokens: number | null; outputTokens: number | null; rubric: number | null; judged: number }
function summarize(job: BenchJob, attempts: BenchAttempt[]): AgentSummary[] {
  return SEATS.map(seat => {
    const mine = attempts.filter(a => a.seat === seat), graded = mine.filter(a => a.status === 'pass' || a.status === 'fail');
    const pass = graded.filter(a => a.status === 'pass').length, durations = mine.map(a => a.durationMs).filter((d): d is number => d !== null);
    // pass@k per task, averaged over tasks with all their repeats graded.
    const byTask = new Map<string, { n: number; c: number }>();
    for (const a of graded) { const t = byTask.get(a.taskId) ?? { n: 0, c: 0 }; t.n++; if (a.status === 'pass') t.c++; byTask.set(a.taskId, t); }
    const passAtKs: Array<{ k: number; value: number }> = [];
    for (let k = 1; k <= job.input.repeats; k++) {
      const values = [...byTask.values()].map(t => passAtK(t.n, t.c, k)).filter((v): v is number => v !== null);
      if (values.length) passAtKs.push({ k, value: values.reduce((a, b) => a + b, 0) / values.length });
    }
    return { seat, agent: agentName(mine[0]?.agent ?? job.input.agents[seat]), pass, graded: graded.length, errors: mine.length - graded.length, passRate: graded.length ? pass / graded.length : null, passAtK: passAtKs,
      avgMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null, inputTokens: sumOrNull(mine.map(a => a.inputTokens)), outputTokens: sumOrNull(mine.map(a => a.outputTokens)),
      ...rubricOf(mine) };
  });
}

export function suiteReport(job: BenchJob, attempts: BenchAttempt[], format: ReportFormat, dataRoot: string) {
  const scrub = scrubber(dataRoot), agents = summarize(job, attempts);
  const tasks = [...new Map(attempts.map(a => [a.taskId, a])).values()].map(a => ({ id: a.taskId, title: a.title, mode: a.taskMode, version: a.taskVersion }));
  const suite = (job.input.suite ?? 'starter').split(/[\\/]/).filter(Boolean).at(-1) ?? 'starter';
  const version = attempts[0]?.version ?? '', simulated = attempts.some(a => a.simulation);
  const outcome = (taskId: string, seat: Seat) => attempts.filter(a => a.taskId === taskId && a.seat === seat).sort((a, b) => a.repeat - b.repeat);
  const mark = (a: BenchAttempt) => a.status === 'pass' ? 'pass' : a.status === 'fail' ? 'fail' : a.status;
  const title = `Benchmark report: ${suite}, ${job.createdAt.slice(0, 10)}`;
  const meta = [`Job ${job.id.slice(0, 8)} · ${job.status} · ${job.results.length}/${job.totalAttempts} attempts · ${job.input.repeats} repeat${job.input.repeats === 1 ? '' : 's'}`,
    `AvA ${version || 'unknown'} · started ${job.createdAt.replace('T', ' ').slice(0, 16)} UTC${simulated ? ' · simulated agents' : ''}`];
  // The judge's average, when any attempt was judged: shown beside the deterministic results, never merged with them.
  const judged = agents.some(a => a.judged), rubricCell = (a: AgentSummary) => a.rubric === null ? '—' : `${a.rubric.toFixed(1)}/10 (${a.judged})`;
  const filename = `ava-benchmark-${suite}-${job.createdAt.slice(0, 10)}-${job.id.slice(0, 8)}.${format === 'html' ? 'html' : 'md'}`;
  if (format === 'md') {
    const cell = (s: string) => scrub(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const lines = [`# ${title}`, '', ...meta.map(m => `${m}  `), '', '## Agents', '', `| Seat | Agent | Passed | Pass rate | pass@k | Avg time | Tokens in / out |${judged ? ' Rubric (judge) |' : ''}`, `| --- | --- | --- | --- | --- | --- | --- |${judged ? ' --- |' : ''}`,
      ...agents.map(a => `| ${a.seat} | ${cell(a.agent)} | ${a.pass}/${a.graded}${a.errors ? ` (${a.errors} errors)` : ''} | ${percent(a.passRate)} | ${a.passAtK.map(p => `@${p.k} ${percent(p.value)}`).join(', ') || '—'} | ${seconds(a.avgMs)} | ${a.inputTokens ?? '—'} / ${a.outputTokens ?? '—'} |${judged ? ` ${rubricCell(a)} |` : ''}`),
      '', '## Tasks', '', `| Task | Mode | ${agents.map(a => cell(a.agent)).join(' | ')} |`, `| --- | --- | ${agents.map(() => '---').join(' | ')} |`,
      ...tasks.map(t => `| ${cell(t.title)} (${t.id} v${t.version}) | ${t.mode} | ${SEATS.map(s => outcome(t.id, s).map(mark).join(', ') || '—').join(' | ')} |`), '', '## Evidence', ''];
    for (const a of [...attempts].sort((x, y) => x.taskId.localeCompare(y.taskId) || x.seat.localeCompare(y.seat) || x.repeat - y.repeat)) {
      lines.push(`### ${cell(a.title)}: ${a.seat} (${cell(agentName(a.agent))}), repeat ${a.repeat}: ${mark(a)}`, '', `Time ${seconds(a.durationMs)}.${a.error ? ` Error: ${cell(a.error)}` : ''}`, '');
      for (const c of a.checks) lines.push(`- **${c.kind}** ${c.passed ? 'passed' : 'failed'}${c.backend ? ` (${c.backend})` : ''}${c.exitCode !== undefined && c.exitCode !== null ? `, exit ${c.exitCode}` : ''}: ${cell(c.detail.slice(0, 400))}`);
      if (a.rubric) lines.push('', cell(judgeLine(a)));
      if (a.taskMode !== 'build' && a.answer) lines.push('', `Answer: ${cell(a.answer.slice(0, 600))}`);
      lines.push('');
    }
    return { filename, mediaType: 'text/markdown; charset=utf-8', text: lines.join('\n') };
  }
  const esc = (s: string) => scrub(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const badge = (a: BenchAttempt) => `<span class="${a.status === 'pass' ? 'pass' : 'fail'}">${esc(mark(a))}</span>`;
  const evidence = [...attempts].sort((x, y) => x.taskId.localeCompare(y.taskId) || x.seat.localeCompare(y.seat) || x.repeat - y.repeat).map(a => `<details><summary>${esc(a.title)}: ${a.seat} (${esc(agentName(a.agent))}), repeat ${a.repeat}: ${badge(a)} · ${seconds(a.durationMs)}</summary>
${a.error ? `<p class="fail">${esc(a.error)}</p>` : ''}<ul>${a.checks.map(c => `<li><b>${esc(c.kind)}</b> <span class="${c.passed ? 'pass' : 'fail'}">${c.passed ? 'passed' : 'failed'}</span>${c.backend ? ` <small>${esc(c.backend)}</small>` : ''}${c.exitCode !== undefined && c.exitCode !== null ? ` <small>exit ${c.exitCode}</small>` : ''}<pre>${esc(c.detail.slice(0, 1200))}</pre></li>`).join('')}</ul>${a.rubric ? `<p>${esc(judgeLine(a))}</p>` : ''}
${a.taskMode !== 'build' && a.answer ? `<p>Answer:</p><pre>${esc(a.answer.slice(0, 2000))}</pre>` : ''}</details>`).join('\n');
  const text = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--pass:#1a7f37;--fail:#c62828}
@media (prefers-color-scheme:dark){:root{--bg:#161618;--fg:#f2f2f4;--muted:#a1a1a6;--line:#3a3a3c;--pass:#4ac26b;--fail:#ff6b6b}}
body{margin:0 auto;max-width:1040px;padding:24px 16px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}p.meta{color:var(--muted);margin:2px 0}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;white-space:nowrap}
.pass{color:var(--pass);font-weight:600}.fail{color:var(--fail);font-weight:600}small{color:var(--muted)}
details{border:1px solid var(--line);border-radius:8px;padding:6px 10px;margin:6px 0}summary{cursor:pointer}
pre{white-space:pre-wrap;word-break:break-word;background:color-mix(in srgb,var(--fg) 6%,transparent);padding:6px 8px;border-radius:6px;margin:4px 0}
</style></head><body>
<h1>${esc(title)}</h1>${meta.map(m => `<p class="meta">${esc(m)}</p>`).join('')}
<h2>Agents</h2><table><thead><tr><th>Seat</th><th>Agent</th><th>Passed</th><th>Pass rate</th><th>pass@k</th><th>Avg time</th><th>Tokens in / out</th>${judged ? '<th>Rubric (judge)</th>' : ''}</tr></thead><tbody>
${agents.map(a => `<tr><td>${a.seat}</td><td>${esc(a.agent)}</td><td>${a.pass}/${a.graded}${a.errors ? ` <small>(${a.errors} errors)</small>` : ''}</td><td>${percent(a.passRate)}</td><td>${a.passAtK.map(p => `@${p.k} ${percent(p.value)}`).join(', ') || '—'}</td><td>${seconds(a.avgMs)}</td><td>${a.inputTokens ?? '—'} / ${a.outputTokens ?? '—'}</td>${judged ? `<td>${rubricCell(a)}</td>` : ''}</tr>`).join('\n')}
</tbody></table>
<h2>Tasks</h2><table><thead><tr><th>Task</th><th>Mode</th>${agents.map(a => `<th>${esc(a.agent)}</th>`).join('')}</tr></thead><tbody>
${tasks.map(t => `<tr><td>${esc(t.title)} <small>${esc(t.id)} v${t.version}</small></td><td>${esc(t.mode)}</td>${SEATS.map(s => `<td>${outcome(t.id, s).map(badge).join(' ') || '—'}</td>`).join('')}</tr>`).join('\n')}
</tbody></table>
<h2>Evidence</h2>
${evidence}
<p class="meta">Made by Agent vs Agent. Deterministic checks decide pass or fail.</p>
</body></html>
`;
  return { filename, mediaType: 'text/html; charset=utf-8', text };
}
