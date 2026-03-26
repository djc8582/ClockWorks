import { AudioContext } from 'react-native-audio-api';
import { AppState } from 'react-native';
import { getState, getShapes, updateState } from '../state.js';
import { TIMING } from '../constants.js';
import { createTimbre, triggerTimbre, initSampleBank, fadeOutAllVoices } from './timbres.js';
import { createScheduler } from './scheduler.js';

let audioContext = null;
let scheduler = null;
let audioInitialized = false;
let cycleDuration = 2;
let masterGain = null;
let synthMap = new Map();
let onNoteTriggered = null;
let masterGainValue = 0.7;  // Track gain in JS to avoid .value getter issues
let appStateSubscription = null;
let rescheduleThrottleId = null;
const MAX_NOTES_PER_TICK = 12;

function setNoteCallback(cb) { onNoteTriggered = cb; }

function velocityToGain(velocity) {
  const v = Number(velocity) || 85;
  return Math.max(0.01, Math.min(1, (v / 127) * 0.85));
}

function getNoteDuration(shape) {
  const sub = Math.max(1, shape.subdivision || 1);
  const sides = Math.max(1, shape.sides || 1);
  const total = sides * sub;
  if (cycleDuration <= 0 || total <= 0) return 0.1;
  const interval = cycleDuration / total;
  return Math.min(interval * 0.6, 0.5);
}

// ── Init ─────────────────────────────────────────────────────
function initAudio() {
  if (audioInitialized) return;

  try {
    audioContext = new AudioContext();
    if (audioContext.resume) audioContext.resume();

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.7;
    masterGain.connect(audioContext.destination);

    initSampleBank(audioContext);

    updateCycleDuration();
    scheduler = createScheduler(audioContext, cycleDuration, onSchedulerTick);
    audioInitialized = true;
    scheduler.start();

    // Suspend audio when app goes to background (iOS requirement)
    if (!appStateSubscription) {
      appStateSubscription = AppState.addEventListener('change', (nextState) => {
        if (!audioInitialized) return;
        if (nextState === 'background' || nextState === 'inactive') {
          if (scheduler) scheduler.stop();
          try { if (audioContext) audioContext.suspend(); } catch (e) {}
        } else if (nextState === 'active') {
          try {
            if (audioContext && audioContext.state !== 'running') audioContext.resume();
          } catch (e) {}
          if (getState().ui.playing && scheduler) scheduler.resume();
        }
      });
    }
  } catch (e) {
    console.warn('[audio] Init failed:', e?.message || e);
    // Clean up partially created resources on failure
    if (audioContext) {
      try { audioContext.close(); } catch (e2) {}
      audioContext = null;
    }
    masterGain = null;
    audioInitialized = false;
  }
}

function updateCycleDuration() {
  const state = getState();
  const bpm = state.bpm || 120;
  cycleDuration = (60 / bpm) * TIMING.defaultCycleBeats;
  if (cycleDuration <= 0) cycleDuration = 2;
  if (scheduler) scheduler.setCycleDuration(cycleDuration);
}

function getCycleDuration() { return cycleDuration; }

function updateBPM(newBPM) {
  updateState(s => { s.bpm = newBPM; });
  updateCycleDuration();
  rescheduleAll();
}

// ── Synth management ─────────────────────────────────────────
function ensureSynth(shape) {
  if (!audioContext) return null;
  const timbre = shape.timbre || 'epiano';
  let synth = synthMap.get(timbre);
  if (!synth) {
    synth = createTimbre(audioContext, timbre);
    synthMap.set(timbre, synth);
  }
  return synth;
}

function swapTimbre(shape) { ensureSynth(shape); }

function cleanupOrphanedSynths() {
  const usedTimbres = new Set(getShapes().map(s => s.timbre || 'epiano'));
  const toDelete = [];
  for (const [timbre] of synthMap) {
    if (!usedTimbres.has(timbre)) toDelete.push(timbre);
  }
  for (const t of toDelete) synthMap.delete(t);
}

// ── Scheduler tick (non-overlapping window approach) ─────────
// The scheduler guarantees [scheduleFrom, scheduleTo) windows never overlap,
// so every event fires exactly once — no deduplication needed.
function onSchedulerTick(scheduleFrom, scheduleTo, transportStart, cycleDur) {
  try {
    const shapes = getShapes();
    if (!shapes || shapes.length === 0) return;
    if (!cycleDur || cycleDur <= 0) return;
    if (!isFinite(scheduleFrom) || !isFinite(scheduleTo)) return;

    // Distribute note budget fairly across shapes (round-robin, not first-come)
    const noteBudget = Math.min(MAX_NOTES_PER_TICK, Math.max(4, Math.floor(MAX_NOTES_PER_TICK / Math.max(1, shapes.length)) * shapes.length));
    let totalNotes = 0;

    for (const shape of shapes) {
      if (totalNotes >= noteBudget) break;
      if (!shape || !shape.vertices) continue;
      const synth = ensureSynth(shape);
      if (!synth) continue;

      const sides = shape.sides;
      if (!sides || sides <= 0) continue;
      const sub = Math.min(shape.subdivision || 1, 4);
      const interval = cycleDur / sides;
      const subInterval = interval / sub;

      const relFrom = scheduleFrom - transportStart;
      const relTo = scheduleTo - transportStart;
      if (!isFinite(relFrom) || !isFinite(relTo)) continue;
      const firstCycle = Math.max(0, Math.floor(relFrom / cycleDur));
      const lastCycle = Math.min(firstCycle + 2, Math.floor(relTo / cycleDur)); // Cap to 2 cycles per tick

      for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        const cycleStart = transportStart + cycle * cycleDur;

        for (let i = 0; i < sides; i++) {
          for (let s = 0; s < sub; s++) {
            const eventTime = cycleStart + i * interval + s * subInterval;
            if (eventTime < scheduleFrom || eventTime >= scheduleTo) continue;

            const v = shape.vertices[i];
            if (!v) continue;
            const stepData = s === 0 ? v : (v.subs && v.subs[s - 1]);
            if (!stepData || stepData.muted) continue;

            if (totalNotes >= noteBudget) break;
            totalNotes++;

            const vel = velocityToGain(stepData.velocity || 85) * (shape.volume != null ? shape.volume : 1);
            const dur = getNoteDuration(shape);

            try {
              triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur, eventTime, i);
            } catch (e) {}

            if (s === 0 && onNoteTriggered) {
              try { onNoteTriggered(shape, i); } catch (e) {}
            }
          }
        }
      }
    }
  } catch (e) {}
}

