import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSim, makeShape } from './helpers.mjs';
import { SCHEDULER } from '../src/audio/scheduler.js';

const key = (e) => `${e.cycle}:${e.order}:${e.vertexIndex}:${e.subIndex}`;

test('first downbeat is scheduled synchronously on start, in the future', () => {
  const sim = makeSim({ scenes: [{ shapes: [makeShape(3)] }] });
  const now = sim.ctx.currentTime;
  sim.sch.start();
  assert.ok(sim.scheduled.length >= 1, 'downbeat queued inside start()');
  const first = sim.scheduled[0];
  assert.equal(first.vertexIndex, 0);
  assert.ok(first.time > now, 'downbeat is not in the past');
  assert.ok(Math.abs(first.time - (now + SCHEDULER.START_DELAY_SEC)) < 1e-9);
});

test('every step is scheduled exactly once, on time, across jittery ticks', () => {
  const shapes = [makeShape(3), makeShape(4, 2), makeShape(5, 3), makeShape(7, 4)];
  const sim = makeSim({ scenes: [{ shapes }], cycleDur: 2 });
  sim.sch.start();
  sim.advance(20, 0.05, 0.03);
  const seen = new Set();
  for (const e of sim.scheduled) {
    assert.ok(!seen.has(key(e)), 'duplicate ' + key(e));
    seen.add(key(e));
    assert.ok(e.time >= e.at - SCHEDULER.LATE_SEC - 1e-9, 'scheduled too late');
  }
  // Completeness: cycles 0..8 must be complete (3 + 8 + 15 + 28 = 54 steps)
  for (let c = 0; c < 9; c++) {
    assert.equal(sim.scheduled.filter(e => e.cycle === c).length, 54, 'cycle ' + c);
  }
});

test('dense downbeat with 20 rings: nothing is dropped (old cap lost outer rings)', () => {
  const shapes = Array.from({ length: 20 }, (_, i) => makeShape(4 + (i % 5), 4));
  const sim = makeSim({ scenes: [{ shapes }], cycleDur: 2 });
  sim.sch.start();
  sim.advance(6.5);
  const expectedPerCycle = shapes.reduce((n, s) => n + s.sides * 4, 0);
  for (let c = 0; c < 3; c++) {
    const evs = sim.scheduled.filter(e => e.cycle === c);
    assert.equal(evs.length, expectedPerCycle, 'cycle ' + c);
    assert.equal(new Set(evs.map(key)).size, evs.length);
    // every ring sounds on the downbeat
    assert.equal(evs.filter(e => e.vertexIndex === 0 && e.subIndex === 0).length, 20);
  }
  // deferred events are still queued ahead of time
  for (const e of sim.scheduled) assert.ok(e.time >= e.at, 'deferred event went late');
});

test('tempo change mid-play: no doubled/dropped steps, cycle count preserved', () => {
  const shapes = [makeShape(4, 2), makeShape(3)];
  const sim = makeSim({ scenes: [{ shapes }], cycleDur: 2 });
  sim.sch.start();
  sim.advance(5.3);
  const cycleBefore = sim.sch.getCycleNumber(sim.ctx.currentTime);
  const phaseBefore = sim.sch.getLoopPosition(sim.ctx.currentTime) / 2;
  // Slider drag: many small changes in quick succession, faster then slower
  let cd = 2;
  for (let k = 0; k < 30; k++) { cd = 2 - k * 0.03; sim.sch.setCycleDuration(cd); sim.advance(0.016, 0.016); }
  for (let k = 0; k < 30; k++) { cd = cd + 0.05; sim.sch.setCycleDuration(cd); sim.advance(0.016, 0.016); }
  assert.ok(sim.sch.getCycleNumber(sim.ctx.currentTime) >= cycleBefore, 'cycle counter did not reset');
  sim.advance(10);
  const seen = new Set();
  for (const e of sim.scheduled) { assert.ok(!seen.has(key(e)), 'double ' + key(e)); seen.add(key(e)); }
  const lastFull = sim.sch.getCycleNumber(sim.ctx.currentTime) - 1;
  for (let c = 0; c <= lastFull; c++) {
    assert.equal(sim.scheduled.filter(e => e.cycle === c).length, 11, 'cycle ' + c + ' complete');
  }
  assert.ok(phaseBefore >= 0);
});

test('single tempo change keeps exact musical position', () => {
  const sim = makeSim({ scenes: [{ shapes: [makeShape(4)] }], cycleDur: 2 });
  sim.sch.start();
  sim.advance(7.3);
  const t = sim.ctx.currentTime;
  const phase = sim.sch.getElapsed(t) / 2;
  sim.sch.setCycleDuration(1.5);
  assert.ok(Math.abs(sim.sch.getElapsed(t) / 1.5 - phase) < 1e-9);
});

test('frozen audio clock triggers onStall (engine recovery), not silent resume', () => {
  const sim = makeSim({ scenes: [{ shapes: [makeShape(3)] }] });
  sim.sch.start();
  sim.advance(1);
  const frozenAt = sim.host;
  const realCtxTime = sim.ctx.currentTime;
  Object.defineProperty(sim.ctx, 'currentTime', { get: () => realCtxTime, configurable: true });
  sim.advance(0.6);
  assert.equal(sim.stalls, 1);
  assert.ok(frozenAt > 0);
});

test('resume after background keeps the cursor (no doubled lookahead notes)', () => {
  const sim = makeSim({ scenes: [{ shapes: [makeShape(8, 2)] }], cycleDur: 2 });
  sim.sch.start();
  sim.advance(3);
  sim.sch.stop();
  // context suspended → clock frozen; then resumed
  sim.sch.resume();
  sim.advance(3);
  const seen = new Set();
  for (const e of sim.scheduled) { assert.ok(!seen.has(key(e)), 'double ' + key(e)); seen.add(key(e)); }
});
