import { getState, getShapes, loadScene } from './state.js';
import { transitionScene, isAudioInitialized } from './audio/audioEngine.js';
import { TIMING } from './constants.js';

let lastCycleNumber = -1;
let cyclesSinceSceneStart = 0;
let autoAdvanceEnabled = false;

function initSequencer() {
  autoAdvanceEnabled = true;
}

function updateSequencer(clockAngle, cycleNumber) {
  if (!autoAdvanceEnabled) return;
  const state = getState();
  if (state.scenes.length <= 1) return;

  // Use scheduler's authoritative cycle number instead of fragile angle detection
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
  const state = getState();
  // Fix #12: guard against empty scenes array (% 0 = NaN)
  if (!state.scenes || state.scenes.length === 0) return;
  const nextIndex = (state.activeSceneIndex + 1) % state.scenes.length;
  morphToScene(nextIndex);
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
}

export { initSequencer, updateSequencer, morphToScene, resetCycleCount };
