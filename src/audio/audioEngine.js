import { AudioContext, AudioManager } from 'react-native-audio-api';
import { AppState } from 'react-native';
import { getState, getShapes, updateState } from '../state.js';
import { TIMING, AUDIO, makeDefaultFx, makeDefaultMasterFx } from '../constants.js';
import { createTimbre, triggerTimbre, initSampleBank, fadeOutAllVoices, killAllVoices, getActiveVoiceCount, getMaxVoices } from './timbres.js';
import { createScheduler } from './scheduler.js';
import { collectWindowEvents, planTick } from './eventWindow.js';
import { createTransportControl } from './transportControl.js';
import { createClockSmoother } from './clockSmoother.js';
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
// Per-tick note budget: beyond SOFT, events that aren't due before the next
// tick are deferred to it (never dropped); HARD is a last-resort valve.
const NOTES_PER_TICK_SOFT = 12;
const NOTES_PER_TICK_HARD = 64;
const DEFER_HORIZON_SEC = 0.08; // > one 50ms tick + timer jitter
const PAUSE_FADE_SEC = 0.015;   // master fade before suspend (suspend = hard cut)
const START_FADE_SEC = 0.02;    // master fade-in on play/foreground
const ROUTE_CHECK_MS = 600;     // after a route change, verify the clock is moving

// JS-tracked master automation state. masterGainValue = TARGET level;
// masterQueueEnd = end time of the last event we queued on masterGain.gain
// (0.6.5 silently ignores any event that starts before the queue end, so
// every new ramp must start at/after it). masterFaded = output parked at 0
// for pause/background — level changes then only update the target.
let masterQueueEnd = 0;
let masterQueueValue = 0.7;
let masterFaded = false;

let transport = null;
let interruptionSubs = [];
const clockSmoother = createClockSmoother();

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
// Idempotent: skips when the target already matches the tracked value —
// rescheduleAll runs often and identical re-ramps just spam the native
// param event queue (a fragile area of this library version)
function rampParam(param, from, to, now) {
  if (Math.abs(to - from) < 1e-4) return false;
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(to, now + 0.04);
  return true;
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
    // initSuspended: don't start AVAudioEngine / activate the audio session
    // at launch (that stopped the user's own music the moment Clockworks
    // opened, before they pressed play). The engine starts on first play.
    // This also removes the init-time resume()/suspend() pair, which on
    // 0.6.5 run on two racing native threads.
    audioContext = new AudioContext({ initSuspended: true });
    transport = createTransportControl(() => audioContext, {
      fadeOut: () => fadeMasterOut(),
      beforeSuspend: (why) => { if (why === 'pause') killAllVoices(); },
    });

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
    scheduler = createScheduler(audioContext, cycleDuration, onSchedulerTick, {
      onStall: () => { if (transport) transport.kick(); },
    });
    audioInitialized = true;
    applyMasterFx(); // apply persisted master effects (loaded projects)

    // Background/foreground handling. Background keeps the transport
    // position and the queued notes (they're still in the future — the
    // clock is frozen while suspended), so foreground resumes seamlessly.
    if (!appStateSubscription) {
      appStateSubscription = AppState.addEventListener('change', (nextState) => {
        if (!audioInitialized) return;
        if (nextState === 'background' || nextState === 'inactive') {
          if (scheduler) scheduler.stop();
          if (transport) transport.request('suspended', 'background');
        } else if (nextState === 'active') {
          // Only reactivate the audio session if the user was actually playing
          if (getState().ui.playing) {
            if (transport) transport.request('running');
            fadeMasterIn();
            if (scheduler) scheduler.resume();
          }
        }
      });
    }
    observeSystemAudioEvents();
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
        beginPlayback();
      }
    }).catch(() => {});
    return;
  }
  beginPlayback();
}

function beginPlayback() {
  transport.request('running');
  // Play restarts from the top of the cycle: anything still queued from the
  // previous run (lookahead notes, echo taps) must not fire. The master is
  // parked at 0 here (paused) or nothing is queued yet (first play), so the
  // kill is silent.
  if (masterFaded) killAllVoices();
  fadeMasterIn();
  clockSmoother.reset();
  scheduler.start();
}

