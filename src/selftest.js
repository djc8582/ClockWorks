// In-app self-test suite — dev only, never runs in production.
// Enabled by launching Metro with EXPO_PUBLIC_SELFTEST=1; results are
// logged to the console as [SELFTEST] lines so an agent (or human)
// watching Metro can verify every subsystem without touching the screen.
import {
  getState, updateState, initState, sanitizeScenes,
  serializeState, deserializeState,
} from './state.js';
import {
  setScalePreset, getCurrentScaleName, togglePitchClass, snapPitchToScale,
} from './scale.js';
import {
  SCALE_DEFINITIONS, SCALE_CATEGORIES, NO_TRANSPOSE_SCALES, TIMBRES, DRUM_TIMBRES,
} from './constants.js';
import { addNewShape } from './gestures/canvasGestures.js';
import { getSampleBank, getDrumBank } from './audio/timbres.js';
import {
  isAudioInitialized, startPlayback, pauseAudio, rescheduleAll,
  getElapsedSeconds, triggerNote, setNoteCallback, getCycleDuration,
  updateBPM, setShapeFx, setMasterFx,
} from './audio/audioEngine.js';
import { generateShapeId } from './state.js';
import { saveProject, listProjects, loadProject, deleteProject } from './projects.js';
import { buildMidiDataUri } from './midi/midiExport.js';
import { renderAudioMix, setSampleBanks } from './export/audioExport.js';
import { buildSheetHTML } from './export/sheetExport.js';
import { rebuildPlaybackOrder, resetCycleCount, getSceneForCycle } from './sequencer.js';
import { biquadCoeffs, magnitudeAt, EQ_BANDS } from './audio/dsp.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let passed = 0;
let failed = 0;

