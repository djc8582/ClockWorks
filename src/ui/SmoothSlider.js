// Slider that doesn't fight the finger.
// A controlled @react-native-community/slider re-applies its `value` prop while
// it's being dragged; when the store lags the finger (throttling, re-renders),
// the thumb jitters or snaps back. While a drag is on we hold the prop at the
// value the drag started from (an unchanged prop is never re-applied natively),
// and hand control back to the store once the finger lifts.
import React, { useState, useCallback } from 'react';
import Slider from '@react-native-community/slider';

export default function SmoothSlider({ value, onValueChange, onSlidingStart, onSlidingComplete, ...rest }) {
  const [held, setHeld] = useState(null);
  const start = useCallback((v) => {
    setHeld(v);
    if (onSlidingStart) onSlidingStart(v);
  }, [onSlidingStart]);
  const complete = useCallback((v) => {
    if (onValueChange) onValueChange(v);
    setHeld(null);
    if (onSlidingComplete) onSlidingComplete(v);
  }, [onValueChange, onSlidingComplete]);
  return (
    <Slider
      {...rest}
      value={held !== null ? held : value}
      onValueChange={onValueChange}
      onSlidingStart={start}
      onSlidingComplete={complete}
    />
  );
}
