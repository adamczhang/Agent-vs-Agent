// Shared by the library service and room. Provider settings and permissions never belong to a prompt; a debate
// prompt's internet choice (G2) is applied through each agent's own internet switch when the debate starts.
import { DEFAULT_ROUNDS, MAX_ROUNDS, type AnswerCheck, type Stance } from './types.js';
export { DEFAULT_SPEECH_MINUTES } from './types.js';
export type PromptMode = 'all' | 'benchmark' | 'conversation' | 'build';
export interface PromptFile { id: string; name: string; mediaType: string; kind: 'text' | 'image'; size: number }
// The debate prompt template (G2, G6): the prompt text is the motion both agents debate. Each agent has its assigned
// side (stance), a private brief that only it sees (given through its 1:1 line before the debate starts), and internet
// on or off; the debate runs for its rounds.
export interface DebateAgent { stance: Stance; context: string; internet: boolean }
// speechMinutes: the time limit per speech (absent: the default, 2 minutes; 0: no limit).
export interface DebateSetup { rounds: number; speechMinutes?: number; agents: { cli1: DebateAgent; cli2: DebateAgent } }
// A debate prompt without its own setup (saved before G2) uses this one: Agent 1 for the motion and Agent 2 against, no
// private brief, internet off, and the default rounds.
export function defaultDebate(): DebateSetup { return { rounds: DEFAULT_ROUNDS, agents: { cli1: { stance: 'for', context: '', internet: false }, cli2: { stance: 'against', context: '', internet: false } } }; }
type Unsided = Omit<DebateAgent, 'stance'> & { stance?: Stance };
// A setup as saved or imported: sides may be absent (saved before G6).
export interface DebateInput { rounds: number; speechMinutes?: number; agents: { cli1: Unsided; cli2: Unsided } }
// A setup saved before sides existed (G2) argues Agent 1 for the motion and Agent 2 against.
export function withStances(setup: DebateInput): DebateSetup {
  return { rounds: setup.rounds, ...(setup.speechMinutes !== undefined ? { speechMinutes: setup.speechMinutes } : {}), agents: { cli1: { ...setup.agents.cli1, stance: setup.agents.cli1.stance ?? 'for' }, cli2: { ...setup.agents.cli2, stance: setup.agents.cli2.stance ?? 'against' } } };
}
// A debate prompt as one Markdown file (Export, and Import back): the motion, then each agent's section and the rounds.
export function debateMarkdown(text: string, debate: DebateSetup) {
  const agent = (n: 1 | 2, a: DebateAgent) => `## Agent ${n} (${a.stance} the motion; internet ${a.internet ? 'on' : 'off'})\n\n${a.context.trim() || '(none)'}`;
  return `${text.trimEnd()}\n\n---\n\n${agent(1, debate.agents.cli1)}\n\n${agent(2, debate.agents.cli2)}\n\nRounds: ${debate.rounds}\n${debate.speechMinutes !== undefined ? `Speech time: ${debate.speechMinutes} minutes\n` : ''}`;
}
// Also reads the format from before sides (G2): "## Agent 1 (private context, internet on)".
const HEADER = (n: number) => String.raw`## Agent ${n} \((?:(for|against) the motion; )?(?:private context, )?internet (on|off)\)`;
const DEBATE_FILE = new RegExp(String.raw`^([\s\S]*?)\n+---\n+` + HEADER(1) + String.raw`\n+([\s\S]*?)\n+` + HEADER(2) + String.raw`\n+([\s\S]*?)\n+Rounds: (\d+)(?:\s*\nSpeech time: (\d+) minutes?)?\s*$`);
export function parseDebateMarkdown(markdown: string): { text: string; debate: DebateSetup } | null {
  const match = markdown.replace(/\r\n/g, '\n').match(DEBATE_FILE);
  if (!match || !match[1]!.trim()) return null;
  const rounds = Number(match[8]), context = (value: string) => value.trim() === '(none)' ? '' : value.trim();
  if (rounds < 1 || rounds > MAX_ROUNDS) return null;
  const first = (match[2] as Stance | undefined) ?? 'for', second = (match[5] as Stance | undefined) ?? (first === 'for' ? 'against' : 'for');
  if (first === second) return null;
  const speech = match[9] !== undefined ? Number(match[9]) : undefined;
  return { text: match[1]!.trimEnd(), debate: { rounds, ...(speech !== undefined && speech <= 30 ? { speechMinutes: speech } : {}), agents: { cli1: { stance: first, context: context(match[4]!), internet: match[3] === 'on' }, cli2: { stance: second, context: context(match[7]!), internet: match[6] === 'on' } } } };
}
export interface SavedPrompt {
  id: string; revision: string; name: string; text: string; mode: PromptMode; buildKind: 'build' | 'review';
  files: PromptFile[]; createdAt: string; updatedAt: string;
  // Debate prompts saved with the template. Older debate prompts have none: they leave the room's options as they are.
  debate?: DebateSetup;
  // Prompt-mode prompts with an answer key (a challenge or a race), kept beside prompt.md in check.json.
  check?: AnswerCheck;
}
export interface PromptSummary extends Omit<SavedPrompt, 'revision'> { excerpt: string }
export interface PromptFileInput { id: string; name: string; attachmentId?: string }
export interface PromptSave {
  id: string; revision: string | null; name: string; text: string; mode: PromptMode;
  buildKind: 'build' | 'review'; files: PromptFileInput[]; debate?: DebateInput; check?: AnswerCheck;
}
