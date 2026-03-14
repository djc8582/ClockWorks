import { useEffect, useRef, useState } from 'react';
import { isAudioInitialized, getTransportSeconds, getCycleDuration } from '../audio/audioEngine.js';
import { updateSequencer } from '../sequencer.js';

// Drives the clock angle from audio transport time.
// Full 60fps for tight visual-audio sync.
export function useClockSync() {
  const [clockAngle, setClockAngle] = useState(-Math.PI / 2);
  const rafId = useRef(null);

  useEffect(() => {
    function tick() {
      if (isAudioInitialized()) {
        const t = getTransportSeconds();
        const cd = getCycleDuration();
        if (cd > 0) {
          const angle = (t / cd) * Math.PI * 2 - Math.PI / 2;
          setClockAngle(angle);
          updateSequencer(angle);
        }
      }
      rafId.current = requestAnimationFrame(tick);
    }

    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return clockAngle;
}
