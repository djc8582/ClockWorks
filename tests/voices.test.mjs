import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickVictimIndex } from '../src/audio/voicePolicy.js';

const v = (start, silentAt, tap = false) => ({ start, silentAt, endTime: silentAt + 0.1, tap, killed: false });

test('evicts an already-silent voice before anything audible', () => {
  const pool = [v(0, 1.5), v(0.9, 2.0, true), v(0.2, 0.7), v(1.1, 1.5)];
  assert.equal(pickVictimIndex(pool, 1.0), 2);
});
test('then an unstarted tap, then a sounding tap', () => {
  assert.equal(pickVictimIndex([v(0.5, 2), v(0.8, 2, true), v(1.2, 3, true), v(1.3, 3)], 1.0), 2);
  assert.equal(pickVictimIndex([v(0.5, 2), v(0.8, 2, true), v(1.3, 3)], 1.0), 1);
});
test('then the oldest sounding note; future notes last; never the newest', () => {
  assert.equal(pickVictimIndex([v(1.2, 3), v(0.6, 2), v(0.4, 2), v(1.3, 3)], 1.0), 2);
  assert.equal(pickVictimIndex([v(1.2, 3), v(1.4, 3), v(1.3, 3)], 1.0), 1);
});
