import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { createClockSmoother } from '../src/audio/clockSmoother.js';
import { makeSim, makeShape } from './helpers.mjs';
import { getVertexAngle } from '../src/shapes.js';

// Audio clock that advances in IO-buffer steps, with the host clock offset
function quantized(trueT, buf) { return Math.floor(trueT / buf) * buf; }

for (const buf of [256 / 48000, 512 / 48000, 1024 / 44100]) {
  test(`smoothed clock tracks true time within 3ms at 120Hz (IO buffer ${(buf * 1000).toFixed(1)}ms)`, () => {
    const sm = createClockSmoother();
    const hostOffset = 1234.5; // host clock epoch differs from audio clock
    let prev = -Infinity, maxErr = 0, rawMaxErr = 0;
    for (let k = 0; k < 120 * 30; k++) {
      const trueT = 3 + k / 120 + (Math.random() - 0.5) * 0.002; // frame jitter
      const est = sm.sample(quantized(trueT, buf), (trueT + hostOffset) * 1000);
      assert.ok(est >= prev, 'monotonic');
      prev = est;
      if (k > 20) {
        maxErr = Math.max(maxErr, Math.abs(est - trueT));
        rawMaxErr = Math.max(rawMaxErr, Math.abs(quantized(trueT, buf) - trueT));
      }
    }
    assert.ok(maxErr < 0.003, `max err ${maxErr * 1000}ms (raw currentTime err ${rawMaxErr * 1000}ms)`);
  });
}

test('smoothed clock holds (never runs away or jumps back) when the engine stalls', () => {
  const sm = createClockSmoother();
  const buf = 512 / 48000;
  let audio = 0, prev = -Infinity;
  for (let k = 0; k < 600; k++) {
    const host = k / 60;
    const stalled = k >= 200 && k < 260; // 1s stall
    if (!stalled) audio += 1 / 60;
    const est = sm.sample(quantized(audio, buf), host * 1000);
    assert.ok(est >= prev - 1e-12, 'no backward jump at frame ' + k);
    assert.ok(est <= quantized(audio, buf) + 0.05 + 1e-9, 'lead capped');
    prev = est;
  }
  // after recovery it converges back onto the audio clock
  assert.ok(Math.abs(prev - audio) < 0.003);
});

test('the hand is exactly on each dot when its note is scheduled', () => {
  const shapes = [makeShape(3), makeShape(5, 2), makeShape(7, 3), makeShape(24, 4)];
  const sim = makeSim({ scenes: [{ shapes }], cycleDur: 2 });
  sim.sch.start();
  sim.advance(4);
  sim.sch.setCycleDuration(1.37); // also after a tempo change
  sim.advance(4);
  for (const e of sim.scheduled) {
    if (e.subIndex !== 0) continue;
    // hand angle at the note's audio time, as computed by useClockSync
    const loop = sim.sch.getLoopPosition(e.time);
    const handAngle = (loop / sim.sch.getCycleDuration()) * Math.PI * 2 - Math.PI / 2;
    const dot = getVertexAngle(e.vertexIndex, e.shape.sides);
    const d = Math.atan2(Math.sin(handAngle - dot), Math.cos(handAngle - dot));
    if (e.time < sim.host - 1.5) continue; // only check events under the current tempo
    assert.ok(Math.abs(d) < 1e-6, `hand off dot by ${d} rad`);
  }
});
