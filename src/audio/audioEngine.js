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

// Synth pool: one config per timbre (lightweight — just config + volume)
let synthMap = new Map();

// Callbacks for visuals
let onNoteTriggered = null;
// Track scheduled visual callbacks to avoid duplicates
let visualTimeouts = [];

function setNoteCallback(cb) {
  onNoteTriggered = cb;
}

function velocityToGain(velocity) {
  return Math.max(0.01, (velocity / 127) * 0.85);
}

function getNoteDuration(shape) {
  const sub = shape.subdivision || 1;
  const interval = cycleDuration / (shape.sides * sub);
  return Math.min(interval * 0.8, 1.0);
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

    // The scheduler calls onScheduleCycle for each cycle that needs scheduling
    scheduler = createScheduler(audioContext, cycleDuration, onScheduleCycle);
    audioInitialized = true;
    scheduler.start();
  } catch (e) {
    console.warn('[audio] Failed to initialize audio:', e);
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

function swapTimbre(shape) {
  ensureSynth(shape);
}

function cleanupOrphanedSynths() {
  const usedTimbres = new Set(getShapes().map(s => s.timbre || 'classic'));
  for (const [timbre] of synthMap) {
    if (!usedTimbres.has(timbre)) {
      synthMap.delete(timbre);
    }
  }
}

// ── Cycle scheduling ────────────────────────────────────────
// Called by the scheduler for each cycle that needs to be pre-scheduled.
// Creates all oscillators + envelopes for every note in the cycle.
function onScheduleCycle(cycleStartTime, cycleNumber) {
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
        const noteTime = cycleStartTime + i * interval + s * subInterval;
        const v = shape.vertices[i];
        if (!v) continue;

        const stepData = s === 0 ? v : (v.subs && v.subs[s - 1]);
        if (!stepData || stepData.muted) continue;

        const vel = velocityToGain(stepData.velocity);
        const dur = getNoteDuration(shape);

        try {
          triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur, noteTime);
        } catch (e) {
          // Don't let one bad note stop the cycle
        }

        // Schedule visual callback
        if (s === 0 && onNoteTriggered) {
          const delayMs = Math.max(0, (noteTime - audioContext.currentTime) * 1000);
          const tid = setTimeout(() => {
            onNoteTriggered(shape, i);
          }, delayMs);
          visualTimeouts.push(tid);
        }
      }
    }
  }
}

// ── Direct note triggering (for preview/tap) ────────────────
function triggerStep(shape, stepData, vertexIndex, time) {
  if (!stepData || stepData.muted || !audioContext || !masterGain) return;

  const synth = ensureSynth(shape);
  if (!synth) return;
  const vel = velocityToGain(stepData.velocity);
  const dur = getNoteDuration(shape);
  const t = time || audioContext.currentTime;

  try {
    triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur, t);
  } catch (e) {
    // Silently fail
  }
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
  // Clear pending visual callbacks
  for (const tid of visualTimeouts) clearTimeout(tid);
  visualTimeouts = [];

  updateCycleDuration();
  if (audioInitialized && scheduler) {
    cleanupOrphanedSynths();
    // Stop and restart the scheduler to re-trigger cycle scheduling
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
