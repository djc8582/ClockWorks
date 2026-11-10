globalThis.__DEV__ = false;
import { createScheduler } from '../src/audio/scheduler.js';
import { collectWindowEvents, planTick } from '../src/audio/eventWindow.js';

export function makeShape(sides, subdivision = 1, opts = {}) {
  const vertices = [];
  for (let i = 0; i < sides; i++) {
    const subs = [];
    for (let s = 1; s < subdivision; s++) subs.push({ pitches: [62], velocity: 80, muted: false });
    vertices.push({ pitches: [60 + i], velocity: 90, muted: false, subs });
  }
  return { id: opts.id || `s${sides}-${subdivision}-${Math.random()}`, sides, subdivision, vertices, timbre: 'epiano' };
}

// Simulated transport: fake audio clock quantized to an IO buffer, a fake
// setInterval, and the engine's real collect+plan pipeline.
export function makeSim({ scenes, sceneForCycle = () => 0, cycleDur = 2, ioBuffer = 512 / 48000, softCap = 12, hardCap = 64 }) {
  let host = 10;          // continuous "true" time (s)
  const ctx = { get currentTime() { return Math.floor(host / ioBuffer) * ioBuffer; }, state: 'running' };
  let timerFn = null;
  const timers = { setInterval: (fn) => { timerFn = fn; return 1; }, clearInterval: () => { timerFn = null; } };
  const scheduled = [];
  let stalls = 0;
  const onTick = (from, to, start, cd, now) => {
    const evs = collectWindowEvents({ scenes, sceneForCycle, transportStart: start, cycleDur: cd, from, to, minEventSpacing: 0.02 });
    const plan = planTick(evs, now, { softCap, hardCap, horizon: 0.08 });
    for (const e of plan.schedule) scheduled.push({ ...e, at: now, start, cd });
    return plan.resumeAt != null ? plan.resumeAt : undefined;
  };
  const sch = createScheduler(ctx, cycleDur, onTick, { timers, onStall: () => { stalls++; } });
  return {
    ctx, sch, scheduled,
    get stalls() { return stalls; },
    get host() { return host; },
    advance(sec, tickEvery = 0.05, jitter = 0) {
      const end = host + sec;
      while (host < end) {
        host += tickEvery + (jitter ? (Math.random() - 0.5) * jitter : 0);
        if (timerFn) timerFn();
      }
    },
    setHost(h) { host = h; },
  };
}
