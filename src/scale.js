import { SCALE_DEFINITIONS, PITCH } from './constants.js';
import { getState, updateState } from './state.js';

function togglePitchClass(pitchClass) {
  const state = getState();
  const idx = state.scale.indexOf(pitchClass);

  if (idx !== -1) {
    if (state.scale.length <= 1) return; // must keep at least 1
    updateState(s => {
      s.scale.splice(idx, 1);
    });
    snapAllVerticesToScale();
  } else {
    updateState(s => {
      s.scale.push(pitchClass);
      s.scale.sort((a, b) => a - b);
    });
  }

  detectScale();
}

function snapPitchToScale(pitch) {
  const state = getState();
  const scale = state.scale;
  if (scale.length === 12) return pitch; // chromatic, no snapping

  const pitchClass = ((pitch % 12) + 12) % 12;
  if (scale.includes(pitchClass)) return pitch;

  // Find nearest active pitch class
  let minDist = 12;
  let nearestPC = scale[0];
  for (const pc of scale) {
    const dist = Math.min(
      Math.abs(pitchClass - pc),
      12 - Math.abs(pitchClass - pc)
    );
    if (dist < minDist) {
      minDist = dist;
      nearestPC = pc;
    }
  }

  const octave = Math.floor(pitch / 12);
  let snapped = octave * 12 + nearestPC;

  // Make sure we're close to the original pitch
  if (Math.abs(snapped - pitch) > 6) {
    if (snapped > pitch) snapped -= 12;
    else snapped += 12;
  }

  return Math.max(PITCH.min, Math.min(PITCH.max, snapped));
}

// Fix #3: bounds-check activeSceneIndex
function snapAllVerticesToScale() {
  updateState(s => {
    const idx = Math.max(0, Math.min(s.activeSceneIndex, s.scenes.length - 1));
    const scene = s.scenes[idx];
    if (!scene) return;
    for (const shape of scene.shapes) {
      for (const v of shape.vertices) {
        if (!v.muted && v.pitches) {
          v.pitches = v.pitches.map(p => snapPitchToScale(p));
        }
        if (v.subs) {
          for (const sub of v.subs) {
            if (!sub.muted && sub.pitches) {
              sub.pitches = sub.pitches.map(p => snapPitchToScale(p));
            }
          }
        }
      }
    }
  });
}

function detectScale() {
  const state = getState();
  const scale = state.scale.slice().sort((a, b) => a - b);

  for (const [name, intervals] of Object.entries(SCALE_DEFINITIONS)) {
    // Check all 12 rotations (transpositions)
    for (let root = 0; root < 12; root++) {
      const rotated = intervals.map(i => (i + root) % 12).sort((a, b) => a - b);
      if (rotated.length === scale.length && rotated.every((v, i) => v === scale[i])) {
        const rootName = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][root];
        const displayName = name === "Chromatic" ? name : `${rootName} ${name}`;
        updateState(s => {
          s.ui.scaleName = { text: displayName, time: Date.now() };
        });
        return;
      }
    }
  }
}

function setScalePreset(name, root) {
  const intervals = SCALE_DEFINITIONS[name];
  if (!intervals) return;
  const scale = intervals.map(i => (i + root) % 12).sort((a, b) => a - b);
  updateState(s => { s.scale = scale; });
  snapAllVerticesToScale();
  detectScale();
}

function getCurrentScaleName() {
  const state = getState();
  const scale = state.scale.slice().sort((a, b) => a - b);
  const rootNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  for (const [name, intervals] of Object.entries(SCALE_DEFINITIONS)) {
    for (let root = 0; root < 12; root++) {
      const rotated = intervals.map(i => (i + root) % 12).sort((a, b) => a - b);
      if (rotated.length === scale.length && rotated.every((v, i) => v === scale[i])) {
        return name === "Chromatic" ? name : `${rootNames[root]} ${name}`;
      }
    }
  }
  return "Custom";
}

export { togglePitchClass, snapPitchToScale, snapAllVerticesToScale, detectScale, setScalePreset, getCurrentScaleName };
