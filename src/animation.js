// Easing functions — copied verbatim from web app.
// The animation driver (addAnimation/updateAnimations) is NOT used in RN;
// Reanimated shared values + withTiming replace it.
// These easing math helpers are still useful for Skia draw callbacks.

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

export function easeInQuad(t) {
  return t * t;
}
