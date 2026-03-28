import { SCALE_DEFINITIONS, PITCH } from './constants.js';
import { getState, updateState } from './state.js';

function togglePitchClass(pitchClass) {
  const state = getState();
  // Tolerance-based matching for fractional (microtonal) pitch classes
  const idx = state.scale.findIndex(pc => Math.abs(pc - pitchClass) < 0.05);

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

  const pitchClass = Math.round(((pitch % 12) + 12) % 12 * 100) / 100;
  // Check with tolerance for fractional pitch classes (0.05 = 5 cents)
  if (scale.some(pc => Math.abs(pc - pitchClass) < 0.05)) return pitch;

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

// Snap vertices in the currently EDITED scene (panelSceneIndex)
function snapAllVerticesToScale() {
  updateState(s => {
    const idx = s.ui ? s.ui.panelSceneIndex : 0;
    const scene = s.scenes[Math.max(0, Math.min(idx, s.scenes.length - 1))];
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

  // If scale has fractional values, it's microtonal — don't try to match to 12-TET patterns
  // (microtonal scales are set explicitly via setScalePreset, which handles naming directly)
  if (scale.some(pc => pc !== Math.round(pc))) return;

  for (const [name, intervals] of Object.entries(SCALE_DEFINITIONS)) {
    // Skip microtonal definitions — they can't match an all-integer scale
    if (intervals.some(i => i !== Math.round(i))) continue;
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
  // Support fractional pitch classes — don't round
  const scale = [...new Set(intervals.map(i => {
    const pc = (i + root) % 12;
    return Math.round(pc * 100) / 100; // 2 decimal precision, avoid float drift
  }))].sort((a, b) => a - b);
  if (scale.length === 0) return;

  const NOTE_NAMES_LOCAL = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const displayName = name === "Chromatic" ? name : `${NOTE_NAMES_LOCAL[root]} ${name}`;

  updateState(s => {
    s.scale = scale;
    s.ui.scaleName = { text: displayName, time: Date.now() };
  });
  snapAllVerticesToScale();
  // DO NOT call detectScale() — the user chose this scale explicitly
}

function getCurrentScaleName() {
  const state = getState();
  // If scaleName was set recently by setScalePreset, use it directly
  if (state.ui && state.ui.scaleName && state.ui.scaleName.text) {
    return state.ui.scaleName.text;
  }

  const scale = state.scale.slice().sort((a, b) => a - b);
  const rootNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  for (const [name, intervals] of Object.entries(SCALE_DEFINITIONS)) {
    for (let root = 0; root < 12; root++) {
      const rotated = intervals.map(i => {
        const pc = (i + root) % 12;
        return Math.round(pc * 100) / 100;
      }).sort((a, b) => a - b);
      if (rotated.length === scale.length &&
          rotated.every((v, i) => Math.abs(v - scale[i]) < 0.01)) {
        return name === "Chromatic" ? name : `${rootNames[root]} ${name}`;
      }
    }
  }
  return "Custom";
}

export { togglePitchClass, snapPitchToScale, snapAllVerticesToScale, detectScale, setScalePreset, getCurrentScaleName };
