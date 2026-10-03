import test from 'node:test';
import assert from 'node:assert/strict';
import { replayTimeline } from '../ui/replay.js';

test('replay times follow recorded events, never go backwards, and tolerate missing events', () => {
  const at = (s: number) => new Date(Date.parse('2026-10-02T15:00:00Z') + s * 1000).toISOString();
  const messages = [{ id: 'topic' }, { id: 'a1' }, { id: 'b1' }, { id: 'human' }, { id: 'a2' }, { id: 'lost' }];
  const events = [
    { type: 'run_started', time: at(0), data: {} },
    { type: 'activity', time: at(1), data: { seat: 'cli1' } },
    { type: 'room_committed', time: at(12), data: { messageId: 'b1' } },
    { type: 'room_committed', time: at(10), data: { messageId: 'a1' } },
    { type: 'room_queued', time: at(15), data: { messageId: 'human' } },
    { type: 'room_committed', time: at(14), data: { messageId: 'a2' } }, // recorded earlier than the message before it
  ];
  const { offsets, total } = replayTimeline(messages, events);
  assert.deepEqual(offsets, { topic: 0, a1: 10_000, b1: 12_000, human: 15_000, a2: 15_000, lost: 15_000 });
  assert.equal(total, 15_000);
  assert.deepEqual(replayTimeline([{ id: 'x' }], []), { offsets: { x: 0 }, total: 0 });
});
