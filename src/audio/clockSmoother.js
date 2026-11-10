// Smooth, monotonic estimate of the audio clock for the clock hand (pure —
// unit-tested under Node).
//
// audioContext.currentTime only advances once per render callback (the
// iOS IO buffer: ~10–23ms). Sampled at 60/120 Hz it holds still for 1–2
// frames and then jumps — the hand visibly judders and is up to one buffer
// behind the scheduled notes. The true clock is ≈ the MAX of
// (currentTime − hostTime) over recent samples; we track that offset with a
// slow leak (to follow clock drift), extrapolate with the host clock, and
// clamp so we never lead the audio clock by more than `maxLeadSec` (a
// stalled/suspended engine makes the estimate hold instead of running away).
export function createClockSmoother({ maxLeadSec = 0.05, stallSec = 0.06, leakPerSec = 0.002 } = {}) {
  let offset = null;
  let lastHost = null;
  let lastOut = -Infinity;

  function reset() { offset = null; lastHost = null; lastOut = -Infinity; }

  // audioNow: currentTime (s). hostMs: performance.now() (ms).
  function sample(audioNow, hostMs) {
    const host = hostMs / 1000;
    const raw = audioNow - host;
    if (offset === null) {
      offset = raw;
    } else if (raw > offset) {
      offset = raw;                                  // a render callback just landed
    } else if (offset - raw > stallSec) {
      offset = raw;                                  // engine stalled / resumed: resync
    } else if (lastHost !== null) {
      const dt = Math.max(0, host - lastHost);
      offset = Math.max(raw, offset - leakPerSec * dt); // follow slow drift
    }
    lastHost = host;
    let est = Math.min(host + offset, audioNow + maxLeadSec);
    // Monotonic: after a resync, hold until the estimate catches up rather
    // than jumping backwards (a backward jump is a visible hand twitch).
    if (est < lastOut && lastOut - est <= maxLeadSec + 0.001) est = lastOut;
    lastOut = est;
    return est;
  }

  return { sample, reset };
}
