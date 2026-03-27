// Lookahead scheduler using setInterval + audioContext.currentTime.
//
// Uses non-overlapping schedule windows: each tick schedules events in
// [nextScheduleTime, now + LOOKAHEAD]. Windows never overlap, so events
// are guaranteed to fire exactly once without any deduplication logic.
// If the JS thread stalls, the next tick automatically catches up by
// scheduling a larger window.

export function createScheduler(audioContext, cycleDuration, onTick) {
  let interval = null;
  let running = false;
  let startTime = 0;
  let _cycleDuration = cycleDuration;
  let nextScheduleTime = 0;

  const INTERVAL_MS = 50;        // how often the JS timer fires (was 25ms)
  const LOOKAHEAD_SEC = 0.15;    // schedule 150ms ahead — fewer ticks = fewer JSI bursts
  const MAX_WINDOW_SEC = 0.4;    // Never schedule more than 400ms in one tick (prevents burst after stall)
  let lastNow = 0;
  let frozenCount = 0;
  let ticking = false;            // Re-entrancy guard

  function tick() {
    if (!running || !audioContext || ticking) return;
    ticking = true;
    try {
      const now = audioContext.currentTime;
      if (!isFinite(now)) return;

      // Watchdog: detect frozen AudioContext (known iOS bug in react-native-audio-api)
      if (now === lastNow && now !== 0) {
        frozenCount++;
        if (frozenCount > 10) {
          try { audioContext.resume(); } catch (e) {}
          frozenCount = 0;
          // Fall through to schedule after resume
        } else {
          return;
        }
      }
      frozenCount = 0;
      lastNow = now;

      // If we've fallen far behind (JS thread stall), don't try to schedule
      // events more than 50ms in the past — they'd sound late anyway.
      // Also cap the window to MAX_WINDOW_SEC to prevent a huge burst.
      const from = Math.max(nextScheduleTime, now - 0.05);
      const to = Math.min(now + LOOKAHEAD_SEC, from + MAX_WINDOW_SEC);

      if (from < to && onTick && _cycleDuration > 0) {
        onTick(from, to, startTime, _cycleDuration);
      }

      nextScheduleTime = to;
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (running) return;
    running = true;
    startTime = audioContext.currentTime;
    nextScheduleTime = startTime;
    interval = setInterval(tick, INTERVAL_MS);
  }

  function stop() {
    running = false;
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }

  // Resume without resetting startTime — preserves playback position
  function resume() {
    if (running) return;
    running = true;
    nextScheduleTime = audioContext.currentTime;
    interval = setInterval(tick, INTERVAL_MS);
  }

  function setCycleDuration(dur) {
    // If duration hasn't changed, skip — resetting nextScheduleTime when
    // nothing changed causes the next tick's window to overlap with the
    // already-scheduled window, double-firing every event in the overlap.
    if (!dur || dur <= 0 || dur === _cycleDuration) return;
    if (running && _cycleDuration > 0) {
      // Preserve clock position when BPM changes
      const now = audioContext.currentTime;
      const elapsed = now - startTime;
      const progress = ((elapsed % _cycleDuration) + _cycleDuration) % _cycleDuration / _cycleDuration;
      startTime = now - progress * dur;
      // Reset schedule cursor so we don't miss/double events near the change
      nextScheduleTime = now;
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
    return Math.floor((currentTime - startTime) / _cycleDuration);
  }

  function getSeconds() {
    return getLoopPosition(audioContext.currentTime);
  }

  function getStartTime() {
    return startTime;
  }

  function isRunning() { return running; }

  return { start, stop, resume, isRunning, setCycleDuration, resetScheduleWindow, getLoopPosition, getElapsed, getCycleNumber, getSeconds, getStartTime };
}
