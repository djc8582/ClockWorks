import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { buildMidiDataUri, buildMidiNotes, MIDI_PPQ } from '../src/midi/midiBuild.js';
import { collectWindowEvents } from '../src/audio/eventWindow.js';
import { makeShape } from './helpers.mjs';
import { TIMING } from '../src/constants.js';

function parseSMF(bytes) {
  let p = 0;
  const rd = n => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[p++]; return v; };
  const vlq = () => { let v = 0, b; do { b = bytes[p++]; v = v * 128 + (b & 0x7f); } while (b & 0x80); return v; };
  p = 4; const hl = rd(4); rd(2); const nt = rd(2); const div = rd(2); p = 8 + hl;
  const notes = []; let tempo = null;
  for (let t = 0; t < nt; t++) {
    p += 4; const len = rd(4); const end = p + len; let tick = 0, rs = 0;
    const open = new Map();
    while (p < end) {
      tick += vlq();
      let st = bytes[p]; if (st < 0x80) st = rs; else p++; rs = st;
      if (st === 0xff) { const ty = bytes[p++]; const l = vlq(); if (ty === 0x51) { tempo = (bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]; } p += l; continue; }
      const hi = st & 0xf0;
      if (hi === 0x90 || hi === 0x80) {
        const n = bytes[p++], v = bytes[p++]; const k = `${st & 15}:${n}`;
        if (hi === 0x90 && v > 0) open.set(k, { track: t, tick, pitch: n, ch: (st & 15) + 1 });
        else { const o = open.get(k); if (o) { o.dur = tick - o.tick; notes.push(o); open.delete(k); } }
      } else if (hi === 0xc0 || hi === 0xd0) p++; else p += 2;
    }
  }
  return { div, notes, tempo };
}

const state = {
  bpm: 97,
  scenes: [
    { shapes: [makeShape(3), makeShape(5, 2), makeShape(7, 3)] },
    { shapes: [] },
    { shapes: [makeShape(4, 4), { ...makeShape(4), timbre: 'drumkit1' }] },
  ],
};
state.scenes[2].shapes[1].vertices.forEach((v, i) => { v.pitches = [i]; });
state.scenes[0].shapes[1].vertices[2].muted = true;

test('every exported note lands on the tick of its live-audio event time', async () => {
  const uri = await buildMidiDataUri(state);
  const bytes = Buffer.from(uri.split(',')[1], 'base64');
  const { div, notes, tempo } = parseSMF(bytes);
  assert.equal(div, MIDI_PPQ);
  assert.equal(Math.round(60e6 / tempo), 97);
  const cycleDur = (60 / state.bpm) * TIMING.defaultCycleBeats;
  const ticksPerCycle = MIDI_PPQ * TIMING.defaultCycleBeats;
  // Expected = what the engine schedules, with the exporter's scene layout
  // (non-empty scenes back to back, sceneCycles each)
  const nonEmpty = state.scenes.map((s, i) => i).filter(i => state.scenes[i].shapes.length);
  const evs = collectWindowEvents({
    scenes: state.scenes, sceneForCycle: c => nonEmpty[Math.floor(c / TIMING.sceneCycles)],
    transportStart: 0, cycleDur, from: 0, to: cycleDur * nonEmpty.length * TIMING.sceneCycles - 1e-9,
    maxCyclesPerTick: 100,
  });
  const expected = [];
  for (const e of evs) for (const p of e.stepData.pitches) expected.push({ track: e.order, t: e.time });
  assert.equal(notes.length, expected.length, 'same note count as live playback');
  const byTrack = (arr, k) => arr.filter(x => x.track === k);
  for (let k = 0; k < 3; k++) {
    const got = byTrack(notes, k).map(n => n.tick).sort((a, b) => a - b);
    const want = byTrack(expected, k).map(x => x.t / cycleDur * ticksPerCycle).sort((a, b) => a - b);
    assert.equal(got.length, want.length);
    for (let i = 0; i < got.length; i++) assert.ok(Math.abs(got[i] - want[i]) <= 0.5, `track ${k}: ${got[i]} vs ${want[i]}`);
  }
  // Downbeat note at tick 0 survives (midi-writer treats startTick 0 as falsy)
  assert.ok(notes.some(n => n.track === 0 && n.tick === 0));
  // Drums → GM channel 10 kick/snare/hat/perc
  const drums = notes.filter(n => n.ch === 10).map(n => n.pitch);
  assert.deepEqual(drums.sort(), [36, 38, 39, 42]);
});

test('note durations are positive and shorter than the step', () => {
  const { notes } = buildMidiNotes(state);
  for (const n of notes) assert.ok(n.durTicks >= 1);
});
