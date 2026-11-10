// Project save/load system — stores projects as JSON files in the app's document directory.
import * as FileSystem from 'expo-file-system';
import { getState, sanitizeScenes } from './state.js';
import { normalizeLoops } from './looper.js';
import { MAX_SCENES, AUDIO, makeDefaultMasterFx } from './constants.js';

const PROJECTS_DIR = FileSystem.documentDirectory + 'projects/';

async function ensureDir() {
  const info = await FileSystem.getInfoAsync(PROJECTS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(PROJECTS_DIR, { intermediates: true });
}

// Save the current state as a named project
export async function saveProject(name) {
  await ensureDir();
  const state = getState();
  const data = {
    name,
    savedAt: Date.now(),
    bpm: state.bpm,
    scale: state.scale,
    activeSceneIndex: state.activeSceneIndex,
    scenes: state.scenes,
    enabledSlots: state.enabledSlots,
    layerOrder: state.layerOrder,
    layerLoops: state.layerLoops,
    effects: state.effects,
  };
  const filename = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  await FileSystem.writeAsStringAsync(PROJECTS_DIR + filename, JSON.stringify(data));
  return filename;
}

// List all saved projects
export async function listProjects() {
  await ensureDir();
  const files = await FileSystem.readDirectoryAsync(PROJECTS_DIR);
  const projects = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = await FileSystem.readAsStringAsync(PROJECTS_DIR + file);
      const data = JSON.parse(raw);
      projects.push({ filename: file, name: data.name || file, savedAt: data.savedAt || 0 });
    } catch (e) {}
  }
  return projects.sort((a, b) => b.savedAt - a.savedAt);
}

// Load a project by filename — replaces current state
export async function loadProject(filename) {
  const raw = await FileSystem.readAsStringAsync(PROJECTS_DIR + filename);
  const data = JSON.parse(raw);

  // Validate + migrate before touching state (same rules as deserializeState)
  let scenes = Array.isArray(data.scenes) ? data.scenes : [{ shapes: [] }];
  scenes = scenes.slice(0, MAX_SCENES);
  while (scenes.length < MAX_SCENES) scenes.push({ shapes: [] });
  sanitizeScenes(scenes);

  let enabledSlots = Array.isArray(data.enabledSlots) ? data.enabledSlots.slice(0, MAX_SCENES) : [true];
  while (enabledSlots.length < MAX_SCENES) enabledSlots.push(false);
  enabledSlots = enabledSlots.map(Boolean);
  enabledSlots[0] = true; // slot 1 is always enabled

  const state = getState();
  state.bpm = (typeof data.bpm === 'number' && isFinite(data.bpm)) ? Math.max(AUDIO.minBpm, Math.min(AUDIO.maxBpm, data.bpm)) : 120;
  state.scale = (Array.isArray(data.scale) && data.scale.length > 0) ? data.scale : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  state.activeSceneIndex = Math.max(0, Math.min(data.activeSceneIndex || 0, scenes.length - 1));
  state.scenes = scenes;
  state.enabledSlots = enabledSlots;
  // Per-layer loop rules; projects saved before the per-layer looper have
  // none and are migrated (see looper.js normalizeLoops)
  state.layerOrder = Array.isArray(data.layerOrder) ? data.layerOrder : undefined;
  state.layerLoops = data.layerLoops && typeof data.layerLoops === 'object' ? data.layerLoops : undefined;
  normalizeLoops(state);
  state.effects = { ...makeDefaultMasterFx(), ...(data.effects || {}) };

  // Point the editing panel at the loaded active scene — stale shape ids
  // from the previous project would leave every canvas shape dimmed
  if (state.ui) {
    state.activeSceneIndex = Math.min(state.activeSceneIndex, state.enabledSlots.lastIndexOf(true));
    state.ui.panelSceneIndex = state.activeSceneIndex;
    const shapes = scenes[state.activeSceneIndex]?.shapes || [];
    state.ui.panelShapeId = shapes.length > 0 ? shapes[0].id : null;
    state.ui.selectedNodeIndex = 0;
    state.ui.selectedNotes = [];
    state.ui.scaleName = null;
  }
  return data.name || filename;
}

// Delete a saved project
export async function deleteProject(filename) {
  try {
    await FileSystem.deleteAsync(PROJECTS_DIR + filename, { idempotent: true });
  } catch (e) {}
}
