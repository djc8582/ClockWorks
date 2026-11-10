import { useEffect, useRef, useCallback } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { isAudioInitialized, getVisualTransport, getCycleDuration } from '../audio/audioEngine.js';
import { updateSequencer } from '../sequencer.js';

const TOP = -Math.PI / 2;

// Drives the clock angle from audio transport time.
// Uses a Reanimated shared value so the angle update does NOT trigger React
// re-renders; the Skia canvas reads the shared value directly.
//
// The transport is read through getVisualTransport(), which smooths the
// audio clock between render callbacks (currentTime only advances once per
// ~10–23ms IO buffer, which made the hand judder at 60/120 Hz) and costs a
// single JSI currentTime read per frame (was two).
// Fix #10: isMounted guard prevents writes to shared value after unmount
export function useClockSync() {
  const clockAngle = useSharedValue(TOP);
  const rafId = useRef(null);
  const mounted = useRef(true);
  const lastAngle = useRef(TOP);

  const tick = useCallback((frameTs) => {
    if (!mounted.current) return;
    if (isAudioInitialized()) {
      const cd = getCycleDuration();
      if (cd > 0) {
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : frameTs;
        const tr = getVisualTransport(now);
        const loop = tr ? tr.loop : 0;
        const angle = (loop / cd) * Math.PI * 2 + TOP;
        // Skip the cross-thread write when nothing moved (paused/stopped):
        // no needless UI-thread canvas redraws while idle
        if (angle !== lastAngle.current) {
          lastAngle.current = angle;
          clockAngle.value = angle;
        }
        // Raw elapsed time for cycle counting (loop is already wrapped).
        // Only while the transport runs: stopped, there is no clock to
        // follow — feeding cycle 0 snapped the canvas/strip back to the bar
        // playback started on, and undid a bar the user picked while paused.
        if (tr) updateSequencer(angle, Math.floor(tr.elapsed / cd));
      }
    }
    rafId.current = requestAnimationFrame(tick);
  }, [clockAngle]);

  useEffect(() => {
    mounted.current = true;
    rafId.current = requestAnimationFrame(tick);
    return () => {
      mounted.current = false;
      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [tick]);

  return clockAngle;
}
