import type { QuickPlan } from '../src/quick.js';
import type { AgentUsage, JudgeProvider, Judgment, Pair, ProviderConfig, RoomMessage, Seat, Stance } from '../src/types.js';

// Shapes returned by the service's thread calls (src/service.ts threads.list / thread.get).
export type Mode = 'conversation' | 'benchmark' | 'build';
export interface ThreadSummary { id: string; pairId: string; title: string; named: boolean; mode: Mode | null; createdAt: string | null; updatedAt: string | null; runIds: string[]; prompts: number; replies: number; requests: number; directMessages: number; status: string; reason: string | null; live: boolean; current: boolean; participants: Record<Seat, ProviderConfig> | null; empty: boolean; verdict?: Verdict | null }
export interface AttachmentRef { id: string; name: string; mediaType: string; size: number; kind: 'image' | 'text' }
// Mirrors the service's attachment rules so most mistakes are caught before upload (the service still decides).
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const TEXT_NAME = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|toml|ini|xml|html?|css|scss|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|ps1|sql|log|diff|patch|cfg|conf)$/i;
export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
// A direct (1:1) message: the user and one agent, inside that agent's session; never shown in the room or to the other agent.
export interface DirectMessage { id: string; seat: Seat; sender: 'user' | 'agent'; text: string; state: string; error: string | null; time: string }
export const directStates: Record<string, string> = { pending: 'Waiting for a reply', cancelled: 'Cancelled', failed: 'Not answered', interrupted: 'Interrupted by a restart; not resent' };
// A judged debate's result in the thread list.
export interface Verdict { status: 'judging' | 'done' | 'failed'; winner?: Seat; totals?: Record<Seat, number> }
export interface ThreadRun { id: string; status: string; reason: string | null; createdAt: string | null; elapsedMs: number; requests: number; config: { topic: string; completion: string; rounds?: number; stances?: Record<Seat, Stance>; judge?: { provider: JudgeProvider }; speechMs?: number; durationMs: number; maxRequests: number; mode?: Mode; build?: { kind: 'review' | 'build'; source: string; folder: string } | null }; participants: Record<Seat, ProviderConfig> | null; judgment?: Judgment | null }
export type ThreadMessage = RoomMessage & { time: string | null };
export interface ThreadView { thread: ThreadSummary | null; runs: ThreadRun[]; messages: ThreadMessage[]; direct: { messages: DirectMessage[]; pending: Partial<Record<Seat, { partial: string; steps?: string[] }>> } }
export interface SearchHit { runId: string; threadId: string; messageId: string; sender: string; snippet: string; runTopic: string; runCreatedAt: string | null; participants: Record<Seat, ProviderConfig> | null; judgment?: Judgment | null }
export type PairView = Pair & { connected: Record<Seat, boolean>; images?: Record<Seat, boolean>; usage?: Record<Seat, AgentUsage | null>; mode: 'live' | 'simulation'; version?: string; quick?: Record<Seat, QuickPlan>; activeRun: { id: string; status: string; reason: string | null; mode?: Mode; nextSeat?: Seat; speaking?: Seat[]; queued?: number } | null };
export interface PresetData { instructions: Record<Seat, string>; stopWhen: Record<Seat, string>; completion: 'duration' | 'either' | 'both' | 'rounds' | 'auto'; rounds?: string;
  // Internet for each agent, set by a debate prompt or in Options; applied through the agent's switch when the debate
  // starts. Absent: the switch stays as it is.
  internet?: Partial<Record<Seat, boolean>>;
  // A formal debate (G6, G7): each agent's side (Agent 1 for the motion unless swapped) and the judge (Claude Code unless changed).
  stances?: Record<Seat, Stance>; judge?: JudgeProvider | 'off';
  // The time limit per speech in minutes ('0': none; absent: the default).
  speech?: string;
  minutes: string; requests: string; pace: string; opening?: 'both' | Seat }
export interface Preset { id: string; name: string; data: PresetData }

export const seats: Seat[] = ['cli1', 'cli2'];
export const names: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', 'grok-build': 'Grok Build', antigravity: 'Antigravity', cursor: 'Cursor', vercel: 'Vercel' };
const initialsOf: Record<string, string> = { codex: 'Cx', claude: 'Cl', 'grok-build': 'Gk', antigravity: 'Ag', cursor: 'Cu', vercel: 'Vc' };
export const initials = (provider?: string | null) => (provider && initialsOf[provider]) || '··';
export const TERMINAL = new Set(['stopped', 'completed']);
export const ACTIVE = new Set(['running', 'pausing', 'paused', 'stopping']);
export const statusNames: Record<string, string> = { running: 'Discussing', pausing: 'Pausing after these replies', paused: 'Paused', stopping: 'Stopping', stopped: 'Stopped', completed: 'Finished', needs_attention: 'Needs attention', ready: 'Ready' };
export const reasons: Record<string, string> = {
  duration_reached: 'Reached its time limit', request_limit: 'Reached its request limit', user_stop: 'Stopped by you', agents_done: 'The agents reached a stopping point', rounds_done: 'Finished its rounds',
  service_interrupted: 'The service restarted; nothing was resent', turn_timeout: 'A reply took too long', invalid_response: 'An agent could not produce a valid reply',
  uncertain: 'A cancellation was not confirmed', benchmark_done: 'Both agents answered', build_done: 'Both agents reported', agent_unfinished: 'An agent stopped without finishing (its screen says why)', provider_cancelled: 'A provider cancelled a reply', provider_failure: 'A provider reported an error',
  cleanup_failed: 'A provider session did not confirm it closed', reconciled: 'Released after checking no provider process was still running',
};
export const reasonText = (reason: string | null) => reason ? reasons[reason] ?? reason.replaceAll('_', ' ') : '';

export const duration = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
export function dayLabel(iso: string | null, now = new Date()) {
  if (!iso) return 'Earlier';
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  return 'Earlier';
}
// Sidebar time: clock time today, weekday this week, otherwise a short date.
export function shortTime(iso: string | null, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso), days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return clock(iso);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export const fullDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : '';
export function delivery(m: ThreadMessage) {
  if (m.sender !== 'user') return '';
  if (m.state === 'queued') return 'Queued for both agents';
  if (m.state === 'not_delivered') return 'Not delivered';
  if (m.deliveredTo?.length === 1) return `Received by Agent ${m.deliveredTo[0] === 'cli1' ? 1 : 2} only so far`;
  return '';
}
// How each provider's internet switch is enforced (verified live on every CLI; see docs/architecture.md, Internet switch).
export const internetEnforcement: Record<string, string> = {
  claude: 'Enforced instantly: AvA allows or refuses each web search and page fetch as it is asked.',
  codex: 'Enforced by Codex itself: switching restarts Codex in the same session, so it keeps its memory. Takes a few seconds.',
  'grok-build': 'Enforced by Grok itself (--disable-web-search): switching restarts Grok in the same session, so it keeps its memory. Takes a few seconds.',
  antigravity: 'Enforced instantly: AvA allows or refuses each web search as it is asked.',
  cursor: 'Enforced instantly: AvA runs Cursor with web searches set to ask, and allows or refuses each one as it is asked.',
  vercel: 'The Gateway agent has no built-in web search; the switch lets its commands reach the network (it restarts, keeping its memory).',
};
export const plural =(n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
