// Project save/load system — stores projects as JSON files in the app's document directory.
import * as FileSystem from 'expo-file-system';
import { getState, initState } from './state.js';

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
  // Re-init state then apply the saved data
  const state = getState();
  state.bpm = data.bpm || 120;
  state.scale = data.scale || [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  state.activeSceneIndex = Math.max(0, Math.min(data.activeSceneIndex || 0, (data.scenes || []).length - 1));
  state.scenes = data.scenes || state.scenes;
  state.enabledSlots = data.enabledSlots || [true, false, false, false, false, false, false, false];
  if (data.effects) state.effects = data.effects;
  return data.name || filename;
}

// Delete a saved project
export async function deleteProject(filename) {
  try {
    await FileSystem.deleteAsync(PROJECTS_DIR + filename, { idempotent: true });
  } catch (e) {}
}
