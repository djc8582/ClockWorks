// Pure scheduling math shared by the live engine, the tests and (via
// stepPhase) the MIDI exporter — one definition of "when does step k of a
// ring sound", so audio, visuals and export can't drift apart.
//
// No React Native imports: unit-tested under Node.

// Phase (0..1 within the cycle) of step `stepIndex` of a ring with
// `totalSteps` evenly spaced steps (sides × subdivision). The clock hand is
// at angle phase·2π − π/2 at that moment, i.e. exactly on the dot.
export function stepPhase(stepIndex, totalSteps) {
  return totalSteps > 0 ? stepIndex / totalSteps : 0;
}

// How a shape is played at a given cycle length: subdivision cap + the
// extreme-tempo thinning (never two events of one shape closer than
// minEventSpacing — drop subdivisions first, then stride across vertices).
export function getShapePlan(shape, cycleDur, minEventSpacing, maxSub = 4) {
  const sides = shape && shape.sides;
  if (!sides || sides <= 0 || !(cycleDur > 0)) return null;
  const interval = cycleDur / sides;
  let sub = Math.max(1, Math.min(shape.subdivision || 1, maxSub));
  if (interval / sub < minEventSpacing) {
    sub = Math.max(1, Math.floor(interval / minEventSpacing));
  }
  const vertexStride = interval < minEventSpacing
    ? Math.ceil(minEventSpacing / interval)
    : 1;
  return { sides, sub, interval, subInterval: interval / sub, vertexStride };
}

// All playable events with time in [from, to), sorted by time (ties keep
// ring order). `scenes[sceneForCycle(n)]` supplies the shapes of cycle n.
export function collectWindowEvents({
  scenes, sceneForCycle, transportStart, cycleDur, from, to,
  minEventSpacing = 0.02, maxCyclesPerTick = 2,
}) {
  const out = [];
  if (!scenes || !(cycleDur > 0) || !isFinite(from) || !isFinite(to) || !(from < to)) return out;
  const relFrom = from - transportStart;
  const relTo = to - transportStart;
  const firstCycle = Math.max(0, Math.floor(relFrom / cycleDur));
  const lastCycle = Math.min(firstCycle + maxCyclesPerTick, Math.floor(relTo / cycleDur));

  for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
    const sceneIdx = sceneForCycle ? sceneForCycle(cycle) : 0;
    const scene = scenes[sceneIdx];
    const shapes = scene && scene.shapes;
    if (!shapes || shapes.length === 0) continue;
    const cycleStart = transportStart + cycle * cycleDur;

    for (let order = 0; order < shapes.length; order++) {
      const shape = shapes[order];
      if (!shape || !shape.vertices) continue;
      const plan = getShapePlan(shape, cycleDur, minEventSpacing);
      if (!plan) continue;
      const { sides, sub, interval, subInterval, vertexStride } = plan;
      for (let i = 0; i < sides; i++) {
        if (i % vertexStride !== 0) continue;
        const v = shape.vertices[i];
        if (!v) continue;
        for (let s = 0; s < sub; s++) {
          const time = cycleStart + i * interval + s * subInterval;
          if (time < from || time >= to) continue;
          const stepData = s === 0 ? v : (v.subs && v.subs[s - 1]);
          if (!stepData || stepData.muted) continue;
          out.push({ time, shape, order, vertexIndex: i, subIndex: s, stepData, cycle });
        }
      }
    }
  }
  out.sort((a, b) => (a.time - b.time) || (a.order - b.order));
  return out;
}

// Decide what to schedule this tick. The old engine broke out of its loops
// after 12 notes and advanced the window anyway — the overflow was lost
// forever, and always from the OUTER rings (loop order), e.g. with >12
// rings the outer ones never sounded on the downbeat.
//
// Now: everything due before `now + horizon` (i.e. before the next tick can
// run) is always scheduled; beyond softCap the remaining FUTURE events are
// deferred to the next tick (returned as `resumeAt`, which the scheduler
// uses as the next window start). Simultaneous events are never split.
// hardCap is a last-resort safety valve against pathological bursts.
export function planTick(events, now, { softCap = 12, hardCap = 64, horizon = 0.08 } = {}) {
  const n = events.length;
  let count = 0;
  for (let k = 0; k < n; k++) {
    const ev = events[k];
    const sameTimeAsPrev = k > 0 && ev.time === events[k - 1].time;
    if (count >= softCap && ev.time >= now + horizon && !sameTimeAsPrev) {
      return { schedule: events.slice(0, k), resumeAt: ev.time, dropped: 0 };
    }
    if (count >= hardCap && !sameTimeAsPrev) {
      return { schedule: events.slice(0, k), resumeAt: null, dropped: n - k };
    }
    count++;
  }
  return { schedule: events, resumeAt: null, dropped: 0 };
}
