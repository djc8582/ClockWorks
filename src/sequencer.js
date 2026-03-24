import { getState, getShapes, loadScene } from './state.js';
import { transitionScene, isAudioInitialized } from './audio/audioEngine.js';
import { TIMING } from './constants.js';

let cycleCount = 0;
let lastCycleAngle = 0;
let autoAdvanceEnabled = false;

function initSequencer() {
  autoAdvanceEnabled = true;
}

function updateSequencer(clockAngle) {
  if (!autoAdvanceEnabled) return;
  const state = getState();
  if (state.scenes.length <= 1) return;

  // Detect cycle completion (clock wraps past -PI/2 = 12 o'clock)
  const normalized = ((clockAngle + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const prevNormalized = ((lastCycleAngle + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);

  if (prevNormalized > Math.PI && normalized < Math.PI && normalized < 1) {
    cycleCount++;
    if (cycleCount >= TIMING.sceneCycles) {
      advanceScene();
      cycleCount = 0;
    }
  }

  lastCycleAngle = clockAngle;
}

function advanceScene() {
  const state = getState();
  const nextIndex = (state.activeSceneIndex + 1) % state.scenes.length;
  morphToScene(nextIndex);
}

function morphToScene(targetIndex) {
  const state = getState();
  if (targetIndex === state.activeSceneIndex) return;
  if (targetIndex < 0 || targetIndex >= state.scenes.length) return;
  if (!isAudioInitialized()) return;

  // Fade out old voices smoothly, then load new scene
  // The scheduler keeps running with continuous timing — no restart.
  // New scene's shapes will be picked up on the next scheduler tick.
  loadScene(targetIndex);
  transitionScene();

  // Don't manually trigger beat 0 — the scheduler handles it naturally
  // since the clock hand continues smoothly through the transition.
}

function resetCycleCount() {
  cycleCount = 0;
}

export { initSequencer, updateSequencer, morphToScene, resetCycleCount };
