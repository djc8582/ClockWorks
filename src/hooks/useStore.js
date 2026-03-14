import { useSyncExternalStore, useCallback, useRef } from 'react';
import { subscribe, getState } from '../state.js';

// Bridge state.js to React via useSyncExternalStore.
// selector(state) returns a derived value; component re-renders only when it changes.
export function useStore(selector) {
  // Use ref to hold latest selector so getSnapshot is stable
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const getSnapshot = useCallback(() => {
    const state = getState();
    if (!state) return undefined;
    return selectorRef.current ? selectorRef.current(state) : state;
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Convenience: returns the full state (triggers on any change)
export function useFullState() {
  return useSyncExternalStore(subscribe, getState, getState);
}
