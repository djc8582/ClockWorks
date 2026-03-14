// Custom transport loop — replaces Tone.Transport.
// Uses setInterval(25ms) on JS thread with 100ms lookahead.
// Events are scheduled against audioContext.currentTime so they play
// precisely on the native audio thread regardless of JS jitter.

export function createScheduler(audioContext, cycleDuration, onTick) {
  let interval = null;
  let running = false;
  let loopStart = 0; // audioContext.currentTime when loop last started
  let _cycleDuration = cycleDuration;
  const INTERVAL_MS = 25;
  const LOOKAHEAD_S = 0.1;

  function tick() {
    if (!running) return;
    const now = audioContext.currentTime;

    // Advance loopStart BEFORE tick so cycle numbers are correct
    const elapsed = now - loopStart;
    if (elapsed >= _cycleDuration) {
      const cyclesToAdvance = Math.floor(elapsed / _cycleDuration);
      loopStart += cyclesToAdvance * _cycleDuration;
    }

    const lookAheadEnd = now + LOOKAHEAD_S;
    if (onTick) {
      onTick(now, lookAheadEnd);
    }
  }

  function start() {
    if (running) return;
    running = true;
    loopStart = audioContext.currentTime;
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
    const elapsed = currentTime - loopStart;
    return ((elapsed % _cycleDuration) + _cycleDuration) % _cycleDuration;
  }

  function getCycleNumber(currentTime) {
    const elapsed = currentTime - loopStart;
    return Math.floor(elapsed / _cycleDuration);
  }

  function getSeconds() {
    return getLoopPosition(audioContext.currentTime);
  }

  return {
    start,
    stop,
    setCycleDuration,
    getLoopPosition,
    getCycleNumber,
    getSeconds,
  };
}
