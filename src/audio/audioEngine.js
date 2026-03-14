import { AudioContext } from 'react-native-audio-api';
import { getState, getShapes, updateState } from '../state.js';
import { TIMING } from '../constants.js';
import { createTimbre, triggerTimbre } from './timbres.js';
import { createScheduler } from './scheduler.js';

let audioContext = null;
let scheduler = null;
let audioInitialized = false;
let cycleDuration = 2;

// Simple chain: masterGain → destination
let masterGain = null;

// Synth pool: one per timbre
let synthMap = new Map();
let scheduleIds = [];

// Callbacks for visuals (set by rendering layer)
let onNoteTriggered = null;

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

// ── Effects chain ────────────────────────────────────────────
function createEffectsChain(ctx) {
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.8;

  // Direct: masterGain → destination
  // (createDynamicsCompressor not available in react-native-audio-api)
  masterGain.connect(ctx.destination);
}

// ── Init ─────────────────────────────────────────────────────
function initAudio() {
  if (audioInitialized) return;

  try {
    audioContext = new AudioContext();
    console.log('[audio] AudioContext created, sampleRate:', audioContext.sampleRate, 'state:', audioContext.state);

    createEffectsChain(audioContext);
    console.log('[audio] Effects chain created, masterGain:', !!masterGain);

    // Test beep — direct to destination to verify audio works at all
    try {
      const testOsc = audioContext.createOscillator();
      const testGain = audioContext.createGain();
      testOsc.type = 'sine';
      testOsc.frequency.value = 440;
      testGain.gain.value = 0.3;
      testOsc.connect(testGain);
      testGain.connect(audioContext.destination);
      const now = audioContext.currentTime;
      testOsc.start(now);
      testOsc.stop(now + 0.3);
      console.log('[audio] Test beep scheduled at', now);
    } catch (beepErr) {
      console.warn('[audio] Test beep FAILED:', beepErr);
    }

    updateCycleDuration();
    console.log('[audio] cycleDuration:', cycleDuration);

    scheduler = createScheduler(audioContext, cycleDuration, onSchedulerTick);
    audioInitialized = true;

    scheduleAllShapes();
    console.log('[audio] Scheduled', scheduleIds.length, 'events');

    scheduler.start();
    console.log('[audio] Scheduler started');
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
  if (!audioContext || !masterGain) return null;
  const timbre = shape.timbre || 'classic';
  let synth = synthMap.get(timbre);
  if (!synth) {
    try {
      synth = createTimbre(audioContext, timbre);
      if (synth && synth.output) {
        synth.output.connect(masterGain);
      }
      synthMap.set(timbre, synth);
    } catch (e) {
      console.warn('Failed to create timbre:', timbre, e);
      return null;
    }
  }
  return synth;
}

function swapTimbre(shape) {
  ensureSynth(shape);
}

function cleanupOrphanedSynths() {
  const usedTimbres = new Set(getShapes().map(s => s.timbre || 'classic'));
  for (const [timbre, synth] of synthMap) {
    if (!usedTimbres.has(timbre)) {
      if (synth.dispose) synth.dispose();
      synthMap.delete(timbre);
    }
  }
}

// ── Note triggering ──────────────────────────────────────────
let triggerCount = 0;
function triggerStep(shape, stepData, vertexIndex, time) {
  if (!stepData || stepData.muted || !audioContext) return;

  const synth = ensureSynth(shape);
  if (!synth) {
    console.warn('[audio] ensureSynth returned null for', shape.timbre);
    return;
  }
  const vel = velocityToGain(stepData.velocity);
  const dur = getNoteDuration(shape);
  const t = time || audioContext.currentTime;

  try {
    triggerTimbre(audioContext, synth, shape.timbre, stepData, vel, dur, t);
    triggerCount++;
    if (triggerCount <= 5) {
      console.log('[audio] triggerStep:', shape.timbre, 'pitches:', stepData.pitches, 'vel:', vel.toFixed(2), 'dur:', dur.toFixed(2), 'time:', t.toFixed(2));
    }
  } catch (e) {
    console.warn('[audio] Failed to trigger note:', e);
  }
}

function triggerNote(shape, vertexIndex) {
  const v = shape.vertices[vertexIndex];
  if (!v || v.muted) return;

  triggerStep(shape, v, vertexIndex);

  if (onNoteTriggered) {
    onNoteTriggered(shape, vertexIndex);
  }
}

function playPreview(shape, vertexIndex, stepIndex) {
  const v = shape.vertices[vertexIndex];
  if (!v || !audioInitialized) return;
  const stepData = (stepIndex && stepIndex > 0 && v.subs) ? v.subs[stepIndex - 1] : v;
  if (!stepData || stepData.muted) return;

  triggerStep(shape, stepData, vertexIndex);
}

// ── Scheduling ──────────────────────────────────────────────
function onSchedulerTick(currentTime, lookAheadEnd) {
  if (!scheduler) return;
  const loopPos = scheduler.getLoopPosition(currentTime);
  const cycleNum = scheduler.getCycleNumber(currentTime);

  for (const event of scheduleIds) {
    const timeInLoop = event.time;
    const eventTimeAbs = currentTime - loopPos + timeInLoop;
    const wrappedEventTime = eventTimeAbs < currentTime
      ? eventTimeAbs + cycleDuration
      : eventTimeAbs;

    if (wrappedEventTime >= currentTime && wrappedEventTime < lookAheadEnd) {
      if (event.lastCycle === cycleNum) continue;
      event.lastCycle = cycleNum;
      event.callback(wrappedEventTime);
    }
  }
}

function scheduleShape(shape) {
  const sides = shape.sides;
  const sub = shape.subdivision || 1;
  const interval = cycleDuration / sides;
  const subInterval = interval / sub;

  for (let i = 0; i < sides; i++) {
    for (let s = 0; s < sub; s++) {
      const time = i * interval + s * subInterval;
      const vertexIndex = i;
      const stepIndex = s;

      scheduleIds.push({
        time,
        lastCycle: -1,
        callback: (t) => {
          const currentShapes = getShapes();
          const currentShape = currentShapes.find(sh => sh.id === shape.id);
          if (!currentShape || vertexIndex >= currentShape.vertices.length) return;
          const v = currentShape.vertices[vertexIndex];
          const stepData = stepIndex === 0 ? v : (v.subs && v.subs[stepIndex - 1]);
          if (stepData && !stepData.muted) {
            triggerStep(currentShape, stepData, vertexIndex, t);
          }
          if (stepIndex === 0 && !v.muted && onNoteTriggered) {
            onNoteTriggered(currentShape, vertexIndex);
          }
        },
      });
    }
  }
}

function scheduleAllShapes() {
  const shapes = getShapes();
  for (const shape of shapes) {
    ensureSynth(shape);
    scheduleShape(shape);
  }
}

function rescheduleAll() {
  scheduleIds = [];
  updateCycleDuration();
  if (audioInitialized) {
    cleanupOrphanedSynths();
    scheduleAllShapes();
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
