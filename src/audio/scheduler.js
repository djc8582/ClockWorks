// Lookahead scheduler using setInterval + audioContext.currentTime.
//
// Uses non-overlapping schedule windows: each tick schedules events in
// [nextScheduleTime, now + LOOKAHEAD). Windows never overlap, so events
// are guaranteed to fire exactly once without any deduplication logic.
// If the JS thread stalls, the next tick automatically catches up by
// scheduling a larger window.
//
// onTick(from, to, startTime, cycleDuration, now) may return a time in
// (from, to) — "I only got this far" — and the next tick resumes there.
// The engine uses that to spread a dense burst of notes over two ticks
// instead of silently dropping the overflow.
//
// Pure module (no React Native imports) — unit-tested under Node.

export const SCHEDULER = {
  INTERVAL_MS: 50,       // how often the JS timer fires
  LOOKAHEAD_SEC: 0.15,   // schedule 150ms ahead — fewer ticks = fewer JSI bursts
  MAX_WINDOW_SEC: 0.4,   // never schedule more than 400ms in one tick (burst cap after a stall)
  LATE_SEC: 0.05,        // after a stall, events older than this are skipped (they'd sound late)
  // First downbeat is placed this far after "now" on start: the very first
  // window is scheduled synchronously in start(), so the downbeat lands in
  // the future instead of being clamped late by however long the first JS
  // tick + first render callback take (was: up to ~50ms late + flammed).
  START_DELAY_SEC: 0.05,
  FROZEN_TICKS: 10,      // ~500ms of a frozen audio clock while running = stall
};

export function createScheduler(audioContext, cycleDuration, onTick, options = {}) {
  const timers = options.timers || { setInterval, clearInterval };
  const onStall = options.onStall || null;
  let interval = null;
  let running = false;
  let startTime = 0;
  let _cycleDuration = cycleDuration;
  let nextScheduleTime = 0;

  const { INTERVAL_MS, LOOKAHEAD_SEC, MAX_WINDOW_SEC, LATE_SEC, START_DELAY_SEC, FROZEN_TICKS } = SCHEDULER;
  let lastNow = -1;
  let frozenCount = 0;
  let ticking = false;            // Re-entrancy guard

  function tick() {
    if (!running || !audioContext || ticking) return;
    ticking = true;
    try {
      const now = audioContext.currentTime;
      if (!isFinite(now)) return;

      // Watchdog: a frozen clock while we think we're playing means the
      // native engine stopped underneath us (phone call / Siri interruption,
      // AirPods connect/disconnect → AVAudioEngine configuration change).
      // On 0.6.5, resume() alone is a no-op in that state (the JS context
      // still reports 'running'), so hand recovery to the engine (onStall),
      // which forces a full suspend→resume cycle.
      if (now === lastNow) {
        frozenCount++;
        if (frozenCount > FROZEN_TICKS) {
          frozenCount = 0;
          if (onStall) { try { onStall(); } catch (e) {} }
        }
        // While frozen, the window [nextScheduleTime, now+LOOKAHEAD) is
        // already scheduled — nothing to do.
        return;
      }
      frozenCount = 0;
      lastNow = now;

      // If we've fallen far behind (JS thread stall), don't try to schedule
      // events more than LATE_SEC in the past — they'd sound late anyway.
      // Also cap the window to MAX_WINDOW_SEC to prevent a huge burst.
      const from = Math.max(nextScheduleTime, now - LATE_SEC);
      const to = Math.min(now + LOOKAHEAD_SEC, from + MAX_WINDOW_SEC);
      if (!(from < to)) return;

      let reached = to;
      if (onTick && _cycleDuration > 0) {
        const r = onTick(from, to, startTime, _cycleDuration, now);
        // Only accept a partial window that still makes progress
        if (typeof r === 'number' && isFinite(r) && r > from && r < to) reached = r;
      }
      nextScheduleTime = reached;
    } catch (e) {
      // An exception escaping a setInterval callback is an uncaught JS error
      // (a hard crash in release builds) — never let the tick throw.
      if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[scheduler] tick error:', e?.message || e);
    } finally {
      ticking = false;
    }
  }

  function startTimer() {
    if (interval === null) interval = timers.setInterval(tick, INTERVAL_MS);
  }

  function start() {
    if (running) return;
    running = true;
    const now = audioContext.currentTime;
    startTime = now + START_DELAY_SEC;
    nextScheduleTime = startTime;
    lastNow = -1;
    frozenCount = 0;
    startTimer();
    tick(); // schedule the downbeat now, not 50ms from now
  }

  function stop() {
    running = false;
    if (interval !== null) {
      timers.clearInterval(interval);
      interval = null;
    }
  }

  // Resume without resetting startTime — preserves playback position.
  // The schedule cursor is kept: everything before it is already queued in
  // the native graph (the context was suspended, so those notes are still
  // in the future). Rewinding it re-scheduled that window → doubled notes
  // after returning from background / Control Center.
  // Pass { rewind: true } only if the queued voices were killed.
  function resume(opts) {
    if (running) return;
    running = true;
    const now = audioContext.currentTime;
    nextScheduleTime = (opts && opts.rewind) ? now : Math.max(nextScheduleTime, now);
    lastNow = -1;
    frozenCount = 0;
    startTimer();
    tick();
  }

  // Tempo change mid-play. Preserves the musical position INCLUDING the
  // cycle count (the old code kept only the in-cycle phase, which reset the
  // cycle counter to 0 → scene sequencing jumped back to the first scene on
  // every BPM nudge). The schedule cursor is mapped by musical phase too, so
  // every step is scheduled exactly once across the change: steps before
  // the cursor were queued under the old grid, steps after it will be
  // queued under the new grid — no doubles, no drops.
  function setCycleDuration(dur) {
    if (!dur || dur <= 0 || !isFinite(dur) || dur === _cycleDuration) return;
    if (running && _cycleDuration > 0) {
      const now = audioContext.currentTime;
      const phaseNow = (now - startTime) / _cycleDuration;           // cycles, incl. count
      const phaseCursor = (nextScheduleTime - startTime) / _cycleDuration;
      startTime = now - phaseNow * dur;
      nextScheduleTime = Math.max(now, startTime + phaseCursor * dur);
    }
    _cycleDuration = dur;
  }

  // Reset for scene transitions: start a fresh cycle from NOW so
  // beat 0 of the new scene fires immediately.
  function resetScheduleWindow() {
    if (running && audioContext) {
      const now = audioContext.currentTime;
      startTime = now;
      nextScheduleTime = now;
      // Force immediate tick to schedule beat 0 of new scene without waiting 50ms
      tick();
    }
  }

  function getLoopPosition(currentTime) {
    const elapsed = Math.max(0, currentTime - startTime);
    return elapsed % _cycleDuration;
  }

  function getElapsed(currentTime) {
    return Math.max(0, currentTime - startTime);
  }

  function getCycleNumber(currentTime) {
    return Math.floor(Math.max(0, currentTime - startTime) / _cycleDuration);
  }

  function getSeconds() {
    return getLoopPosition(audioContext.currentTime);
  }

  function getStartTime() {
    return startTime;
  }

  function getCycleDuration() { return _cycleDuration; }
  function getNextScheduleTime() { return nextScheduleTime; }

  function isRunning() { return running; }

  return {
    start, stop, resume, isRunning, setCycleDuration, resetScheduleWindow,
    getLoopPosition, getElapsed, getCycleNumber, getSeconds, getStartTime,
    getCycleDuration, getNextScheduleTime, tick,
  };
}
