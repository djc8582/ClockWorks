import { PITCH, MAX_SCENES, MAX_SIDES, MAX_SHAPES, MAX_SUBDIVISION } from './constants.js';

let state = null;
const listeners = [];
let isNotifying = false;
let pendingNotify = false;
let notifyDepth = 0;        // Fix #4: recursion depth counter
const MAX_NOTIFY_DEPTH = 3; // Fix #4: safety net

function createDefaultState() {
  return {
    bpm: 120,
    scale: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    activeSceneIndex: 0,
    scenes: [
      {
        shapes: [
          {
            id: "shape-1",
            sides: 3,
            colorIndex: 0,
            timbre: "epiano",
            volume: 1.0,
            subdivision: 1,
            vertices: [
              { pitches: [60], velocity: 100, muted: false, subs: [] },
              { pitches: [64], velocity: 85, muted: false, subs: [] },
              { pitches: [67], velocity: 90, muted: false, subs: [] },
            ],
          },
        ],
      },
    ],
    effects: {
      reverbWet: 0.3,
      delayWet: 0,
    },
    ui: {
      panelShapeId: null,
      panelSceneIndex: 0,
      selectedNodeIndex: null,
      rollMode: 'edit',
      selectedNotes: [],
      canvasZoom: 1.0,
      rollZoom: 1.0,
      clockAngle: -Math.PI / 2,
      mixerOpen: false,
      audioStarted: false,
      playing: false,
      ghostRingHover: false,
      addPanelOpen: false,
      addPanelSides: 4,
      noteLabel: null,
      bpmLabel: null,
      scaleName: null,
    },
  };
}

function initState() {
  state = createDefaultState();
  return state;
}

function getState() {
  return state;
}

function setState(newState) {
  state = newState;
  notifyListeners();
}

function updateState(updater) {
  try {
    updater(state);
  } catch (e) {
    if (__DEV__) console.error('[state] updateState callback threw:', e?.message || e, e?.stack);
    return;
  }
  notifyListeners();
}

function subscribe(listener) {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

// Fix #8: Clear all listeners — used by ErrorBoundary recovery to prevent
// orphaned listeners from the crashed tree from firing on new state.
function clearListeners() {
  listeners.length = 0;
}

// Ensure all selectors see new references after any state change
function refreshRefs() {
  try {
    if (state.scenes) {
      const active = state.activeSceneIndex;
      const panel = state.ui ? state.ui.panelSceneIndex : active;
      for (const idx of new Set([active, panel])) {
        const scene = state.scenes[idx];
        if (scene) {
          if (!Array.isArray(scene.shapes)) {
            scene.shapes = [];
          }
          state.scenes[idx] = {
            ...scene,
            shapes: scene.shapes.map(s => ({ ...s })),
          };
        }
      }
      state.scenes = [...state.scenes];
    }
    if (state.ui) state.ui = { ...state.ui };
    state = { ...state };
  } catch (e) {
    if (__DEV__) console.error('[state] refreshRefs crashed:', e?.message || e, e?.stack);
  }
}

function notifyListeners() {
  // Coalesce nested updateState → notifyListeners calls into one notification
  if (isNotifying) {
    pendingNotify = true;
    return;
  }
  isNotifying = true;
  try {
    refreshRefs();
    // Snapshot listeners to prevent mutation during iteration
    const snapshot = listeners.slice();
    for (const listener of snapshot) {
      try { listener(state); } catch (e) {
        if (__DEV__) console.error('[state] listener threw:', e?.message || e);
      }
    }
  } finally {
    isNotifying = false;
    if (pendingNotify) {
      pendingNotify = false;
      // Fix #4: cap recursion depth to prevent infinite loops from buggy listeners
      notifyDepth++;
      if (notifyDepth <= MAX_NOTIFY_DEPTH) {
        notifyListeners();
      } else {
        if (__DEV__) console.warn('[state] notifyListeners recursion depth exceeded — dropping update');
        notifyDepth = 0; // Only reset after we've stopped recursing
      }
    } else {
      notifyDepth = 0; // Reset when no more pending — end of the chain
    }
  }
}

const EMPTY_SHAPES = [];
const EMPTY_SCENE = { shapes: EMPTY_SHAPES };

function getActiveScene() {
  if (!state || !state.scenes || state.scenes.length === 0) return EMPTY_SCENE;
  const idx = Math.max(0, Math.min(state.activeSceneIndex, state.scenes.length - 1));
  return state.scenes[idx] || EMPTY_SCENE;
}

function getShapes() {
  return getActiveScene().shapes || EMPTY_SHAPES;
}

function getShapeById(id) {
  return getShapes().find(s => s.id === id);
}

// Fix #3: Safe active scene accessor for use inside updateState callbacks.
// Clamps activeSceneIndex to valid range before accessing. Returns null if no scenes.
function safeActiveScene(s) {
  if (!s.scenes || s.scenes.length === 0) return null;
  if (s.activeSceneIndex < 0 || s.activeSceneIndex >= s.scenes.length) {
    s.activeSceneIndex = Math.max(0, s.scenes.length - 1);
  }
  return s.scenes[s.activeSceneIndex];
}

let shapeIdCounter = 0;
function generateShapeId() {
  return "shape-" + Date.now() + "-" + (shapeIdCounter++) + "-" + Math.floor(Math.random() * 1e6);
}

function captureScene() {
  if (state.scenes.length >= MAX_SCENES) return -1;
  const currentScene = getActiveScene();
  const snapshot = JSON.parse(JSON.stringify(currentScene));
  for (const shape of snapshot.shapes) {
    shape.id = generateShapeId();
  }
  state.scenes = [...state.scenes, snapshot];
  notifyListeners();
  return state.scenes.length - 1;
}

function loadScene(index) {
  if (index >= 0 && index < state.scenes.length) {
    state.activeSceneIndex = index;
    notifyListeners();
  }
}

function deleteScene(index) {
  if (state.scenes.length <= 1) return;
  if (index < 0 || index >= state.scenes.length) return;
  state.scenes.splice(index, 1);
  if (state.activeSceneIndex >= state.scenes.length) {
    state.activeSceneIndex = state.scenes.length - 1;
  }
  if (state.ui.panelSceneIndex >= state.scenes.length) {
    state.ui.panelSceneIndex = state.scenes.length - 1;
  }
  notifyListeners();
}

// Base64 encoding/decoding for React Native (no btoa/atob)
function base64Encode(str) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes.charCodeAt(i);
    const b2 = i + 1 < bytes.length ? bytes.charCodeAt(i + 1) : 0;
    const b3 = i + 2 < bytes.length ? bytes.charCodeAt(i + 2) : 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b3 & 63] : '=';
  }
  return result;
}

