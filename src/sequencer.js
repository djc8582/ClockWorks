// Sequencer: maps transport cycles → scenes using the phrase-loop playback
// order. Scene scheduling is SAMPLE-ACCURATE: the audio engine asks
// getSceneForCycle(n) inside its lookahead window before scheduling each
// cycle, so scene boundaries land exactly on cycle boundaries with the
// transport running continuously (no resets, no kills, no rAF latency).
// The UI follows the audio clock via updateSequencer (display only).
import { getState, loadScene } from './state.js';
import { setSceneProvider, getElapsedSeconds, getCycleDuration } from './audio/audioEngine.js';
import { TIMING } from './constants.js';

let playbackOrder = [0];
let startOffset = 0; // rotates the order so playback starts on the active scene
let autoAdvanceEnabled = false;

function initSequencer() {
  autoAdvanceEnabled = true;
  // The audio engine consults this when scheduling each cycle
  setSceneProvider(getSceneForCycle);
}

function orderStep(cycleNumber) {
  const per = Math.max(1, TIMING.sceneCycles);
  return Math.floor(Math.max(0, cycleNumber) / per);
}

// Pure mapping: which scene does transport cycle N belong to?
function getSceneForCycle(cycleNumber) {
  const len = playbackOrder.length;
  if (len === 0) return 0;
  return playbackOrder[(startOffset + orderStep(cycleNumber)) % len];
}

// Anchor startOffset so the cycle playing RIGHT NOW keeps its scene —
// used when the order is rebuilt mid-playback or playback (re)starts.
function anchorToActiveScene() {
  const state = getState();
  const len = playbackOrder.length;
  const idx = playbackOrder.indexOf(state.activeSceneIndex);
  let step = 0;
  const cd = getCycleDuration();
  if (cd > 0) step = orderStep(Math.floor(getElapsedSeconds() / cd));
  if (idx >= 0) {
    startOffset = (((idx - step) % len) + len) % len;
  } else {
    // Active scene no longer in the order (slot was disabled) — fall back
    // to the order's start; playback flips to a valid scene next cycle
    startOffset = ((len - (step % len)) % len);
  }
}

// Build the playback order from enabled slots.
// Consecutive enabled slots form a "phrase" that repeats to fill gaps.
// Example: slots 0,1 enabled + slot 4 enabled → [0, 1, 0, 1, 4]
function rebuildPlaybackOrder() {
  const state = getState();
  const enabled = state.enabledSlots || [true];

  let lastEnabled = 0;
  for (let i = enabled.length - 1; i >= 0; i--) {
    if (enabled[i]) { lastEnabled = i; break; }
  }

  if (lastEnabled === 0) {
    playbackOrder = [0];
  } else {
    const order = [];
    let currentPhrase = [];
    let phraseStartedAt = 0;

    for (let pos = 0; pos <= lastEnabled; pos++) {
      if (enabled[pos]) {
        // Fill gap before this slot by repeating the current phrase
        if (order.length < pos && currentPhrase.length > 0) {
          while (order.length < pos) {
            const gapIdx = order.length - phraseStartedAt;
            order.push(currentPhrase[gapIdx % currentPhrase.length]);
          }
        }
        order.push(pos);

        // Track consecutive phrases
        if (currentPhrase.length > 0) {
          const lastInPhrase = currentPhrase[currentPhrase.length - 1];
          if (pos === lastInPhrase + 1) {
            currentPhrase.push(pos);
          } else {
            currentPhrase = [pos];
            phraseStartedAt = pos;
          }
        } else {
          currentPhrase = [pos];
          phraseStartedAt = pos;
        }
      }
    }

    playbackOrder = order.length > 0 ? order : [0];
  }

  anchorToActiveScene();
}

// Display-side follower: called every frame from useClockSync. The audio
// is already correct — this only keeps the canvas/scene strip in step.
function updateSequencer(clockAngle, cycleNumber) {
  if (!autoAdvanceEnabled) return;
  if (cycleNumber === undefined) return;
  const target = getSceneForCycle(cycleNumber);
  const state = getState();
  if (!state || !state.scenes || !state.scenes[target]) return;
  if (target !== state.activeSceneIndex) {
    loadScene(target);
  }
}

// Play (re)start: begin the order at the currently active scene
function resetCycleCount() {
  anchorToActiveScene();
}

export { initSequencer, updateSequencer, resetCycleCount, rebuildPlaybackOrder, getSceneForCycle };
