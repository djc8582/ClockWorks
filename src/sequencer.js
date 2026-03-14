import { getState, getShapes, loadScene } from './state.js';
import { rescheduleAll, triggerNote, isAudioInitialized } from './audio/audioEngine.js';
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

  loadScene(targetIndex);
  rescheduleAll();

  // Manually trigger beat 0 for each shape so the transition is seamless
  const shapes = getShapes();
  for (const shape of shapes) {
    if (shape.vertices && shape.vertices.length > 0) {
      triggerNote(shape, 0);
    }
  }
}

function resetCycleCount() {
  cycleCount = 0;
}

export { initSequencer, updateSequencer, morphToScene, resetCycleCount };
