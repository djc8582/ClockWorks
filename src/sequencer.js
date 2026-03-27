import { getState, loadScene } from './state.js';
import { transitionScene, isAudioInitialized } from './audio/audioEngine.js';
import { TIMING } from './constants.js';

let lastCycleNumber = -1;
let cyclesSinceSceneStart = 0;
let autoAdvanceEnabled = false;
let playbackOrder = [0]; // precomputed sequence of scene indices
let playbackPosition = 0;

function initSequencer() {
  autoAdvanceEnabled = true;
}

// Build the playback order from enabled slots using consecutive phrase looping.
// Consecutive enabled slots form a "phrase" that repeats to fill gaps.
function buildPlaybackOrder() {
  const state = getState();
  const enabled = state.enabledSlots || [true];

  // Find highest enabled slot
  let lastEnabled = 0;
  for (let i = enabled.length - 1; i >= 0; i--) {
    if (enabled[i]) { lastEnabled = i; break; }
  }

  // If only slot 0, no sequence
  if (lastEnabled === 0) {
    playbackOrder = [0];
    return;
  }

  const order = [];
  let phrase = []; // current consecutive enabled phrase
  let gapStart = -1;

  for (let pos = 0; pos <= lastEnabled; pos++) {
    if (enabled[pos]) {
      // If we were in a gap, fill it by repeating the phrase
      if (gapStart >= 0 && phrase.length > 0) {
        for (let g = gapStart; g < pos; g++) {
          order.push(phrase[(g - gapStart) % phrase.length]);
        }
        gapStart = -1;
      }
      // Add this position and extend phrase if consecutive
      order.push(pos);
      if (phrase.length === 0 || pos === order.length - 2 + 1) {
        // Check if consecutive with previous enabled
        phrase.push(pos);
      } else {
        // Not consecutive — start new phrase
        phrase = [pos];
      }
    } else {
      // Start or continue gap
      if (gapStart < 0) gapStart = pos;
    }
  }

  playbackOrder = order.length > 0 ? order : [0];
}

// Simpler, correct implementation
function rebuildPlaybackOrder() {
  const state = getState();
  const enabled = state.enabledSlots || [true];

  let lastEnabled = 0;
  for (let i = enabled.length - 1; i >= 0; i--) {
    if (enabled[i]) { lastEnabled = i; break; }
  }

  if (lastEnabled === 0) {
    playbackOrder = [0];
    return;
  }

  const order = [];
  let currentPhrase = [];
  let phraseStartedAt = 0;

  for (let pos = 0; pos <= lastEnabled; pos++) {
    if (enabled[pos]) {
      // Fill any gap before this slot using the current phrase
      if (order.length < pos && currentPhrase.length > 0) {
        while (order.length < pos) {
          const gapIdx = order.length - phraseStartedAt;
          order.push(currentPhrase[gapIdx % currentPhrase.length]);
        }
      }
      order.push(pos);

      // Check if this is consecutive with the last enabled
      if (currentPhrase.length > 0) {
        const lastInPhrase = currentPhrase[currentPhrase.length - 1];
        if (pos === lastInPhrase + 1) {
          // Consecutive — extend phrase
          currentPhrase.push(pos);
        } else {
          // Gap before this — start new phrase
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

function updateSequencer(clockAngle, cycleNumber) {
  if (!autoAdvanceEnabled) return;
  if (playbackOrder.length <= 1) return;

  if (cycleNumber !== undefined && cycleNumber !== lastCycleNumber && lastCycleNumber >= 0) {
    cyclesSinceSceneStart += (cycleNumber - lastCycleNumber);
    if (cyclesSinceSceneStart >= TIMING.sceneCycles) {
      advanceScene();
      cyclesSinceSceneStart = 0;
    }
  }
  lastCycleNumber = cycleNumber;
}

function advanceScene() {
  playbackPosition = (playbackPosition + 1) % playbackOrder.length;
  const nextSceneIdx = playbackOrder[playbackPosition];
  morphToScene(nextSceneIdx);
}

function morphToScene(targetIndex) {
  const state = getState();
  if (targetIndex === state.activeSceneIndex) return;
  if (targetIndex < 0 || targetIndex >= state.scenes.length) return;
  if (!isAudioInitialized()) return;

  loadScene(targetIndex);
  transitionScene();
}

function resetCycleCount() {
  cyclesSinceSceneStart = 0;
  lastCycleNumber = -1;
  playbackPosition = 0;
  // Find the current scene's position in the order
  const state = getState();
  const idx = playbackOrder.indexOf(state.activeSceneIndex);
  if (idx >= 0) playbackPosition = idx;
}

export { initSequencer, updateSequencer, morphToScene, resetCycleCount, rebuildPlaybackOrder };