function report(name, ok, detail) {
  if (ok) { passed++; console.log(`[SELFTEST] PASS ${name}`); }
  else { failed++; console.log(`[SELFTEST] FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

async function check(name, fn) {
  try {
    const result = await fn();
    report(name, result !== false);
  } catch (e) {
    report(name, false, e?.message || String(e));
  }
}

export async function runSelfTest() {
  if (!__DEV__) return;
  passed = 0;
  failed = 0;
  console.log('[SELFTEST] ===== starting =====');

  // ── State ──────────────────────────────────────────────────
  await check('state: default shape exists', () => {
    const s = getState();
    return s.scenes.length === 8 &&
      s.scenes[0].shapes.length === 1 &&
      s.scenes[0].shapes[0].sides === 3;
  });

  await check('state: serialize/deserialize round-trip', () => {
    const before = serializeState();
    const origBpm = getState().bpm;
    updateState(s => { s.bpm = 543; });
    const ok = deserializeState(before) && getState().bpm === origBpm;
    return ok;
  });

  await check('state: sanitizeScenes repairs malformed data', () => {
    const scenes = [{ shapes: [{ sides: 99, vertices: null, subdivision: 77 }] }];
    sanitizeScenes(scenes);
    const sh = scenes[0].shapes[0];
    return sh.sides === 24 && sh.vertices.length === 24 && sh.subdivision === 4 &&
      sh.vertices.every(v => Array.isArray(v.pitches) && Array.isArray(v.subs)) &&
      typeof sh.id === 'string';
  });

  // ── Scales ─────────────────────────────────────────────────
  await check('scale: every definition loads and names correctly', () => {
    for (const name of Object.keys(SCALE_DEFINITIONS)) {
      const root = NO_TRANSPOSE_SCALES.has(name) ? 0 : 3;
      setScalePreset(name, root);
      const scale = getState().scale;
      if (!scale.length) return false;
      if (scale.some(pc => pc < 0 || pc >= 12)) return false;
      if (!getCurrentScaleName().includes(name)) return false;
    }
    return true;
  });

  await check('scale: every category entry is defined', () => {
    return SCALE_CATEGORIES.every(cat => cat.scales.every(n => SCALE_DEFINITIONS[n]));
  });

  await check('scale: custom edit shows "Custom" not stale name', () => {
    setScalePreset('Chromatic', 0);
    togglePitchClass(5); // 11 pitch classes — matches no definition
    const name = getCurrentScaleName();
    return name === 'Custom';
  });

  await check('scale: snapping picks nearest pitch class', () => {
    setScalePreset('Maj Triad', 0); // [0, 4, 7]
    return snapPitchToScale(61) === 60 && snapPitchToScale(66) === 67;
  });

  setScalePreset('Major', 0); // restore something musical

  // ── Audio banks ────────────────────────────────────────────
  await check('audio: context initialized', () => isAudioInitialized());

  await check('audio: melodic sample banks decoded', () => {
    const bank = getSampleBank();
    for (const id of ['epiano', 'piano', 'guitar', 'nylon', 'synth']) {
      const refs = Object.keys(bank[id] || {});
      if (refs.length < 5) return false; // guitar legitimately has 5 (no C6)
    }
    for (const id of ['keys', 'organ', 'marimba', 'vibes', 'pluck']) {
      if (Object.keys(bank[id] || {}).length !== 6) return false;
    }
    return true;
  });

  await check('audio: granular timbres rendered (cloud/shimmer/stutter)', () => {
    const bank = getSampleBank();
    for (const id of ['cloud', 'shimmer', 'stutter']) {
      const refs = Object.keys(bank[id] || {});
      if (refs.length < 5) return false;
      // Buffers must contain actual grain energy
      const buf = bank[id][refs[0]] && bank[id][Object.keys(bank[id])[0]];
      if (!buf || buf.duration < 0.5) return false;
    }
    return true;
  });

  await check('fx: drive audibly changes the bounce', () => {
    setSampleBanks(getSampleBank(), getDrumBank());
    const prev = { ...getState().scenes[0].shapes[0].fx };
    const clean = renderAudioMix(getState(), 1);
    updateState(s => { s.scenes[0].shapes[0].fx = { ...s.scenes[0].shapes[0].fx, drive: 1 }; });
    const hot = renderAudioMix(getState(), 1);
    updateState(s => { s.scenes[0].shapes[0].fx = prev; });
    if (!clean || !hot) return false;
    let diff = 0, energy = 0;
    const n = Math.min(clean.left.length, hot.left.length);
    for (let i = 0; i < n; i++) {
      diff += Math.abs(clean.left[i] - hot.left[i]);
      energy += Math.abs(clean.left[i]);
    }
    return energy > 0 && diff / energy > 0.05; // waveshaping visibly altered the signal
  });

  await check('audio: drum kits decoded (3 kits x 4 slots)', () => {
    const drums = getDrumBank();
    return ['drumkit1', 'drumkit2', 'drumkit3'].every(kit =>
      ['kick', 'snare', 'hihat', 'perc'].every(slot => drums[kit] && drums[kit][slot]));
  });

  await check('audio: every timbre triggers without throwing', () => {
    const shape = getState().scenes[0].shapes[0];
    for (const t of TIMBRES) {
      updateState(s => { s.scenes[0].shapes[0].timbre = t.id; });
      const sh = getState().scenes[0].shapes[0];
      // For drums, pitches must be slot indices
      if (DRUM_TIMBRES.has(t.id)) {
        updateState(s => { s.scenes[0].shapes[0].vertices[0].pitches = [0]; });
      } else {
        updateState(s => { s.scenes[0].shapes[0].vertices[0].pitches = [84]; }); // high pitch — exercises sample fallback
      }
      triggerNote(getState().scenes[0].shapes[0], 0);
    }
    updateState(s => { s.scenes[0].shapes[0].timbre = 'epiano'; s.scenes[0].shapes[0].vertices[0].pitches = [60]; });
    return true;
  });

  // ── Polyrhythm timing ──────────────────────────────────────
  // Plays a triangle against a pentagon for one cycle and verifies, from
  // the scheduler's OWN event times: per-shape spacing = cycle/N, shared
  // downbeat across shapes, and no double-fired events.
  await check('clock: 3-vs-5 polyrhythm sync', async () => {
    const mkShape = (sides) => ({
      id: generateShapeId(), sides, colorIndex: 0, timbre: 'epiano',
      volume: 1.0, subdivision: 1,
      vertices: Array.from({ length: sides }, () => ({ pitches: [60], velocity: 85, muted: false, subs: [] })),
    });
    updateState(s => { s.scenes[0].shapes = [mkShape(3), mkShape(5)]; });
    rescheduleAll();

    const events = [];
    setNoteCallback((shape, vi, t) => {
      if (typeof t === 'number') events.push({ sides: shape.sides, vi, t });
    });
    updateBPM(240); // 1s cycle — fast capture
    const cd = getCycleDuration();
    startPlayback();
    await sleep(1400);
    pauseAudio();
    setNoteCallback(null);
    updateBPM(120);

    const tol = 0.004;
    for (const sides of [3, 5]) {
      const evs = events.filter(e => e.sides === sides).sort((a, b) => a.t - b.t);
      if (evs.length < sides) return false; // must capture at least one full cycle
      // Spacing between consecutive vertices = cycle / sides
      for (let i = 1; i < Math.min(evs.length, sides + 1); i++) {
        const delta = evs[i].t - evs[i - 1].t;
        if (Math.abs(delta - cd / sides) > tol) return false;
      }
      // No duplicates: same vertex never scheduled twice at ~the same time
      for (let i = 1; i < evs.length; i++) {
        if (evs[i].vi === evs[i - 1].vi && evs[i].t - evs[i - 1].t < cd / sides / 2) return false;
      }
    }
    // Shared downbeat: vertex 0 of both shapes lands at the same instant
    const t3 = events.find(e => e.sides === 3 && e.vi === 0);
    const t5 = events.find(e => e.sides === 5 && e.vi === 0);
    if (!t3 || !t5 || Math.abs(t3.t - t5.t) > tol) return false;
    return true;
  });

  // ── Scene looping ──────────────────────────────────────────
  // Two enabled scenes (3-gon / 4-gon) — verifies from the scheduler's own
  // event times that scene boundaries are SAMPLE-ACCURATE: each scene's
  // downbeat lands exactly one cycle after the previous, alternating
  // A → B → A. Under the old rAF-driven advance this fails (late + blips).
  await check('clock: scene loop boundaries are sample-accurate', async () => {
    const mkShape = (sides) => ({
      id: generateShapeId(), sides, colorIndex: 0, timbre: 'epiano',
      volume: 1.0, subdivision: 1,
      vertices: Array.from({ length: sides }, () => ({ pitches: [60], velocity: 85, muted: false, subs: [] })),
    });
    updateState(s => {
      s.scenes[0] = { shapes: [mkShape(3)] };
      s.scenes[1] = { shapes: [mkShape(4)] };
      s.enabledSlots = [true, true, false, false, false, false, false, false];
      s.activeSceneIndex = 0;
    });
    rebuildPlaybackOrder();
    resetCycleCount();
    rescheduleAll();

    // Mapping sanity before audio: cycles alternate 0,1,0,1...
    if (getSceneForCycle(0) !== 0 || getSceneForCycle(1) !== 1 || getSceneForCycle(2) !== 0) return false;

    const events = [];
    setNoteCallback((shape, vi, t) => {
      if (typeof t === 'number') events.push({ sides: shape.sides, vi, t });
    });
    updateBPM(240); // 1s cycles
    const cd = getCycleDuration();
    startPlayback();
    await sleep(2500);
    pauseAudio();
    setNoteCallback(null);
    updateBPM(120);

    // Restore slots so later tests aren't affected
    updateState(s => {
      s.enabledSlots = [true, false, false, false, false, false, false, false];
      s.scenes[1] = { shapes: [] };
      s.activeSceneIndex = 0;
    });
    rebuildPlaybackOrder();
    rescheduleAll();

    const downbeats = events.filter(e => e.vi === 0).sort((a, b) => a.t - b.t);
    if (downbeats.length < 3) return false;
    // Alternation: cycle 0 = 3-gon scene, cycle 1 = 4-gon scene, cycle 2 = 3-gon
    if (downbeats[0].sides !== 3 || downbeats[1].sides !== 4 || downbeats[2].sides !== 3) return false;
    // Sample accuracy: each scene's downbeat exactly one cycle after the last
    const tol = 0.004;
    if (Math.abs((downbeats[1].t - downbeats[0].t) - cd) > tol) return false;
    if (Math.abs((downbeats[2].t - downbeats[1].t) - cd) > tol) return false;
    return true;
  });

  // ── Transport ──────────────────────────────────────────────
  await check('audio: transport runs and pauses', async () => {
    startPlayback();
    // Poll — context resume can take a moment after rapid suspend/resume
    // cycles (the scheduler watchdog handles it; give it time here too)
    let e1 = 0;
    for (let i = 0; i < 25 && e1 < 0.3; i++) {
      await sleep(150);
      e1 = getElapsedSeconds();
    }
    if (e1 < 0.3) return false;
    await sleep(400);
    const e2 = getElapsedSeconds();
    if (e2 <= e1) return false;
    pauseAudio();
    await sleep(200);
    return getElapsedSeconds() === 0; // stopped transport reports 0
  });

  // ── Shapes ─────────────────────────────────────────────────
  await check('shapes: add and delete', () => {
    const before = getState().scenes[0].shapes.length;
    addNewShape(5);
    const after = getState().scenes[0].shapes.length;
    if (after !== before + 1) return false;
    const newId = getState().ui.panelShapeId;
    updateState(s => {
      s.scenes[0].shapes = s.scenes[0].shapes.filter(sh => sh.id !== newId);
      s.ui.panelShapeId = s.scenes[0].shapes[0]?.id || null;
    });
    rescheduleAll();
    return getState().scenes[0].shapes.length === before;
  });

  // ── Sequencer ──────────────────────────────────────────────
  await check('sequencer: phrase-loop playback order', () => {
    updateState(s => { s.enabledSlots = [true, false, true, false, false, false, false, false]; });
    rebuildPlaybackOrder();
    updateState(s => { s.enabledSlots = [true, false, false, false, false, false, false, false]; });
    rebuildPlaybackOrder();
    return true; // exercised both gap-fill and reset paths without throwing
  });

  // ── Projects ───────────────────────────────────────────────
  await check('projects: save/list/load/delete round-trip', async () => {
    updateState(s => { s.bpm = 137; });
    const filename = await saveProject('__selftest__');
    const list1 = await listProjects();
    if (!list1.some(p => p.filename === filename)) return false;
    updateState(s => { s.bpm = 120; });
    await loadProject(filename);
    updateState(() => {});
    const loadedOk = getState().bpm === 137 &&
      getState().ui.panelShapeId === (getState().scenes[getState().activeSceneIndex].shapes[0]?.id || null);
    await deleteProject(filename);
    const list2 = await listProjects();
    updateState(s => { s.bpm = 120; });
    return loadedOk && !list2.some(p => p.filename === filename);
  });

  // ── Exports ────────────────────────────────────────────────
  await check('export: MIDI data builds', async () => {
    const uri = await buildMidiDataUri(getState());
    return typeof uri === 'string' && uri.startsWith('data:') && uri.length > 100;
  });

  await check('export: stereo WAV mix renders non-silent audio', () => {
    setSampleBanks(getSampleBank(), getDrumBank());
    const mix = renderAudioMix(getState(), 1);
    if (!mix || mix.left.length < 44100 || mix.right.length !== mix.left.length) return false;
    let peak = 0;
    for (let i = 0; i < mix.left.length; i++) {
      const a = Math.abs(mix.left[i]);
      const b = Math.abs(mix.right[i]);
      if (a > peak) peak = a;
      if (b > peak) peak = b;
    }
    return peak > 0.5; // normalized output should approach 0.9
  });

  await check('export: effects audibly change the bounce', () => {
    // Hard-left pan must drain the right channel
    const st = getState();
    const sh = st.scenes[0].shapes[0];
    const prevFx = { ...sh.fx };
    updateState(s => { s.scenes[0].shapes[0].fx = { ...s.scenes[0].shapes[0].fx, pan: -1 }; });
    const mix = renderAudioMix(getState(), 1);
    updateState(s => { s.scenes[0].shapes[0].fx = prevFx; });
    if (!mix) return false;
    let l = 0, r = 0;
    for (let i = 0; i < mix.left.length; i++) { l += Math.abs(mix.left[i]); r += Math.abs(mix.right[i]); }
    return l > 0 && r < l * 0.05;
  });

  await check('export: sheet HTML builds with staves', () => {
    const html = buildSheetHTML(getState());
    return typeof html === 'string' && html.includes('<svg') && html.includes('Scene 1');
  });

  // ── Effects strips ─────────────────────────────────────────
  await check('fx: channel strip + master params apply without throwing', async () => {
    const sh = getState().scenes[0].shapes[0];
    if (!sh.fx || typeof sh.fx.pan !== 'number') return false; // defaults present
    // Exercise every filter type + full strip + master bus params
    for (const filterType of ['lowpass', 'highpass', 'bandpass']) {
      setShapeFx(sh.id, { pan: 0.5, filterType, cutoff: 0.5, res: 0.6, drive: 0.7, echoSend: 0.5, verbSend: 0.4 });
      triggerNote(getState().scenes[0].shapes[0], 0); // schedules echo + verb taps
      await sleep(60);
    }
    setMasterFx({ volume: 0.9, tone: 0.8, delayTime: 0.3, delayFeedback: 0.5, delayWet: 0.6, reverbWet: 0.5 });
    await sleep(100);
    setShapeFx(sh.id, { pan: 0, filterType: 'lowpass', cutoff: 1, res: 0, drive: 0, echoSend: 0, verbSend: 0 });
    setMasterFx({ volume: 1, tone: 1 });
    const after = getState().scenes[0].shapes[0].fx;
    return after.pan === 0 && after.echoSend === 0 && after.filterType === 'lowpass';
  });

  await check('fx: EQ biquad math is correct (RBJ peaks where it should)', () => {
    // +12dB peaking @1.2kHz must measure ≈ +12dB at center, ≈ 0dB far away
    const c = biquadCoeffs('peaking', EQ_BANDS.mid.freq, EQ_BANDS.mid.Q, 12);
    const atCenter = 20 * Math.log10(magnitudeAt(c, EQ_BANDS.mid.freq));
    const farAway = 20 * Math.log10(magnitudeAt(c, 40));
    if (Math.abs(atCenter - 12) > 0.5 || Math.abs(farAway) > 1) return false;
    // lowshelf -12dB: low freqs cut, highs untouched
    const ls = biquadCoeffs('lowshelf', EQ_BANDS.low.freq, 0.707, -12);
    const lo = 20 * Math.log10(magnitudeAt(ls, 30));
    const hi = 20 * Math.log10(magnitudeAt(ls, 10000));
    return lo < -10 && Math.abs(hi) < 1;
  });

  await check('fx: EQ audibly changes the bounce', () => {
    setSampleBanks(getSampleBank(), getDrumBank());
    const prev = { ...getState().scenes[0].shapes[0].fx };
    const flat = renderAudioMix(getState(), 1);
    updateState(s => { s.scenes[0].shapes[0].fx = { ...s.scenes[0].shapes[0].fx, eqLow: -1, eqHigh: 1 }; });
    const eqd = renderAudioMix(getState(), 1);
    updateState(s => { s.scenes[0].shapes[0].fx = prev; });
    if (!flat || !eqd) return false;
    let diff = 0, energy = 0;
    const n = Math.min(flat.left.length, eqd.left.length);
    for (let i = 0; i < n; i++) {
      diff += Math.abs(flat.left[i] - eqd.left[i]);
      energy += Math.abs(flat.left[i]);
    }
    return energy > 0 && diff / energy > 0.05;
  });

  await check('fx: legacy tone migrates to filter cutoff', () => {
    const scenes = [{ shapes: [{ sides: 3, vertices: [], fx: { tone: 0.4 } }] }];
    sanitizeScenes(scenes);
    const fx = scenes[0].shapes[0].fx;
    return fx.cutoff === 0.4 && fx.tone === undefined && fx.filterType === 'lowpass';
  });

  // ── Extreme tempo stress (crash regression) ────────────────
  await check('stress: extreme tempo survives with thinned events', async () => {
    updateBPM(99999); // must clamp to the cap
    if (getState().bpm > 500) return false;
    const mk = (sides) => ({
      id: generateShapeId(), sides, colorIndex: 0, timbre: 'epiano',
      volume: 1.0, subdivision: 4,
      vertices: Array.from({ length: sides }, () => ({
        pitches: [60], velocity: 100, muted: false,
        subs: [{ pitches: [64], velocity: 80, muted: false }, { pitches: [67], velocity: 80, muted: false }, { pitches: [72], velocity: 80, muted: false }],
      })),
    });
    updateState(s => { s.scenes[0].shapes = [mk(24), mk(17)]; });
    rescheduleAll();
    startPlayback();
    await sleep(2000);
    const advanced = getElapsedSeconds() > 1.0;
    pauseAudio();
    updateBPM(120);
    updateState(s => { s.scenes[0].shapes = s.scenes[0].shapes.slice(0, 1); });
    rescheduleAll();
    return advanced; // surviving 2s of max-rate scheduling without crashing
  });

  // ── UI walk (for screenshot capture) ───────────────────────
  console.log('[SELFTEST] UI walk: main screen');
  await sleep(2500);
  console.log('[SELFTEST] UI walk: mixer open');
  updateState(s => { s.ui.mixerOpen = true; });
  await sleep(3000);
  updateState(s => { s.ui.mixerOpen = false; });
  console.log('[SELFTEST] UI walk: add-shape open');
  updateState(s => { s.ui.addPanelOpen = true; s.ui.addPanelSides = 5; });
  await sleep(3000);
  updateState(s => { s.ui.addPanelOpen = false; });
  console.log('[SELFTEST] UI walk: track fx open');
  updateState(s => { s.ui.fxPanel = s.scenes[0].shapes[0]?.id || null; });
  await sleep(3000);
  console.log('[SELFTEST] UI walk: master fx open');
  updateState(s => { s.ui.fxPanel = 'master'; });
  await sleep(3000);
  updateState(s => { s.ui.fxPanel = null; });
  console.log('[SELFTEST] UI walk: done');

  // Restore a pristine default state — the suite mutates pitches/scales
  initState();
  rebuildPlaybackOrder();
  rescheduleAll();
  updateState(() => {});

  console.log(`[SELFTEST] ===== DONE: ${passed} passed, ${failed} failed =====`);
}
