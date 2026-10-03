// Full live validation: every live suite for every provider, providers in parallel and each provider's suites in turn,
// then one matrix. Each suite runs the real service in its own temporary data folder (see the suite scripts).
// Usage: node --import tsx scripts/live-validate.ts [--providers codex,claude,...] [--suites acceptance,review,...]
//        [--out <dir>]   (default test-results/validation)
// Live requests, about: acceptance 16, review 4, build-app 14, permissions 4 per provider (provider-login; the Vercel AI
// Gateway uses its stored key and spends credit). A suite that fails doesn't stop the provider's next suite.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2), option = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const providers = (option('--providers') ?? 'codex,claude,grok-build,antigravity,vercel').split(',');
const SUITES: Record<string, string> = { acceptance: 'live-acceptance.ts', review: 'live-build.ts', 'build-app': 'live-build-app.ts', permissions: 'live-permissions.ts' };
const suites = (option('--suites') ?? Object.keys(SUITES).join(',')).split(',');
const out = resolve(option('--out') ?? 'test-results/validation');
mkdirSync(out, { recursive: true });
// Evidence names no user folder: the home directory (as written in JSON or plain text) becomes %USERPROFILE%.
const HOME = homedir(), HOME_FORMS = [HOME, HOME.replaceAll('\\', '\\\\'), HOME.replaceAll('\\', '/')];
const scrub = (text: string) => HOME_FORMS.reduce((t, form) => t.split(form).join('%USERPROFILE%'), text);
const stamp = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

interface Outcome { provider: string; suite: string; status: string; minutes: number; failed: string[]; notes: string[]; checks: number; passed: number }
function runSuite(provider: string, suite: string): Promise<Outcome> {
  const file = join(out, `${suite}-${provider}.json`), log = join(out, `${suite}-${provider}.log`), started = Date.now();
  return new Promise(done => {
    const child = spawn(process.execPath, ['--import', 'tsx', join('scripts', SUITES[suite]!), '--provider', provider, '--out', file], { windowsHide: true, env: process.env });
    let text = '';
    child.stdout.on('data', d => { text += d; }); child.stderr.on('data', d => { text += d; });
    child.on('close', code => {
      writeFileSync(log, scrub(text));
      if (existsSync(file)) writeFileSync(file, scrub(readFileSync(file, 'utf8')));
      let report: { status?: string; checks?: Array<{ name: string; pass: boolean; soft?: boolean }> } = {};
      try { report = JSON.parse(readFileSync(file, 'utf8')); } catch { /* the suite ended before writing */ }
      const checks = report.checks ?? [];
      const outcome = { provider, suite, status: report.status ?? (code === 0 ? 'passed' : 'failed'), minutes: Math.round((Date.now() - started) / 6000) / 10,
        failed: checks.filter(c => !c.pass && !c.soft).map(c => c.name), notes: checks.filter(c => !c.pass && c.soft).map(c => c.name), checks: checks.length, passed: checks.filter(c => c.pass).length };
      console.log(`${stamp()} ${outcome.status === 'passed' ? 'PASS' : 'FAIL'} ${provider} ${suite}: ${outcome.passed}/${outcome.checks} checks, ${outcome.minutes} min${outcome.failed.length ? ` — ${outcome.failed.join('; ')}` : ''}`);
      done(outcome);
    });
  });
}
console.log(`${stamp()} validating ${providers.join(', ')}: ${suites.join(', ')}`);
const outcomes = (await Promise.all(providers.map(async provider => { const list: Outcome[] = []; for (const suite of suites) list.push(await runSuite(provider, suite)); return list; }))).flat();
const summary = { recordedAt: new Date().toISOString(), providers, suites, outcomes, status: outcomes.every(o => o.status === 'passed') ? 'passed' : 'failed' };
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\n' + ['suite'.padEnd(12), ...providers.map(p => p.padEnd(13))].join(''));
for (const suite of suites) console.log([suite.padEnd(12), ...providers.map(p => { const o = outcomes.find(x => x.provider === p && x.suite === suite)!; return `${o.status === 'passed' ? 'ok' : 'FAIL'} ${o.passed}/${o.checks}`.padEnd(13); })].join(''));
console.log(JSON.stringify({ status: summary.status, out: existsSync(out) ? out : undefined }));
process.exit(summary.status === 'passed' ? 0 : 1);
