import { analyzeGame } from '../src/games/crosscurrent-analysis.js';
self.onmessage = (event: MessageEvent<{ moves: string[] }>) => {
  try { const entries = analyzeGame(event.data.moves, entry => self.postMessage({ kind: 'progress', entry })); self.postMessage({ kind: 'done', entries }); }
  catch (error) { self.postMessage({ kind: 'error', error: error instanceof Error ? error.message : String(error) }); }
};
