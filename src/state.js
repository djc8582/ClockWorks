import { PITCH, MAX_SCENES } from './constants.js';

let state = null;
const listeners = [];

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
            timbre: "classic",
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
      audioStarted: false,
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
  updater(state);
  notifyListeners();
}

function subscribe(listener) {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

function notifyListeners() {
  for (const listener of listeners) {
    listener(state);
  }
}

function getActiveScene() {
  const idx = Math.max(0, Math.min(state.activeSceneIndex, state.scenes.length - 1));
  return state.scenes[idx];
}

function getShapes() {
  return getActiveScene().shapes;
}

function getShapeById(id) {
  return getShapes().find(s => s.id === id);
}

function generateShapeId() {
  return "shape-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
}

function captureScene() {
  if (state.scenes.length >= MAX_SCENES) return -1;
  const currentScene = getActiveScene();
  const snapshot = JSON.parse(JSON.stringify(currentScene));
  for (const shape of snapshot.shapes) {
    shape.id = generateShapeId();
  }
  state.scenes.push(snapshot);
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
  state.scenes.splice(index, 1);
  if (state.activeSceneIndex >= state.scenes.length) {
    state.activeSceneIndex = state.scenes.length - 1;
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
    state.bpm = parsed.bpm;
    state.scale = parsed.scale;
    state.activeSceneIndex = parsed.activeSceneIndex;
    state.scenes = parsed.scenes;
    if (parsed.effects) {
      state.effects = parsed.effects;
    }
    if (!Array.isArray(parsed.scenes)) throw new Error("Invalid state: scenes not an array");
    // Migrate old format and validate
    for (const scene of state.scenes) {
      for (const shape of scene.shapes) {
        if (!shape.subdivision) shape.subdivision = 1;
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
  generateShapeId,
  captureScene,
  loadScene,
  deleteScene,
  serializeState,
  deserializeState,
  createDefaultState,
};
