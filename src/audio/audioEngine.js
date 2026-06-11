import { AudioContext } from 'react-native-audio-api';
import { AppState } from 'react-native';
import { getState, getShapes, updateState } from '../state.js';
import { TIMING, AUDIO, makeDefaultFx, makeDefaultMasterFx } from '../constants.js';
import { createTimbre, triggerTimbre, initSampleBank, fadeOutAllVoices, getActiveVoiceCount, getMaxVoices } from './timbres.js';
import { createScheduler } from './scheduler.js';
import { EQ_BANDS, eqGainDb, cutoffToHz, resToQ as dspResToQ } from './dsp.js';

let audioContext = null;
let scheduler = null;
let audioInitialized = false;
let cycleDuration = 2;
let masterGain = null;
let synthMap = new Map();
let onNoteTriggered = null;
let sceneProvider = null; // cycle number → scene index (set by sequencer)
let masterGainValue = 0.7;  // Track gain in JS to avoid .value getter issues
let appStateSubscription = null;
let rescheduleThrottleId = null;
const MAX_NOTES_PER_TICK = 12;

// ── Effects graph ────────────────────────────────────────────
// Per-shape channel strips + two shared send buses + master chain.
// Built only from Gain / BiquadFilter / StereoPanner — the proven-stable
// nodes on react-native-audio-api 0.6.5.
//
//  voices → ch.input(vol) → ch.filter(tone) → ch.panner(pan) → masterInput
//                                   └→ (sends are applied per scheduled tap)
//  echo taps  → echoPanL/echoPanR (ping-pong) → echoTone → echoLevel → masterInput
//  verb taps  → verbIn → verbTone → verbLevel → masterInput
//  masterInput(headroom × master volume) → masterTone → destination
let masterTone = null;
let masterEq = null;
let echoPanL = null, echoPanR = null, echoTone = null, echoLevel = null;
let verbIn = null, verbTone = null, verbLevel = null;
const channels = new Map(); // shape.id → { input, eq, filter, panner }

// tone 0..1 → cutoff Hz on a log scale
function toneToHz(t, lo = 300, hi = 18000) {
  const x = Math.max(0, Math.min(1, Number(t) ?? 1));
  return lo * Math.pow(hi / lo, x);
}

const resToQ = dspResToQ;

// AudioParam .value GETTERS are unreliable on react-native-audio-api 0.6.5
// (same reason masterGainValue is tracked in JS) — reading one as a ramp
// anchor can poison the param with NaN → buzzing filters, dead controls.
// Every ramp anchors from a JS-tracked value instead.
function rampParam(param, from, to, now) {
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(to, now + 0.04);
}

// JS-tracked current values for the master fx graph
let masterCur = null;

// Shape filter cutoff (with legacy 'tone' fallback) — 80Hz..18kHz so
// highpass sweeps have somewhere to live
function shapeCutoffHz(fx) {
  const c = fx.cutoff !== undefined ? fx.cutoff : (fx.tone !== undefined ? fx.tone : 1);
  return cutoffToHz(c);
}

// Build the 3 EQ biquads (lowshelf/peaking/highshelf) used by every strip
function createEqNodes() {
  const mk = (band) => {
    const n = audioContext.createBiquadFilter();
    n.type = band.type;
    n.frequency.value = band.freq;
    n.Q.value = band.Q || 0.707;
    n.gain.value = 0;
    return n;
  };
  return { low: mk(EQ_BANDS.low), mid: mk(EQ_BANDS.mid), high: mk(EQ_BANDS.high) };
}

// cur = JS-tracked {eqLow, eqMid, eqHigh} in dB — never read node.gain.value
function rampEq(eq, cur, fxLike, now) {
  const set = (node, key, v) => {
    const target = eqGainDb(v);
    rampParam(node.gain, cur[key], target, now);
    cur[key] = target;
  };
  set(eq.low, 'eqLow', fxLike.eqLow);
  set(eq.mid, 'eqMid', fxLike.eqMid);
  set(eq.high, 'eqHigh', fxLike.eqHigh);
}

function getMasterFx() {
  const s = getState();
  return { ...makeDefaultMasterFx(), ...((s && s.effects) || {}) };
}

