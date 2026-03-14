import { AudioContext } from 'react-native-audio-api';
import { getState, getShapes, updateState } from '../state.js';
import { TIMING } from '../constants.js';
import { createTimbre, triggerTimbre } from './timbres.js';
import { createScheduler } from './scheduler.js';

let audioContext = null;
let scheduler = null;
let audioInitialized = false;
let cycleDuration = 2;
let masterGain = null;
let synthMap = new Map();
let onNoteTriggered = null;

// Track which events have fired this cycle
let lastFireTimes = {};

function setNoteCallback(cb) { onNoteTriggered = cb; }

function velocityToGain(velocity) {
  return Math.max(0.01, (velocity / 127) * 0.85);
}

function getNoteDuration(shape) {
  const sub = shape.subdivision || 1;
  const interval = cycleDuration / (shape.sides * sub);
  return Math.min(interval * 0.6, 0.5);
}

// ── Init ─────────────────────────────────────────────────────
function initAudio() {
  if (audioInitialized) return;

  try {
    audioContext = new AudioContext();
    if (audioContext.resume) audioContext.resume();

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.8;
    masterGain.connect(audioContext.destination);

    updateCycleDuration();
    scheduler = createScheduler(audioContext, cycleDuration, onSchedulerTick);
    audioInitialized = true;
    scheduler.start();
  } catch (e) {
    console.warn('[audio] Init failed:', e);
    audioInitialized = false;
  }
}

function updateCycleDuration() {
  const state = getState();
  cycleDuration = (60 / state.bpm) * TIMING.defaultCycleBeats;
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
  const timbre = shape.timbre || 'classic';
  let synth = synthMap.get(timbre);
  if (!synth) {
    synth = createTimbre(audioContext, timbre);
    synthMap.set(timbre, synth);
  }
  return synth;
}

function swapTimbre(shape) { ensureSynth(shape); }

function cleanupOrphanedSynths() {
  const usedTimbres = new Set(getShapes().map(s => s.timbre || 'classic'));
  for (const [timbre] of synthMap) {
    if (!usedTimbres.has(timbre)) synthMap.delete(timbre);
  }
}

// ── Scheduler tick ──────────────────────────────────────────
// Called every 25ms with the current loop position.
// Checks which events should fire and plays them immediately.
function onSchedulerTick(loopPos, now) {
  const shapes = getShapes();

  for (const shape of shapes) {
    const synth = ensureSynth(shape);
    if (!synth) continue;

    const sides = shape.sides;
    const sub = shape.subdivision || 1;
    const interval = cycleDuration / sides;
    const subInterval = interval / sub;

    for (let i = 0; i < sides; i++) {
      for (let s = 0; s < sub; s++) {
        const eventTime = i * interval + s * subInterval;
        const eventKey = `${shape.id}-${i}-${s}`;

        // Check if we've passed this event's time
        // Use a window: event fires if loopPos is within [eventTime, eventTime + window)
        const window = 0.04; // 40ms window
        let diff = loopPos - eventTime;
        // Handle wrap-around
        if (diff < -cycleDuration / 2) diff += cycleDuration;
        if (diff > cycleDuration / 2) diff -= cycleDuration;

        if (diff >= 0 && diff < window) {
          // Check if already fired recently
          const lastFire = lastFireTimes[eventKey] || 0;
          if (now - lastFire < cycleDuration * 0.5) continue;
          lastFireTimes[eventKey] = now;

          const v = shape.vertices[i];
          if (!v) continue;
          const stepData = s === 0 ? v : (v.subs && v.subs[s - 1]);
          if (!stepData || stepData.muted) continue;

          const vel = velocityToGain(stepData.velocity);
          const dur = getNoteDuration(shape);

          try {
            triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur);
          } catch (e) {}

          if (s === 0 && onNoteTriggered) {
            onNoteTriggered(shape, i);
          }
        }
      }
    }
  }
}

// ── Direct triggering (preview/tap) ─────────────────────────
function triggerStep(shape, stepData, vertexIndex) {
  if (!stepData || stepData.muted || !audioContext || !masterGain) return;
  const synth = ensureSynth(shape);
  if (!synth) return;
  const vel = velocityToGain(stepData.velocity);
  const dur = getNoteDuration(shape);
  try {
    triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur);
  } catch (e) {}
}

function triggerNote(shape, vertexIndex) {
  const v = shape.vertices[vertexIndex];
  if (!v || v.muted) return;
  triggerStep(shape, v, vertexIndex);
  if (onNoteTriggered) onNoteTriggered(shape, vertexIndex);
}

function playPreview(shape, vertexIndex, stepIndex) {
  const v = shape.vertices[vertexIndex];
  if (!v || !audioInitialized) return;
  const stepData = (stepIndex && stepIndex > 0 && v.subs) ? v.subs[stepIndex - 1] : v;
  if (!stepData || stepData.muted) return;
  triggerStep(shape, stepData, vertexIndex);
}

// ── Reschedule ──────────────────────────────────────────────
function rescheduleAll() {
  lastFireTimes = {};
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    cleanupOrphanedSynths();
    scheduler.stop();
    scheduler.start();
  }
}

// ── Exports ─────────────────────────────────────────────────
function isAudioInitialized() { return audioInitialized; }
function getAudioContext() { return audioContext; }

function getTransportSeconds() {
  if (!audioInitialized || !scheduler) return 0;
  return scheduler.getLoopPosition(audioContext.currentTime);
}

export {
  initAudio, updateBPM, rescheduleAll, triggerNote, playPreview,
  swapTimbre, isAudioInitialized, getTransportSeconds,
  getCycleDuration, ensureSynth, setNoteCallback, getAudioContext,
};
