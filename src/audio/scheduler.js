// Simple interval-based scheduler.
// Fires a callback with the current loop position every tick.

export function createScheduler(audioContext, cycleDuration, onTick) {
  let interval = null;
  let running = false;
  let startTime = 0;
  let _cycleDuration = cycleDuration;
  const INTERVAL_MS = 25;

  function tick() {
    if (!running) return;
    const now = audioContext.currentTime;
    const elapsed = now - startTime;
    const loopPos = ((elapsed % _cycleDuration) + _cycleDuration) % _cycleDuration;
    if (onTick) onTick(loopPos, now);
  }

  function start() {
    if (running) return;
    running = true;
    startTime = audioContext.currentTime;
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
    _cycleDuration = dur;
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

  return { start, stop, setCycleDuration, getLoopPosition, getCycleNumber, getSeconds };
}
