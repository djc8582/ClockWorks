import { useEffect, useRef, useCallback } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { isAudioInitialized, getTransportSeconds, getCycleDuration } from '../audio/audioEngine.js';
import { updateSequencer } from '../sequencer.js';

// Drives the clock angle from audio transport time.
// Uses a Reanimated shared value so the angle update stays on the JS thread
// but does NOT trigger React re-renders. The Skia canvas reads the shared
// value directly, giving us 60fps clock hand movement with zero React overhead.
// Fix #10: isMounted guard prevents writes to shared value after unmount
export function useClockSync() {
  const clockAngle = useSharedValue(-Math.PI / 2);
  const rafId = useRef(null);
  const mounted = useRef(true);

  const tick = useCallback(() => {
    if (!mounted.current) return;
    if (isAudioInitialized()) {
      const t = getTransportSeconds();
      const cd = getCycleDuration();
      if (cd > 0) {
        const angle = (t / cd) * Math.PI * 2 - Math.PI / 2;
        clockAngle.value = angle;
        const cycleNumber = Math.floor(t / cd);
        updateSequencer(angle, cycleNumber);
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