// ── Master fade helpers (click-free pause/resume) ───────────
// suspend() on 0.6.5 zeroes the output mid-buffer (IOSAudioPlayer sets
// isRunning_=false → the render block writes silence) — an audible click
// whenever a note is sounding. Ramp the master down first.
function queueMasterRamp(to, dur) {
  if (!audioContext || !masterGain) return 0;
  const now = audioContext.currentTime;
  if (!isFinite(now)) return 0;
  // End at now+dur, or just past the last queued event if that's later —
  // NOT start+dur, or a fast slider drag would push the queue ever further
  // into the future (growing lag).
  const end = Math.max(now + dur, masterQueueEnd + 0.003);
  try {
    // Anchor only when the queue is empty (0.6.5 ignores events that start
    // before the queue end; a ramp then continues from the queued value).
    // Never read gain.value (unreliable on 0.6.5).
    if (now > masterQueueEnd) masterGain.gain.setValueAtTime(masterQueueValue, now);
    masterGain.gain.linearRampToValueAtTime(to, end);
    masterQueueEnd = end;
    masterQueueValue = to;
  } catch (e) {}
  return end - now;
}

// New master LEVEL target (volume / headroom). While parked at 0 for
// pause/background only the target changes; fadeMasterIn applies it.
function setMasterTarget(target, dur) {
  masterGainValue = target;
  if (masterFaded) return;
  queueMasterRamp(target, dur);
}

// Returns how long (ms) to wait before the native suspend
function fadeMasterOut() {
  if (masterFaded) return 0;
  masterFaded = true;
  const secs = queueMasterRamp(0, PAUSE_FADE_SEC);
  return secs * 1000 + 10;
}

function fadeMasterIn() {
  if (!masterFaded) return;
  masterFaded = false;
  queueMasterRamp(masterGainValue, START_FADE_SEC);
}

