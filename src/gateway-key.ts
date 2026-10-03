// Agent vs Agent's Vercel AI Gateway key, kept in the data folder for AvA only. Run it yourself, in a terminal (from a
// checkout: npm run gateway-key -- <command>; it ships as dist/src/gateway-key.js):
//   set           paste a key you already have (hidden; nothing is echoed)
//   create 25     create one with your Vercel login, $25 a month (25–1000)
//   status        where the key comes from, and whether the Gateway accepts it
//   forget        remove AvA's stored key (it stays in your Vercel account)
// The key is never printed. AI_GATEWAY_API_KEY in the environment, if set, takes precedence over the stored key.
import { installedDataRoot } from './paths.js';
import { createGatewayKey, forgetGatewayKey, gatewayKey, gatewayKeyStatus, saveGatewayKey } from './gateway.js';

const [command = 'status', arg] = process.argv.slice(2), dataRoot = installedDataRoot();
function hidden(prompt: string) {
  return new Promise<string>(done => {
    process.stdout.write(prompt);
    const stdin = process.stdin; let text = '';
    if (!stdin.isTTY) { stdin.setEncoding('utf8'); stdin.on('data', c => { text += c; }); stdin.on('end', () => done(text.trim())); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const read = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', read); process.stdout.write('\n'); done(text.trim()); return; }
        if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { if (text) { text = text.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        text += ch; process.stdout.write('*');
      }
    };
    stdin.on('data', read);
  });
}
// Whether the Gateway accepts the key, asked without using any model (the credits endpoint costs nothing).
async function check(key: string) {
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/credits', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (r.status === 401 || r.status === 403) return 'the Gateway REFUSED it';
    if (!r.ok) return `couldn't check (HTTP ${r.status})`;
    const body = await r.json() as { balance?: string | number };
    return `the Gateway accepts it${body.balance !== undefined ? ` (credit balance ${body.balance})` : ''}`;
  } catch (e) { return `couldn't check (${e instanceof Error ? e.message : String(e)})`; }
}
const describe = () => { const s = gatewayKeyStatus(dataRoot); return s.source === 'none' ? 'No key yet.' : s.source === 'environment' ? `Using AI_GATEWAY_API_KEY from the environment (…${s.ending}).` : `Using Agent vs Agent's stored key (…${s.ending}${s.budget ? `, ${s.budget}` : ''}).`; };

if (command === 'set') {
  const key = await hidden('Paste your AI Gateway API key and press Enter (it will not be shown): ');
  if (key.length < 20 || /\s/.test(key)) { console.error('That doesn’t look like a key; nothing was stored.'); process.exit(1); }
  const verdict = await check(key);
  if (verdict.includes('REFUSED')) { console.error(`Not stored: ${verdict}.`); process.exit(1); }
  saveGatewayKey(dataRoot, key, { name: 'your key', budget: '' });
  console.log(`Stored for Agent vs Agent in ${dataRoot}\\secrets (…${key.slice(-4)}); ${verdict}.`);
} else if (command === 'create') {
  const budget = Number(arg ?? 25);
  if (!Number.isInteger(budget) || budget < 25 || budget > 1000) { console.error('Give a whole-dollar monthly budget from 25 to 1000, e.g. create 25.'); process.exit(1); }
  console.log(`Creating an AI Gateway key named "agent-vs-agent" with your Vercel login, $${budget} a month…`);
  await createGatewayKey(dataRoot, budget);
  console.log(`${describe()} ${await check(gatewayKey(dataRoot)!.key)}.`);
} else if (command === 'forget') {
  forgetGatewayKey(dataRoot); console.log(`Removed. ${describe()}`);
} else {
  const found = gatewayKey(dataRoot);
  console.log(`${describe()}${found ? ` Check: ${await check(found.key)}.` : ''}`);
}
