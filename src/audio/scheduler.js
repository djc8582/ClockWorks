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

  function tick() {
    if (!running) return;
    const now = audioContext.currentTime;

    // If we've fallen far behind (JS thread stall), don't try to schedule
    // events more than 50ms in the past — they'd sound late anyway.
    const from = Math.max(nextScheduleTime, now - 0.05);
    const to = now + LOOKAHEAD_SEC;

    if (from < to && onTick) {
      onTick(from, to, startTime, _cycleDuration);
    }

    nextScheduleTime = to;
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

  function setCycleDuration(dur) {
    // If duration hasn't changed, skip — resetting nextScheduleTime when
    // nothing changed causes the next tick's window to overlap with the
    // already-scheduled window, double-firing every event in the overlap.
    if (dur === _cycleDuration) return;
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

  // Force the next tick to re-scan from now — used after scene transitions
  // so the new scene's beat-0 notes aren't missed.
  function resetScheduleWindow() {
    if (running) {
      nextScheduleTime = audioContext.currentTime;
    }
  }

  function getLoopPosition(currentTime) {
    const elapsed = currentTime - startTime;
    return ((elapsed % _cycleDuration) + _cycleDuration) % _cycleDuration;
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

  return { start, stop, setCycleDuration, resetScheduleWindow, getLoopPosition, getCycleNumber, getSeconds, getStartTime };
}