function base64Decode(b64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const clean = b64.replace(/=+$/, '');
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean[i]);
    const b = chars.indexOf(clean[i + 1]);
    const c = i + 2 < clean.length ? chars.indexOf(clean[i + 2]) : 0;
    const d = i + 3 < clean.length ? chars.indexOf(clean[i + 3]) : 0;
    result += String.fromCharCode((a << 2) | (b >> 4));
    if (i + 2 < clean.length) result += String.fromCharCode(((b & 15) << 4) | (c >> 2));
    if (i + 3 < clean.length) result += String.fromCharCode(((c & 3) << 6) | d);
  }
  return result;
}

function serializeState() {
  const toSerialize = {
    bpm: state.bpm,
    scale: state.scale,
    activeSceneIndex: state.activeSceneIndex,
    scenes: state.scenes,
    effects: state.effects,
  };
  const json = JSON.stringify(toSerialize);
  const encoded = base64Encode(json);
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deserializeState(hash) {
  try {
    let b64 = hash.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const decoded = base64Decode(b64);
    const json = decodeURIComponent(
      decoded.split('').map(c =>
        '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join('')
    );
    const parsed = JSON.parse(json);
    // Validate before assigning anything to state
    if (!Array.isArray(parsed.scenes)) throw new Error("Invalid state: scenes not an array");
    if (typeof parsed.bpm !== 'number' || isNaN(parsed.bpm)) throw new Error("Invalid bpm");
    if (!Array.isArray(parsed.scale)) throw new Error("Invalid scale");
    if (typeof parsed.activeSceneIndex !== 'number') throw new Error("Invalid activeSceneIndex");
    // Migrate old format and validate on parsed data first
    // Fix #7: Validate and clamp all numeric fields to prevent unbounded input
    for (const scene of parsed.scenes) {
      if (!scene.shapes) scene.shapes = [];
      // Clamp shape count
      if (scene.shapes.length > MAX_SHAPES) scene.shapes.length = MAX_SHAPES;
      for (const shape of scene.shapes) {
        if (!shape.subdivision) shape.subdivision = 1;
        // Clamp sides and subdivision
        if (typeof shape.sides !== 'number' || !isFinite(shape.sides)) shape.sides = 3;
        shape.sides = Math.max(2, Math.min(MAX_SIDES, shape.sides));
        shape.subdivision = Math.max(1, Math.min(MAX_SUBDIVISION, shape.subdivision || 1));
        // Validate vertices array
        if (!Array.isArray(shape.vertices)) shape.vertices = [];
        // Truncate vertices to match sides
        if (shape.vertices.length > shape.sides) shape.vertices.length = shape.sides;
        // Pad if too few
        while (shape.vertices.length < shape.sides) {
          shape.vertices.push({ pitches: [PITCH.defaultPitch], velocity: PITCH.defaultVelocity, muted: false, subs: [] });
        }
        for (const v of shape.vertices) {
          if (v.pitch !== undefined && !v.pitches) {
            v.pitches = [v.pitch];
            delete v.pitch;
          }
          if (!v.pitches) v.pitches = [PITCH.defaultPitch];
          if (v.velocity === undefined) v.velocity = PITCH.defaultVelocity;
          if (v.muted === undefined) v.muted = false;
          if (!v.subs) v.subs = [];
          for (const sub of v.subs) {
            if (!sub.pitches) sub.pitches = [PITCH.defaultPitch];
            if (sub.velocity === undefined) sub.velocity = PITCH.defaultVelocity;
            if (sub.muted === undefined) sub.muted = false;
          }
        }
        if (shape.sides !== shape.vertices.length) {
          shape.sides = shape.vertices.length;
        }
      }
    }
    // All validation passed — now assign to state
    state.bpm = parsed.bpm;
    state.scale = parsed.scale;
    state.activeSceneIndex = Math.max(0, Math.min(parsed.activeSceneIndex, parsed.scenes.length - 1));
    state.scenes = parsed.scenes;
    if (parsed.effects) {
      state.effects = parsed.effects;
    }
    notifyListeners();
    return true;
  } catch (e) {
    console.warn("Failed to deserialize state:", e);
    return false;
  }
}

export {
  initState,
  getState,
  setState,
  updateState,
  subscribe,
  getActiveScene,
  getShapes,
  getShapeById,
  safeActiveScene,
  clearListeners,
  generateShapeId,
  captureScene,
  loadScene,
  deleteScene,
  serializeState,
  deserializeState,
  createDefaultState,
};
