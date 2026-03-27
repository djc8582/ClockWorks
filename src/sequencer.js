// Sequencer: auto-advances through scenes using the phrase-loop playback order.
// Playing scene (activeSceneIndex) is independent from editing scene (panelSceneIndex).
import { getState, loadScene, updateState } from './state.js';
import { transitionScene, isAudioInitialized } from './audio/audioEngine.js';
import { TIMING } from './constants.js';

let lastCycleNumber = -1;
let cyclesSinceSceneStart = 0;
let autoAdvanceEnabled = false;
let playbackOrder = [0];
let playbackPosition = 0;

function initSequencer() {
  autoAdvanceEnabled = true;
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
    playbackPosition = 0;
    return;
  }

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
  playbackPosition = 0;
}

function updateSequencer(clockAngle, cycleNumber) {
  if (!autoAdvanceEnabled) return;
  if (playbackOrder.length <= 1) return;

  if (cycleNumber !== undefined && cycleNumber !== lastCycleNumber && lastCycleNumber >= 0) {
    const delta = cycleNumber - lastCycleNumber;
    if (delta > 0) {
      cyclesSinceSceneStart += delta;
      if (cyclesSinceSceneStart >= TIMING.sceneCycles) {
        advanceScene();
        cyclesSinceSceneStart = 0;
      }
    }
  }
  lastCycleNumber = cycleNumber;
}

function advanceScene() {
  playbackPosition = (playbackPosition + 1) % playbackOrder.length;
  const nextSceneIdx = playbackOrder[playbackPosition];
  const state = getState();

  // Only do a transition if the scene actually changes
  if (nextSceneIdx !== state.activeSceneIndex) {
    if (!isAudioInitialized()) return;
    loadScene(nextSceneIdx);
    transitionScene();
  }
  // If same scene, just keep playing — no transition needed
}

function resetCycleCount() {
  cyclesSinceSceneStart = 0;
  lastCycleNumber = -1;
  // Sync playback position to current active scene
  const state = getState();
  const idx = playbackOrder.indexOf(state.activeSceneIndex);
  playbackPosition = idx >= 0 ? idx : 0;
}

export { initSequencer, updateSequencer, resetCycleCount, rebuildPlaybackOrder };
