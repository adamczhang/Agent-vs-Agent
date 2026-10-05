import { readFileSync } from 'node:fs';
import { test, expect } from './fixture.js';
import { conversationConfig, SEATS, type Pair } from '../../src/types.js';
import { PUZZLES } from '../../src/games/crosscurrent-puzzles.js';

test('K1: completed Crosscurrent analysis finds a mistake, explores a legal alternative and preserves replay', async ({ page, room }, info) => {
  await room.service.call('resources.configure', { maxActiveAgents: 6, requestId: 'analysis-limit' });
  const pair = await room.service.call('pair.create', { thread: 'analysis-fixture' }) as Pair;
  for (const seat of SEATS) { await room.service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } }); await room.service.call('slot.activate', { pairId: pair.id, seat }); }
  const moves: string[] = JSON.parse(readFileSync(new URL('../fixtures/crosscurrent-tactics.json', import.meta.url), 'utf8')).moves;
  const { run } = room.service.store.start(pair.id, conversationConfig('Analysis fixture', { mode: 'game', game: { kind: 'crosscurrent', ruleset: 'three-edges-cooldown-v3', size: 7, first: 'cli1', moveMs: 120000, maxIllegal: 3 } }), 'analysis-fixture');
  moves.forEach((move, i) => room.service.store.addMessage(run.id, i % 2 ? 'cli2' : 'cli1', move, 'committed', null));
  room.service.store.updateRun(run.id, r => { r.status = 'completed'; r.reason = 'game_over'; r.game = { illegal: { cli1: 0, cli2: 0 }, result: { winner: 'cli1', reason: 'Circle connected at least three edges with the star' } }; });
  const saved = room.service.store.pair(pair.id); saved.activeRunId = null; room.service.store.savePair(saved);
  await page.goto(room.url);
  await page.getByRole('button', { name: /^Analysis fixture/ }).click();
  await page.getByRole('button', { name: 'Analyze game', exact: true }).click();
  const analysis = page.getByRole('region', { name: 'Game analysis' });
  await expect(analysis).toContainText('Analysis complete · 13 moves checked');
  await analysis.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('crosscurrent-analysis.png') });
  await analysis.getByRole('button', { name: 'Turn 12: Allowed an avoidable loss', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Crosscurrent board, 7 by 7' }).locator('.crosscurrent-stone')).toHaveCount(12);
  await analysis.getByRole('button', { name: /^Explore / }).first().click();
  const variation = page.getByRole('region', { name: 'Analysis variation' });
  await expect(variation).toContainText('Variation after turn 11');
  await variation.getByLabel('Variation move').fill('A1 ROW 99 LEFT');
  await variation.getByRole('button', { name: 'Play variation move', exact: true }).click();
  await expect(variation.getByRole('alert')).toBeVisible();
  await variation.getByRole('button', { name: 'Return to recorded game', exact: true }).click();
  await page.getByRole('button', { name: 'Latest position', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Crosscurrent board, 7 by 7' }).locator('.crosscurrent-stone')).toHaveCount(13);
  expect(room.service.store.messages(run.id).filter(m => m.sender !== 'user').map(m => m.text)).toEqual(moves);
});

test('K2: puzzle practice and paired agent results work through the room and survive reload', async ({ page, room }, info) => {
  await room.service.call('resources.configure', { maxActiveAgents: 6, requestId: 'puzzle-limit' });
  await page.goto(room.url); await page.getByRole('radio', { name: 'Gamer', exact: true }).click();
  await expect.poll(() => room.service.store.db.prepare("SELECT id FROM pairs WHERE thread LIKE 'room-mode:%:game'").get()).toBeTruthy();
  const pair = room.service.store.db.prepare("SELECT id FROM pairs WHERE thread LIKE 'room-mode:%:game'").get() as { id: string };
  for (const seat of SEATS) await room.service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } });
  await page.getByRole('button', { name: 'Puzzles', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Crosscurrent puzzles' });
  await expect(panel.getByLabel('Puzzle position').locator('option')).toHaveCount(20);
  await panel.getByLabel('Puzzle move').fill('A1 ROW 99 LEFT'); await panel.getByRole('button', { name: 'Check move' }).click();
  await expect(panel.getByRole('status')).toContainText('Illegal move');
  await panel.getByLabel('Puzzle move').fill(PUZZLES[0]!.solution); await panel.getByRole('button', { name: 'Check move' }).click();
  await expect(panel.getByRole('status')).toContainText('Correct');
  await page.screenshot({ path: info.outputPath('crosscurrent-puzzles.png') });
  await expect(panel.getByRole('button', { name: 'Compare agents on puzzles' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Compare agents on puzzles' }).click();
  await expect(panel.getByRole('region', { name: 'Puzzle results' })).toContainText('completed · 2/2 answers', { timeout: 15000 });
  await panel.getByRole('button', { name: 'Close puzzles' }).click(); await page.reload();
  await page.getByRole('button', { name: 'Puzzles', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Puzzle results' })).toContainText('completed · 2/2 answers');
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('crosscurrent-puzzles-mobile.png') });
});

test('K3: a paired debate series runs from the room, saves side swaps and exports its report', async ({ page, room }, info) => {
  test.setTimeout(60000);
  await room.service.call('resources.configure', { maxActiveAgents: 6, requestId: 'series-limit' });
  await page.goto(room.url); await page.getByRole('button', { name: 'Series', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Match series' });
  await panel.getByLabel('Series mode').selectOption('debate'); await panel.getByLabel('Series motion').fill('Teams should test claims before adopting them.');
  await panel.getByLabel('Series rounds').selectOption('1'); await panel.getByLabel('Series pairs').selectOption('1');
  await panel.getByRole('button', { name: 'Start series', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Series results' })).toContainText('completed · 2/2 matches', { timeout: 30000 });
  const job = room.service.series.jobs()[0]!;
  expect(job.matches.map(m => m.config.stances!.cli1)).toEqual(['for', 'against']);
  const download = page.waitForEvent('download'); await panel.getByRole('button', { name: 'Export Markdown', exact: true }).click();
  const saved = await download; expect(readFileSync((await saved.path())!, 'utf8')).toContain('Complete pairs: 1');
  await panel.getByRole('button', { name: 'Close series', exact: true }).click(); await page.reload();
  await page.getByRole('button', { name: 'Series', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Series results' })).toContainText('completed · 2/2 matches');
  await panel.getByRole('region', { name: 'Series results' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('paired-series.png') });
});

test('K4: preset preview shows actual supported effort and the selected game uses that effort and clock', async ({ page, room }, info) => {
  test.setTimeout(60000);
  await room.service.call('resources.configure', { maxActiveAgents: 6, requestId: 'profiles-limit' });
  await page.goto(room.url); await page.getByRole('radio', { name: 'Gamer', exact: true }).click();
  await page.getByRole('button', { name: 'Activate both', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Activate anyway', exact: true }).click();
  const setup = page.getByRole('region', { name: 'Game setup', exact: true });
  await expect(setup.getByRole('button', { name: 'Start chess', exact: true })).toBeEnabled({ timeout: 15000 });
  await expect(setup.getByLabel('Performance preset')).toHaveValue('quick');
  await setup.getByLabel('Performance preset').selectOption('standard');
  await expect(setup).toContainText('medium is unavailable; this model will use low.');
  await setup.getByLabel('Performance preset').selectOption('deep');
  await expect(setup.locator('.profile-selector')).toContainText('high effort');
  await expect(setup.getByRole('radio', { name: '5 min', exact: true })).toBeChecked();
  await setup.locator('.profile-selector').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('performance-presets.png') });
  await setup.getByRole('button', { name: 'Start chess', exact: true }).click();
  const gameRun = () => room.service.store.listRuns(undefined, 20).runs.map(r => room.service.store.run(r.id)).find(r => r.config.mode === 'game');
  await expect.poll(() => gameRun()?.config.profile).toBe('deep');
  const run = gameRun()!;
  expect(run.config.game!.moveMs).toBe(300000); expect(run.participants!.cli1.effort!.value).toBe('high');
  room.service.engine.stop(run.id);
});

test('K5: separate ballots, disagreement and presentation-order diagnostics are visible without replacing the verdict', async ({ page, room }, info) => {
  test.setTimeout(60000);
  await room.service.call('resources.configure', { maxActiveAgents: 8, requestId: 'judging-limit' });
  const pair = await room.service.call('pair.create', { thread: 'judging-fixture' }) as Pair;
  for (const seat of SEATS) { await room.service.call('slot.configure', { pairId: pair.id, seat, config: { provider: 'codex', model: 'sim-model', auth: 'provider-login' } }); await room.service.call('slot.activate', { pairId: pair.id, seat }); }
  const { run } = room.service.store.start(pair.id, conversationConfig('Judging transparency fixture', { stances: { cli1: 'for', cli2: 'against' }, rounds: 1 }), 'judging-fixture');
  room.service.store.addMessage(run.id, 'cli1', 'Evidence supports a bounded trial.', 'committed', null);
  room.service.store.addMessage(run.id, 'cli2', 'The trial needs an explicit comparison.', 'committed', null);
  const scores = { cli1: { evidence: 4, clash: 3, stance: 4 }, cli2: { evidence: 3, clash: 4, stance: 3 } };
  room.service.store.updateRun(run.id, r => { r.status = 'completed'; r.reason = 'rounds_done'; r.judgment = { status: 'done', judge: { provider: 'codex', model: 'sim-model', auth: 'provider-login' }, startedAt: new Date().toISOString(), scores, winner: 'cli1', reason: 'Original independent assessment.', panel: { cli1: { status: 'done', scores, winner: 'cli2', reason: 'The comparison answered my argument.' }, cli2: { status: 'done', scores, winner: 'cli2', reason: 'My comparison was stronger.' } } }; });
  const p = room.service.store.pair(pair.id); p.activeRunId = null; room.service.store.savePair(p);
  await page.goto(room.url); await page.getByRole('button', { name: /^Judging transparency fixture/ }).click();
  const ballot = page.getByRole('region', { name: 'Judge’s ballot' });
  await expect(ballot).toContainText('The panel result differs from the independent judge’s pick.');
  await expect(ballot.getByRole('region', { name: 'Participant reviews' })).toBeVisible();
  await ballot.getByRole('button', { name: /^Check presentation order · 4 requests$/ }).click();
  await expect.poll(() => room.service.store.run(run.id).judgment!.orderChecks?.at(-1)?.status, { timeout: 15000 }).toBe('done');
  await expect(ballot.getByRole('region', { name: 'Judging presentation order' })).toContainText(/Both presentation orders chose|presentation orders produced different/);
  expect(room.service.store.run(run.id).judgment!.winner).toBe('cli1');
  expect(room.service.store.run(run.id).judgment!.orderChecks!.at(-1)!.requestsAdmitted).toBe(4);
  await page.screenshot({ path: info.outputPath('judging-diagnostics.png') });
});