// ── Interruptions / route changes (calls, Siri, AirPods) ────
// 0.6.5 stops AVAudioEngine on interruption and on engine configuration
// changes but never restarts it, and the JS context keeps reporting
// 'running' (so the old watchdog's resume() was a no-op): audio went dead
// with the UI still showing "playing" until the user toggled play twice.
function observeSystemAudioEvents() {
  if (interruptionSubs.length > 0) return;
  try {
    AudioManager.observeAudioInterruptions(true);
    interruptionSubs.push(AudioManager.addSystemEventListener('interruption', (e) => {
      if (!e || e.type !== 'began') return;
      // Behave like a pause: the UI shows paused, play restarts cleanly
      // (and resume() then genuinely restarts the engine).
      if (getState().ui.playing) {
        pauseAudio();
        // Same as a user pause: stopped ⇒ canvas shows the edited bar
        updateState(s => { s.ui.playing = false; s.activeSceneIndex = s.ui.panelSceneIndex; });
      }
    }));
    interruptionSubs.push(AudioManager.addSystemEventListener('routeChange', () => {
      // AirPods in/out, BT car kit, etc. If the engine stopped on the
      // configuration change, restart it.
      if (!getState().ui.playing || !audioContext) return;
      const before = audioContext.currentTime;
      setTimeout(() => {
        try {
          if (getState().ui.playing && audioContext && audioContext.currentTime === before && transport) {
            transport.kick();
          }
        } catch (err) {}
      }, ROUTE_CHECK_MS);
    }));
  } catch (e) {
    if (__DEV__) console.warn('[audio] system event observers unavailable:', e?.message || e);
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
function onSchedulerTick(scheduleFrom, scheduleTo, transportStart, cycleDur, now) {
  try {
    const state = getState();
    if (!state || !state.scenes || state.scenes.length === 0) return;
    if (!cycleDur || cycleDur <= 0) return;

    const events = collectWindowEvents({
      scenes: state.scenes,
      sceneForCycle: sceneProvider || (() => state.activeSceneIndex),
      transportStart, cycleDur,
      from: scheduleFrom, to: scheduleTo,
      minEventSpacing: AUDIO.minEventSpacing,
    });
    if (events.length === 0) return;

    const plan = planTick(events, isFinite(now) ? now : scheduleFrom, {
      softCap: NOTES_PER_TICK_SOFT,
      hardCap: NOTES_PER_TICK_HARD,
      horizon: DEFER_HORIZON_SEC,
    });

    for (const ev of plan.schedule) {
      const shape = ev.shape;
      const synth = ensureSynth(shape);
      if (!synth) continue;
      // Per-shape volume lives on the channel strip — velocity only here
      const vel = velocityToGain(ev.stepData.velocity || 85);
      const dur = getNoteDuration(shape);
      scheduleVoice(shape, synth, ev.stepData, vel, dur, ev.time, ev.vertexIndex);
      if (ev.subIndex === 0 && onNoteTriggered) {
        // ev.time = exact scheduled audio-clock time of this note
        try { onNoteTriggered(shape, ev.vertexIndex, ev.time); } catch (e) {}
      }
    }
    if (__DEV__ && plan.dropped > 0) console.warn('[audio] note burst over hard cap — dropped', plan.dropped);
    // Partial window → the scheduler resumes exactly at the first deferred event
    return plan.resumeAt != null ? plan.resumeAt : undefined;
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
    let maxBoostDb = 0;
    for (const sh of shapes) {
      const fx = getShapeFx(sh);
      sendEnergy += Math.max(0, fx.echoSend) + Math.max(0, fx.verbSend);
      const boost = (Math.max(0, fx.eqLow) + Math.max(0, fx.eqMid) + Math.max(0, fx.eqHigh)) * 12;
      if (boost > maxBoostDb) maxBoostDb = boost;
    }
    const m = getMasterFx();
    maxBoostDb += (Math.max(0, m.eqLow) + Math.max(0, m.eqMid) + Math.max(0, m.eqHigh)) * 12;
    const sendHeadroom = 1 / (1 + 0.35 * (sendEnergy / count));
    // Half-compensate positive EQ boosts: +12dB of boost still sounds
    // boosted (+6dB louder) but can no longer slam the output into clipping
    const eqHeadroom = Math.pow(10, -Math.min(30, maxBoostDb) / 40);
    return (0.7 / Math.sqrt(count)) * userVol * sendHeadroom * eqHeadroom;
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
  // EQ boosts feed the headroom calculation — keep the master target fresh
  if (patch.eqLow !== undefined || patch.eqMid !== undefined || patch.eqHigh !== undefined) {
    rescheduleAll();
  }
}

// Update master fx in state and ramp the buses immediately
function setMasterFx(patch) {
  updateState(s => {
    s.effects = { ...makeDefaultMasterFx(), ...(s.effects || {}), ...patch };
  });
  applyMasterFx();
  // Volume and EQ boosts both feed the master gain target
  if (patch.volume !== undefined || patch.eqLow !== undefined ||
      patch.eqMid !== undefined || patch.eqHigh !== undefined) {
    rescheduleAll();
  }
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
      // Note: cancelScheduledValues crashes on react-native-audio-api 0.6.5
      // (native null deref in ParamChangeEvent deque). Ramps are queued
      // after the last queued master event instead (see queueMasterRamp).
      if (Math.abs(target - masterGainValue) < 1e-4) return; // idempotent
      setMasterTarget(target, 0.05);
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
      if (!isFinite(target) || target < 0) return;
      if (!masterFaded) queueMasterRamp(masterGainValue * 0.6, 0.02);
      setMasterTarget(target, 0.08);
    } catch (e) {}
  }
}

// ── Pause / Resume ──────────────────────────────────────────
// Pause: stop scheduling, fade the master out, then (after the fade) kill
// every queued voice and suspend — all serialized through `transport`.
function pauseAudio() {
  if (!audioInitialized || !scheduler) return;
  scheduler.stop();
  if (transport) transport.request('suspended', 'pause');
}

function resumeAudio() {
  if (!audioInitialized || !scheduler) return;
  if (transport) transport.request('running');
  fadeMasterIn();
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

// Clock-hand transport: ONE currentTime read per frame, smoothed between
// render callbacks (see clockSmoother.js) so the hand moves continuously
// and lands on each dot exactly when its note is scheduled.
// Returns { loop, elapsed } in seconds, or null when not playing.
function getVisualTransport(hostNowMs) {
  if (!audioInitialized || !scheduler || !scheduler.isRunning()) return null;
  const t = clockSmoother.sample(audioContext.currentTime, hostNowMs);
  return { loop: scheduler.getLoopPosition(t), elapsed: scheduler.getElapsed(t) };
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
  getCycleDuration, ensureSynth, setNoteCallback, setSceneProvider, getAudioContext, getVisualTransport,
  setShapeFx, setMasterFx, applyMasterFx,
};