function getShapeFx(shape) {
  return { ...makeDefaultFx(), ...((shape && shape.fx) || {}) };
}

function setNoteCallback(cb) { onNoteTriggered = cb; }
function setSceneProvider(fn) { sceneProvider = fn; }

// resume()/suspend()/close() return promises on react-native-audio-api —
// a bare try/catch misses async rejections, which surface as unhandled
// promise rejections. This guards both sync throws and rejections.
function safeAudioOp(fn) {
  try {
    const p = fn();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) {}
}

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
// Called during loading screen — creates AudioContext and loads all samples.
// Returns a promise that resolves when everything is ready to play.
let initPromise = null;

function initAudio() {
  if (audioInitialized) return Promise.resolve();
  // Idempotent: concurrent callers (loading screen + first-play retry)
  // share one in-flight attempt
  if (!initPromise) {
    initPromise = doInitAudio().finally(() => { initPromise = null; });
  }
  return initPromise;
}

async function doInitAudio() {
  try {
    audioContext = new AudioContext();
    safeAudioOp(() => audioContext.resume());

    // Master chain: masterGain (auto-headroom × user volume) → masterTone → out
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.7;
    masterTone = audioContext.createBiquadFilter();
    masterTone.type = 'lowpass';
    masterTone.frequency.value = toneToHz(1);
    masterTone.Q.value = 0.707; // Butterworth — flat response, no resonance (tiny Q makes biquads degenerate/crunchy)
    masterEq = createEqNodes();
    masterGain.connect(masterEq.low);
    masterEq.low.connect(masterEq.mid);
    masterEq.mid.connect(masterEq.high);
    masterEq.high.connect(masterTone);
    masterTone.connect(audioContext.destination);

    // Echo bus: ping-pong panners → darkening filter → return level → master
    echoPanL = audioContext.createStereoPanner();
    echoPanL.pan.value = -0.7;
    echoPanR = audioContext.createStereoPanner();
    echoPanR.pan.value = 0.7;
    echoTone = audioContext.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 5000;
    echoTone.Q.value = 0.707; // Butterworth — flat response, no resonance (tiny Q makes biquads degenerate/crunchy)
    echoLevel = audioContext.createGain();
    echoLevel.gain.value = makeDefaultMasterFx().delayWet;
    echoPanL.connect(echoTone);
    echoPanR.connect(echoTone);
    echoTone.connect(echoLevel);
    echoLevel.connect(masterGain);

    // Reverb bus: diffuse taps in → dark filter → return level → master
    verbIn = audioContext.createGain();
    verbIn.gain.value = 1;
    verbTone = audioContext.createBiquadFilter();
    verbTone.type = 'lowpass';
    verbTone.frequency.value = 3200;
    verbTone.Q.value = 0.707; // Butterworth — flat response, no resonance (tiny Q makes biquads degenerate/crunchy)
    verbLevel = audioContext.createGain();
    verbLevel.gain.value = makeDefaultMasterFx().reverbWet;
    verbIn.connect(verbTone);
    verbTone.connect(verbLevel);
    verbLevel.connect(masterGain);

    // JS-tracked applied values for every master param we ever ramp
    masterCur = {
      toneHz: toneToHz(1),
      echoWet: makeDefaultMasterFx().delayWet,
      verbWet: makeDefaultMasterFx().reverbWet,
      eqLow: 0, eqMid: 0, eqHigh: 0,
    };

    // Wait for ALL samples to be decoded before marking as ready
    await initSampleBank(audioContext);

    updateCycleDuration();
    scheduler = createScheduler(audioContext, cycleDuration, onSchedulerTick);
    audioInitialized = true;
    applyMasterFx(); // apply persisted master effects (loaded projects)

    // Suspend immediately — we'll resume when the user taps play.
    // This prevents the context from auto-playing before the user interacts.
    safeAudioOp(() => audioContext.suspend());

    // Background/foreground handling
    if (!appStateSubscription) {
      appStateSubscription = AppState.addEventListener('change', (nextState) => {
        if (!audioInitialized) return;
        if (nextState === 'background' || nextState === 'inactive') {
          if (scheduler) scheduler.stop();
          safeAudioOp(() => { if (audioContext) return audioContext.suspend(); });
        } else if (nextState === 'active') {
          // Only reactivate the audio session if the user was actually playing
          if (getState().ui.playing) {
            safeAudioOp(() => {
              if (audioContext && audioContext.state !== 'running') return audioContext.resume();
            });
            if (scheduler) scheduler.resume();
          }
        }
      });
    }
  } catch (e) {
    if (__DEV__) console.warn('[audio] Init failed:', e?.message || e);
    if (audioContext) {
      safeAudioOp(() => audioContext.close());
      audioContext = null;
    }
    masterGain = null;
    audioInitialized = false;
  }
}

