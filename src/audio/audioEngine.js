import { AudioContext } from 'react-native-audio-api';
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

function setNoteCallback(cb) { onNoteTriggered = cb; }

function velocityToGain(velocity) {
  return Math.max(0.01, (velocity / 127) * 0.85);
}

function getNoteDuration(shape) {
  const sub = shape.subdivision || 1;
  const sides = shape.sides || 1;
  const interval = cycleDuration / (sides * sub);
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
  } catch (e) {
    console.warn('[audio] Init failed:', e?.message || e);
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
  for (const [timbre] of synthMap) {
    if (!usedTimbres.has(timbre)) synthMap.delete(timbre);
  }
}

// ── Scheduler tick (non-overlapping window approach) ─────────
// The scheduler guarantees [scheduleFrom, scheduleTo) windows never overlap,
// so every event fires exactly once — no deduplication needed.
function onSchedulerTick(scheduleFrom, scheduleTo, transportStart, cycleDur) {
  try {
    const shapes = getShapes();
    if (!shapes || shapes.length === 0) return;
    if (!cycleDur || cycleDur <= 0) return;

    for (const shape of shapes) {
      if (!shape || !shape.vertices) continue;
      const synth = ensureSynth(shape);
      if (!synth) continue;

      const sides = shape.sides;
      if (!sides || sides <= 0) continue;
      const sub = shape.subdivision || 1;
      const interval = cycleDur / sides;
      const subInterval = interval / sub;

      // Determine which cycles overlap our schedule window
      const relFrom = scheduleFrom - transportStart;
      const relTo = scheduleTo - transportStart;
      const firstCycle = Math.max(0, Math.floor(relFrom / cycleDur));
      const lastCycle = Math.floor(relTo / cycleDur);

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

            const vel = velocityToGain(stepData.velocity || 85) * (shape.volume != null ? shape.volume : 1);
            const dur = getNoteDuration(shape);

            try {
              triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur, eventTime);
            } catch (e) {}

            if (s === 0 && onNoteTriggered) {
              try { onNoteTriggered(shape, i); } catch (e) {}
            }
          }
        }
      }
    }
  } catch (e) {
    // Never let scheduler errors crash the app
  }
}

// ── Direct triggering (preview/tap) ─────────────────────────
function triggerStep(shape, stepData, vertexIndex) {
  if (!stepData || stepData.muted || !audioContext || !masterGain) return;
  const synth = ensureSynth(shape);
  if (!synth) return;
  const vel = velocityToGain(stepData.velocity || 85);
  const dur = getNoteDuration(shape);
  try {
    triggerTimbre(audioContext, masterGain, synth, stepData, vel, dur);
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
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    cleanupOrphanedSynths();
  }
  // Scale master gain to prevent clipping with multiple shapes
  if (audioContext && masterGain) {
    try {
      const target = getTargetGain();
      const now = audioContext.currentTime;
      // cancelScheduledValues crashes react-native-audio-api@0.6.5 (null deque iterator)
      masterGain.gain.setValueAtTime(masterGainValue, now);
      masterGain.gain.linearRampToValueAtTime(target, now + 0.05);
      masterGainValue = target;
    } catch (e) {}
  }
}

// Scene transition: fade old voices out, keep master gain steady.
// No masterGain dip — new scene notes start immediately on the next
// scheduler tick, so the crossfade is old voices fading out while
// new voices fade in naturally via their attack envelopes.
function transitionScene() {
  if (audioContext) fadeOutAllVoices(audioContext);
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    cleanupOrphanedSynths();
    // Reset schedule window so the new scene's beat-0 notes are picked up
    // immediately instead of waiting for the next tick window.
    scheduler.resetScheduleWindow();
  }
  // Update master gain for new scene's shape count (no dip)
  if (audioContext && masterGain) {
    try {
      const target = getTargetGain();
      const now = audioContext.currentTime;
      masterGain.gain.setValueAtTime(masterGainValue, now);
      masterGain.gain.linearRampToValueAtTime(target, now + 0.05);
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
  scheduler.start();
}

// ── Exports ─────────────────────────────────────────────────
function isAudioInitialized() { return audioInitialized; }
function getAudioContext() { return audioContext; }

function getTransportSeconds() {
  if (!audioInitialized || !scheduler) return 0;
  return scheduler.getLoopPosition(audioContext.currentTime);
}

export {
  initAudio, pauseAudio, resumeAudio, updateBPM, rescheduleAll, transitionScene,
  triggerNote, playPreview, swapTimbre, isAudioInitialized, getTransportSeconds,
  getCycleDuration, ensureSynth, setNoteCallback, getAudioContext,
};
