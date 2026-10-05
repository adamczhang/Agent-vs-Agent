// Reproducible selection from the verified J15 games. Reference moves stay on the service side.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { crosscurrent } from '../src/games/crosscurrent.js';
import { actionText, children, escape, fromProduction, outcome, stateKey, wins } from '../src/games/crosscurrent-tactics.js';
const output = 'src/games/crosscurrent-puzzles.json';
if (existsSync(output)) throw new Error('Refusing to overwrite the curated puzzle set.');
const categories = ['win', 'defend', 'cooldown', 'force'] as const, selected: Array<Record<string, unknown>> = [], seen = new Set<string>(), counts = { win: 0, defend: 0, cooldown: 0, force: 0 };
const instructions = {
  win: 'Find a move that wins immediately after the shift.',
  defend: 'Find a move that avoids losing immediately or on the opponent’s next reply. A draw also succeeds.',
  cooldown: 'Find a move that avoids immediate defeat specifically by resting a line: with that cooldown removed, the opponent would have a winning reply.',
  force: 'Find a move that forces your win within this move and your next move, against every legal opponent reply.',
};
const names = { win: 'Finish the connection', defend: 'Find a defense', cooldown: 'Make cooldown count', force: 'Force the finish' };
for (const file of readdirSync('pilot-evidence/stage-d').filter(f => /^j15-(match|self)-.*\.json$/.test(f)).sort()) {
  const data = JSON.parse(readFileSync(`pilot-evidence/stage-d/${file}`, 'utf8'));
  for (const [game, g] of (data.match?.games ?? data.self.games).entries()) {
    let position = crosscurrent.start(); const prefix: string[] = [];
    for (const action of g.moves as number[]) {
      const s = fromProduction(position), key = stateKey(s);
      if (!seen.has(key) && s.ply >= 10 && s.ply <= 40) {
        const immediate = wins(s, true), all = children(s); let goal: typeof categories[number] | undefined, solution: number | undefined;
        if (counts.win < 5 && immediate.length) { goal = 'win'; solution = immediate[0]; }
        else if (!immediate.length) {
          const risky = all.some(c => c.winner === 3 - s.turn || c.winner === null && wins(c.state, true).length > 0);
          if (risky && counts.cooldown < 5) { solution = all.find(c => c.winner === null && !wins(c.state, true).length && wins(c.state, true, false).length > 0)?.action; if (solution !== undefined) goal = 'cooldown'; }
          if (!goal && risky && counts.defend < 5) { solution = escape(s)?.action; if (solution !== undefined) goal = 'defend'; }
          const decision = g.decisions.find((d: { ply: number }) => d.ply === s.ply);
          if (!goal && counts.force < 5 && decision?.certifiedFork) { goal = 'force'; solution = action; }
        }
        if (goal && solution !== undefined) {
          counts[goal]++; seen.add(key);
          selected.push({ id: `cc-${goal}-${counts[goal]}`, version: 1, title: `${names[goal]} ${counts[goal]}`, goal, instruction: instructions[goal], position: crosscurrent.position(position), solution: actionText(solution), source: { file, game, prefix: [...prefix] } });
        }
      }
      const move = actionText(action); prefix.push(move); position = crosscurrent.play(position, move).state;
    }
    if (categories.every(c => counts[c] === 5)) break;
  }
  if (categories.every(c => counts[c] === 5)) break;
}
assert.deepEqual(counts, { win: 5, defend: 5, cooldown: 5, force: 5 });
selected.sort((a, b) => categories.indexOf(a.goal as typeof categories[number]) - categories.indexOf(b.goal as typeof categories[number]) || String(a.id).localeCompare(String(b.id)));
writeFileSync(output, JSON.stringify(selected, null, 2)); console.log(JSON.stringify({ output, counts }));