// Called when user taps play — resumes context and starts scheduler instantly.
function startPlayback() {
  if (!audioInitialized || !audioContext || !scheduler) {
    // Init failed during the loading screen (rare) — retry once in the
    // background and start playback when it lands, if still requested.
    initAudio().then(() => {
      if (audioInitialized && audioContext && scheduler && getState().ui.playing) {
        safeAudioOp(() => audioContext.resume());
        scheduler.start();
      }
    }).catch(() => {});
    return;
  }
  safeAudioOp(() => audioContext.resume());
  scheduler.start();
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
  const clamped = Math.max(AUDIO.minBpm, Math.min(AUDIO.maxBpm, Math.round(Number(newBPM) || 120)));
  updateState(s => { s.bpm = clamped; });
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

// ── Per-shape channel strips ─────────────────────────────────
function getChannel(shape) {
  if (!audioContext || !masterGain) return null;
  let ch = channels.get(shape.id);
  if (!ch) {
    try {
      const fx = getShapeFx(shape);
      const input = audioContext.createGain();
      input.gain.value = shape.volume != null ? shape.volume : 1;
      const eq = createEqNodes();
      eq.low.gain.value = eqGainDb(fx.eqLow);
      eq.mid.gain.value = eqGainDb(fx.eqMid);
      eq.high.gain.value = eqGainDb(fx.eqHigh);
      const filter = audioContext.createBiquadFilter();
      filter.type = fx.filterType || 'lowpass';
      filter.frequency.value = shapeCutoffHz(fx);
      filter.Q.value = resToQ(fx.res); // 0.707 floor — tiny Q makes biquads degenerate/crunchy
      const panner = audioContext.createStereoPanner();
      panner.pan.value = fx.pan;
      input.connect(eq.low);
      eq.low.connect(eq.mid);
      eq.mid.connect(eq.high);
      eq.high.connect(filter);
      filter.connect(panner);
      panner.connect(masterGain);
      // cur: JS-tracked applied values — ramp anchors (never .value getters)
      ch = {
        input, eq, filter, panner,
        cur: {
          vol: shape.volume != null ? shape.volume : 1,
          hz: shapeCutoffHz(fx),
          q: resToQ(fx.res),
          pan: fx.pan,
          eqLow: eqGainDb(fx.eqLow),
          eqMid: eqGainDb(fx.eqMid),
          eqHigh: eqGainDb(fx.eqHigh),
        },
      };
      channels.set(shape.id, ch);
    } catch (e) {
      return null;
    }
  }
  return ch;
}

// Smoothly apply a shape's live mixer params to its strip
function applyChannelFx(shape) {
  const ch = channels.get(shape.id);
  if (!ch || !audioContext) return;
  const fx = getShapeFx(shape);
  const now = audioContext.currentTime;
  try {
    const c = ch.cur;
    const vol = shape.volume != null ? shape.volume : 1;
    rampParam(ch.input.gain, c.vol, vol, now);
    c.vol = vol;
    rampEq(ch.eq, c, fx, now);
    const type = fx.filterType || 'lowpass';
    if (ch.filter.type !== type) ch.filter.type = type; // discrete — no ramp
    const hz = shapeCutoffHz(fx);
    rampParam(ch.filter.frequency, c.hz, hz, now);
    c.hz = hz;
    const q = resToQ(fx.res);
    rampParam(ch.filter.Q, c.q, q, now);
    c.q = q;
    const pan = Math.max(-1, Math.min(1, fx.pan));
    rampParam(ch.panner.pan, c.pan, pan, now);
    c.pan = pan;
  } catch (e) {}
}

// Channels for shapes that no longer exist in ANY scene get torn down
function cleanupOrphanedChannels() {
  const state = getState();
  const liveIds = new Set();
  if (state && state.scenes) {
    for (const scene of state.scenes) {
      for (const sh of (scene.shapes || [])) liveIds.add(sh.id);
    }
  }
  for (const [id, ch] of channels) {
    if (liveIds.has(id)) continue;
    channels.delete(id);
    try { ch.panner.disconnect(); } catch (e) {}
    try { ch.filter.disconnect(); } catch (e) {}
    try { ch.eq.high.disconnect(); } catch (e) {}
    try { ch.eq.mid.disconnect(); } catch (e) {}
    try { ch.eq.low.disconnect(); } catch (e) {}
    try { ch.input.disconnect(); } catch (e) {}
  }
}

// ── Note + effect-tap scheduling ─────────────────────────────
// The echo bus is fed by SCHEDULED copies of each note (no DelayNode on
// 0.6.5): up to 3 decaying taps alternating L/R = sample-accurate
// ping-pong. Reverb is 4 diffuse taps into a dark bus. Taps are skipped
// under voice-pool pressure so extreme tempos degrade gracefully.
const VERB_TAPS = [0.029, 0.061, 0.097, 0.141];

// Effective echo tap spacing: BPM-synced beats when delaySync is set
// (tracks tempo automatically — recomputed per note), free seconds otherwise
function getEchoDelaySeconds(m) {
  if (m.delaySync) {
    const bpm = (getState() && getState().bpm) || 120;
    return Math.max(0.05, Math.min(1.2, (60 / bpm) * m.delaySync));
  }
  return Math.max(0.05, Math.min(0.7, m.delayTime));
}

// Graduated tap budget: when the voice pool fills, shed the QUIETEST taps
// first instead of cutting all effects at once — combining many sends
// degrades gracefully rather than stuttering on/off
function tapBudget() {
  const pressure = getActiveVoiceCount() / Math.max(1, getMaxVoices());
  if (pressure < 0.5) return 3;
  if (pressure < 0.7) return 2;
  if (pressure < 0.85) return 1;
  return 0;
}

function scheduleVoice(shape, synth, stepData, vel, dur, when, vertexIndex) {
  const ch = getChannel(shape);
  if (!ch) return;
  const fx = getShapeFx(shape);
  try {
    triggerTimbre(audioContext, ch.input, synth, stepData, vel, dur, when, vertexIndex, fx.drive);
  } catch (e) {}

  const maxTaps = tapBudget();
  if (maxTaps === 0) return;
  const base = when != null ? when : audioContext.currentTime;

  if (fx.echoSend > 0.01 && echoPanL) {
    const m = getMasterFx();
    const fb = Math.max(0, Math.min(0.85, m.delayFeedback));
    const dt = getEchoDelaySeconds(m);
    let g = vel * fx.echoSend;
    for (let k = 1; k <= Math.min(3, maxTaps); k++) {
      g *= fb;
      if (g < 0.012) break;
      const dest = (k % 2 === 1) ? echoPanL : echoPanR;
      try { triggerTimbre(audioContext, dest, synth, stepData, g, dur, base + k * dt, vertexIndex, fx.drive, true); } catch (e) {}
    }
  }

  if (fx.verbSend > 0.01 && verbIn) {
    let g = vel * fx.verbSend * 0.7;
    const verbTapCount = Math.min(VERB_TAPS.length, maxTaps + 1);
    for (let k = 0; k < verbTapCount; k++) {
      const tapGain = g * Math.pow(0.62, k);
      if (tapGain < 0.012) break;
      try { triggerTimbre(audioContext, verbIn, synth, stepData, tapGain, dur, base + VERB_TAPS[k], vertexIndex, fx.drive, true); } catch (e) {}
    }
  }
}

// ── Scheduler tick (non-overlapping window approach) ─────────
// The scheduler guarantees [scheduleFrom, scheduleTo) windows never overlap,
// so every event fires exactly once — no deduplication needed.
// Each CYCLE is scheduled from the scene the sequencer maps it to, so scene
// loops are sample-accurate: the next scene's downbeat is scheduled inside
// the lookahead window, on the exact cycle boundary, with the transport
// running continuously (no resets, no voice kills, no UI-thread latency).
function onSchedulerTick(scheduleFrom, scheduleTo, transportStart, cycleDur) {
  try {
    const state = getState();
    if (!state || !state.scenes || state.scenes.length === 0) return;
    if (!cycleDur || cycleDur <= 0) return;
    if (!isFinite(scheduleFrom) || !isFinite(scheduleTo)) return;

    const relFrom = scheduleFrom - transportStart;
    const relTo = scheduleTo - transportStart;
    if (!isFinite(relFrom) || !isFinite(relTo)) return;
    const firstCycle = Math.max(0, Math.floor(relFrom / cycleDur));
    const lastCycle = Math.min(firstCycle + 2, Math.floor(relTo / cycleDur)); // Cap to 2 cycles per tick

    let totalNotes = 0;

    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      const sceneIdx = sceneProvider ? sceneProvider(cycle) : state.activeSceneIndex;
      const scene = state.scenes[sceneIdx];
      const shapes = scene && scene.shapes;
      if (!shapes || shapes.length === 0) continue;

      const cycleStart = transportStart + cycle * cycleDur;

      for (const shape of shapes) {
        if (totalNotes >= MAX_NOTES_PER_TICK) break;
        if (!shape || !shape.vertices) continue;
        const synth = ensureSynth(shape);
        if (!synth) continue;

        const sides = shape.sides;
        if (!sides || sides <= 0) continue;
        const interval = cycleDur / sides;
        // Event thinning at extreme tempo: never schedule a shape's events
        // closer than minEventSpacing — drop subdivisions first, then
        // stride across vertices. Prevents the native voice-teardown storm
        // that crashes react-native-audio-api at very high BPM.
        let sub = Math.min(shape.subdivision || 1, 4);
        if (interval / sub < AUDIO.minEventSpacing) {
          sub = Math.max(1, Math.floor(interval / AUDIO.minEventSpacing));
        }
        const vertexStride = interval < AUDIO.minEventSpacing
          ? Math.ceil(AUDIO.minEventSpacing / interval)
          : 1;
        const subInterval = interval / sub;

        for (let i = 0; i < sides; i++) {
          if (i % vertexStride !== 0) continue;
          for (let s = 0; s < sub; s++) {
            const eventTime = cycleStart + i * interval + s * subInterval;
            if (eventTime < scheduleFrom || eventTime >= scheduleTo) continue;

            const v = shape.vertices[i];
            if (!v) continue;
            const stepData = s === 0 ? v : (v.subs && v.subs[s - 1]);
            if (!stepData || stepData.muted) continue;

            if (totalNotes >= MAX_NOTES_PER_TICK) break;
            totalNotes++;

            // Per-shape volume lives on the channel strip now — velocity only here
            const vel = velocityToGain(stepData.velocity || 85);
            const dur = getNoteDuration(shape);

            scheduleVoice(shape, synth, stepData, vel, dur, eventTime, i);

            if (s === 0 && onNoteTriggered) {
              // eventTime = exact scheduled audio-clock time of this note
              try { onNoteTriggered(shape, i, eventTime); } catch (e) {}
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
  const vel = velocityToGain(stepData.velocity || 85);
  const dur = getNoteDuration(shape);
  scheduleVoice(shape, synth, stepData, vel, dur, undefined, vertexIndex);
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
    const userVol = Math.max(0, Math.min(1, getMasterFx().volume));
    // Send-aware headroom: echo + reverb taps add overlapping copies of
    // every note — without reserving room for them, combining several
    // hot sends overloads the master sum (audible crackle)
    let sendEnergy = 0;
    for (const sh of shapes) {
      const fx = getShapeFx(sh);
      sendEnergy += Math.max(0, fx.echoSend) + Math.max(0, fx.verbSend);
    }
    const sendHeadroom = 1 / (1 + 0.35 * (sendEnergy / count));
    return (0.7 / Math.sqrt(count)) * userVol * sendHeadroom;
  } catch (e) {
    return 0.7;
  }
}

// ── Live effects parameter application ──────────────────────
// All ramps via setValueAtTime + linearRamp — NEVER cancelScheduledValues
function applyMasterFx() {
  if (!audioContext || !masterTone) return;
  const m = getMasterFx();
  const now = audioContext.currentTime;
  try {
    if (!masterCur) return;
    if (masterEq) rampEq(masterEq, masterCur, m, now);
    const toneHz = toneToHz(m.tone, 300, 20000);
    rampParam(masterTone.frequency, masterCur.toneHz, toneHz, now);
    masterCur.toneHz = toneHz;
    const echoWet = Math.max(0, Math.min(1, m.delayWet));
    rampParam(echoLevel.gain, masterCur.echoWet, echoWet, now);
    masterCur.echoWet = echoWet;
    const verbWet = Math.max(0, Math.min(1, m.reverbWet));
    rampParam(verbLevel.gain, masterCur.verbWet, verbWet, now);
    masterCur.verbWet = verbWet;
  } catch (e) {}
}

// Update one shape's fx in state and ramp its strip immediately
function setShapeFx(shapeId, patch) {
  updateState(s => {
    for (const scene of s.scenes) {
      const sh = (scene.shapes || []).find(x => x.id === shapeId);
      if (sh) {
        sh.fx = { ...makeDefaultFx(), ...(sh.fx || {}), ...patch };
      }
    }
  });
  // Apply to the strip even when the shape lives in a NON-active scene —
  // channels are keyed by id and persist across scene switches
  const state = getState();
  let live = null;
  if (state && state.scenes) {
    for (const scene of state.scenes) {
      live = (scene.shapes || []).find(x => x.id === shapeId);
      if (live) break;
    }
  }
  if (live) applyChannelFx(live);
}

// Update master fx in state and ramp the buses immediately
function setMasterFx(patch) {
  updateState(s => {
    s.effects = { ...makeDefaultMasterFx(), ...(s.effects || {}), ...patch };
  });
  applyMasterFx();
  if (patch.volume !== undefined) rescheduleAll(); // re-ramp master gain target
}

function rescheduleAll() {
  try {
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    cleanupOrphanedSynths();
    cleanupOrphanedChannels();
    // Keep live strips + master buses in sync with state
    for (const sh of getShapes()) applyChannelFx(sh);
    applyMasterFx();
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

// Scene transition: quickly expire old voices, reset schedule for new scene.
function transitionScene() {
  updateCycleDuration();
  if (audioInitialized && scheduler) {
    // Mark old voices as expired — pruneVoices kills them cleanly on next tick
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
  safeAudioOp(() => { if (audioContext && audioContext.suspend) return audioContext.suspend(); });
}

function resumeAudio() {
  if (!audioInitialized || !scheduler) return;
  safeAudioOp(() => { if (audioContext && audioContext.resume) return audioContext.resume(); });
  scheduler.resume();
}

// ── Exports ─────────────────────────────────────────────────
function isAudioInitialized() { return audioInitialized; }
function getAudioContext() { return audioContext; }

function getTransportSeconds() {
  if (!audioInitialized || !scheduler) return 0;
  if (!scheduler.isRunning()) return 0;
  return scheduler.getLoopPosition(audioContext.currentTime);
}

// Raw elapsed time (not wrapped) — used by sequencer to count cycles
function getElapsedSeconds() {
  if (!audioInitialized || !scheduler) return 0;
  if (!scheduler.isRunning()) return 0;
  return scheduler.getElapsed(audioContext.currentTime);
}

export {
  initAudio, startPlayback, pauseAudio, resumeAudio, updateBPM, updateCycleDuration, rescheduleAll, transitionScene,
  triggerNote, playPreview, swapTimbre, isAudioInitialized, getTransportSeconds, getElapsedSeconds,
  getCycleDuration, ensureSynth, setNoteCallback, setSceneProvider, getAudioContext,
  setShapeFx, setMasterFx, applyMasterFx,
};
