import { useEffect, useRef, useCallback } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { isAudioInitialized, getTransportSeconds, getCycleDuration } from '../audio/audioEngine.js';
import { updateSequencer } from '../sequencer.js';

// Drives the clock angle from audio transport time.
// Uses a Reanimated shared value so the angle update stays on the JS thread
// but does NOT trigger React re-renders. The Skia canvas reads the shared
// value directly, giving us 60fps clock hand movement with zero React overhead.
export function useClockSync() {
  const clockAngle = useSharedValue(-Math.PI / 2);
  const rafId = useRef(null);

  const tick = useCallback(() => {
    if (isAudioInitialized()) {
      const t = getTransportSeconds();
      const cd = getCycleDuration();
      if (cd > 0) {
        const angle = (t / cd) * Math.PI * 2 - Math.PI / 2;
        clockAngle.value = angle;
        updateSequencer(angle);
      }
    }
    rafId.current = requestAnimationFrame(tick);
  }, [clockAngle]);

  useEffect(() => {
    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current != null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [tick]);

  return clockAngle;
}