// ── Direct triggering (preview/tap) ─────────────────────────
function triggerStep(shape, stepData, vertexIndex) {
  if (!stepData || stepData.muted || !audioContext || !masterGain) return;
  const synth = ensureSynth(shape);
  if (!synth) return;
  const vel = velocityToGain(stepData.velocity || 85) * (shape.volume != null ? shape.volume : 1);
  const dur = getNoteDuration(shape);
  try {
    triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur, undefined, vertexIndex);
  } catch (e) {}
}

function triggerNote(shape, vertexIndex) {
  if (!shape || !shape.vertices) return;
  const v = shape.vertices[vertexIndex];
  if (!v || v.muted) return;
  triggerStep(shape, v, vertexIndex);
  if (onNoteTriggered) {
    try { onNoteTriggered(shape, vertexIndex); } catch (e) {}
  }
}

function playPreview(shape, vertexIndex, stepIndex) {
  if (!shape || !shape.vertices) return;
  const v = shape.vertices[vertexIndex];
  if (!v || !audioInitialized) return;
  const stepData = (stepIndex && stepIndex > 0 && v.subs) ? v.subs[stepIndex - 1] : v;
  if (!stepData || stepData.muted) return;
  triggerStep(shape, stepData, vertexIndex);
}

// ── Reschedule ──────────────────────────────────────────────
function getTargetGain() {
  try {
    const shapes = getShapes();
    const count = Math.max(1, shapes.length);
    return 0.7 / Math.sqrt(count);
  } catch (e) {
    return 0.7;
  }
}

function rescheduleAll() {
  try {
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    cleanupOrphanedSynths();
  }
  if (audioContext && masterGain) {
    try {
      const target = getTargetGain();
      if (!isFinite(target) || target < 0) return;
      const now = audioContext.currentTime;
      if (!isFinite(now)) return;
      // Note: cancelScheduledValues crashes on react-native-audio-api 0.6.5
      // (native null deref in ParamChangeEvent deque). Use setValueAtTime to
      // override any in-progress ramp instead.
      masterGain.gain.setValueAtTime(masterGainValue, now);
      masterGain.gain.linearRampToValueAtTime(target, now + 0.05);
      masterGainValue = target;
    } catch (e) {}
  }
  } catch (e) {
    if (__DEV__) console.warn('[audio] rescheduleAll error:', e?.message || e);
  }
}

// Scene transition: fade out old voices, reset schedule, duck master gain.
function transitionScene() {
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    if (audioContext) fadeOutAllVoices(audioContext);
    cleanupOrphanedSynths();
    scheduler.resetScheduleWindow();
  }
  if (audioContext && masterGain) {
    try {
      const target = getTargetGain();
      const now = audioContext.currentTime;
      if (!isFinite(target) || !isFinite(now) || target < 0) return;
      masterGain.gain.setValueAtTime(masterGainValue, now);
      masterGain.gain.linearRampToValueAtTime(masterGainValue * 0.6, now + 0.02);
      masterGain.gain.linearRampToValueAtTime(target, now + 0.10);
      masterGainValue = target;
    } catch (e) {}
  }
}

// ── Pause / Resume ──────────────────────────────────────────
function pauseAudio() {
  if (!audioInitialized || !scheduler) return;
  scheduler.stop();
  try { if (audioContext && audioContext.suspend) audioContext.suspend(); } catch (e) {}
}

function resumeAudio() {
  if (!audioInitialized || !scheduler) return;
  try { if (audioContext && audioContext.resume) audioContext.resume(); } catch (e) {}
  scheduler.resume();
}

// ── Exports ─────────────────────────────────────────────────
function isAudioInitialized() { return audioInitialized; }
function getAudioContext() { return audioContext; }

function getTransportSeconds() {
  if (!audioInitialized || !scheduler) return 0;
  return scheduler.getLoopPosition(audioContext.currentTime);
}

export {
  initAudio, pauseAudio, resumeAudio, updateBPM, updateCycleDuration, rescheduleAll, transitionScene,
  triggerNote, playPreview, swapTimbre, isAudioInitialized, getTransportSeconds,
  getCycleDuration, ensureSynth, setNoteCallback, getAudioContext,
};
