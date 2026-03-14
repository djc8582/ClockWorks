// Pre-scheduling transport — schedules entire cycles of notes ahead of time.
// Instead of per-tick note creation (fragile under JS thread pressure),
// this schedules all oscillators for a full cycle at once using
// osc.start(absoluteTime). The tick only needs to detect cycle boundaries.

export function createScheduler(audioContext, cycleDuration, onTick) {
  let interval = null;
  let running = false;
  let startTime = 0;
  let _cycleDuration = cycleDuration;
  let lastScheduledCycle = -1;
  const INTERVAL_MS = 50;
  const SCHEDULE_AHEAD = 2; // Schedule 2 cycles ahead

  function tick() {
    if (!running) return;
    const now = audioContext.currentTime;
    const currentCycle = Math.floor((now - startTime) / _cycleDuration);

    // Schedule upcoming cycles
    for (let c = currentCycle; c <= currentCycle + SCHEDULE_AHEAD; c++) {
      if (c > lastScheduledCycle) {
        lastScheduledCycle = c;
        const cycleStart = startTime + c * _cycleDuration;
        if (onTick) {
          onTick(cycleStart, c);
        }
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    startTime = audioContext.currentTime;
    lastScheduledCycle = -1;
    interval = setInterval(tick, INTERVAL_MS);
    tick(); // Immediately schedule first cycles
  }

  function stop() {
    running = false;
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  }

  function setCycleDuration(dur) {
    _cycleDuration = dur;
    // Reset scheduling on tempo change
    lastScheduledCycle = -1;
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

  return {
    start,
    stop,
    setCycleDuration,
    getLoopPosition,
    getCycleNumber,
    getSeconds,
    getStartTime,
  };
}
