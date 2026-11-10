import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import {
  normalizeLoops, editLayerBar, editLayerAll, addLayer, removeLayer, revertBar,
  setLoopLength, barStatus, songLength, extendSongTo, shrinkSong, canShrinkSong, songScenes,
} from '../src/looper.js';
import { createDefaultState } from '../src/state.js';
import { collectWindowEvents } from '../src/audio/eventWindow.js';

function shape(id, pitch, extra = {}) {
  return {
    id, sides: 2, subdivision: 1, colorIndex: 0, timbre: 'epiano', volume: 1, fx: {},
    vertices: [{ pitches: [pitch], velocity: 90, muted: false, subs: [] }, { pitches: [pitch], velocity: 90, muted: false, subs: [] }],
    ...extra,
  };
}

// Fresh project: one layer with a 1-bar pattern, song of 4 bars
function fresh(nBars = 4) {
  const st = { scenes: Array.from({ length: 8 }, () => ({ shapes: [] })), layerOrder: [], layerLoops: {}, enabledSlots: [true] };
  addLayer(st, shape('A', 60));
  extendSongTo(st, nBars - 1);
  return st;
}
const pitchAt = (st, bar, id) => st.scenes[bar].shapes.find(s => s.id === id)?.vertices[0].pitches[0];
const pitches = (st, id, n = 8) => Array.from({ length: n }, (_, b) => pitchAt(st, b, id));
const setPitch = (p) => (sh) => { sh.vertices[0].pitches = [p]; };

test('1-bar loop: an edit on bar 4 changes ONLY bar 4', () => {
  const st = fresh(4);
  assert.deepEqual(pitches(st, 'A'), [60, 60, 60, 60, 60, 60, 60, 60]);
  editLayerBar(st, 3, 'A', setPitch(72));
  assert.deepEqual(pitches(st, 'A'), [60, 60, 60, 72, 60, 60, 60, 60]);
  assert.equal(barStatus(st, 'A', 3).kind, 'unique');
  assert.equal(barStatus(st, 'A', 1).kind, 'repeat');
  assert.equal(barStatus(st, 'A', 4).kind, 'repeat', 'bars after the edit keep looping the original');
});

test('editing the phrase (bar 1) updates repeats but never an override', () => {
  const st = fresh(8);
  editLayerBar(st, 3, 'A', setPitch(72));
  editLayerBar(st, 0, 'A', setPitch(55));
  assert.deepEqual(pitches(st, 'A'), [55, 55, 55, 72, 55, 55, 55, 55]);
});

test('a second edit of an override bar stays on that bar', () => {
  const st = fresh(4);
  editLayerBar(st, 3, 'A', setPitch(72));
  editLayerBar(st, 3, 'A', setPitch(74));
  assert.deepEqual(pitches(st, 'A', 4), [60, 60, 60, 74]);
});

test('repeat copies are independent objects (no aliasing between bars)', () => {
  const st = fresh(4);
  st.scenes[2].shapes[0].vertices[0].pitches.push(99); // a stray direct mutation
  assert.deepEqual(pitches(st, 'A', 4), [60, 60, 60, 60]);
  assert.notEqual(st.scenes[1].shapes[0], st.scenes[2].shapes[0]);
});

test('layers loop independently: editing one never touches another', () => {
  const st = fresh(4);
  addLayer(st, shape('B', 48));
  editLayerBar(st, 3, 'A', setPitch(72));
  assert.deepEqual(pitches(st, 'B', 4), [48, 48, 48, 48]);
  assert.equal(barStatus(st, 'B', 3).kind, 'repeat');
  editLayerBar(st, 1, 'B', setPitch(50));
  assert.deepEqual(pitches(st, 'A', 4), [60, 60, 60, 72]);
  assert.equal(barStatus(st, 'A', 1).kind, 'repeat');
});

test('new layer copies the loop rules of the layer below, then is disconnected', () => {
  const st = fresh(8);
  setLoopLength(st, 'A', 2);
  editLayerBar(st, 5, 'A', setPitch(70));
  addLayer(st, shape('B', 48));
  const ruleA = st.layerLoops.A, ruleB = st.layerLoops.B;
  assert.equal(ruleB.loopLength, 2);
  assert.deepEqual(ruleB.unique, ruleA.unique);
  assert.notEqual(ruleB, ruleA);
  assert.notEqual(ruleB.unique, ruleA.unique);
  // Disconnected afterwards — both directions
  editLayerBar(st, 3, 'B', setPitch(52));
  assert.equal(barStatus(st, 'A', 3).kind, 'repeat');
  setLoopLength(st, 'A', 4);
  assert.equal(st.layerLoops.B.loopLength, 2);
  revertBar(st, 'A', 5);
  assert.equal(barStatus(st, 'B', 5).kind, 'unique');
  // The new layer's content is its own template, not a copy of the layer below
  assert.deepEqual(pitches(st, 'B', 3), [48, 48, 48]);
});

test('new layer copies from the layer DIRECTLY below (the latest one)', () => {
  const st = fresh(4);
  addLayer(st, shape('B', 48));
  editLayerBar(st, 2, 'B', setPitch(50));
  addLayer(st, shape('C', 40));
  assert.equal(barStatus(st, 'C', 2).kind, 'unique');
  assert.equal(barStatus(st, 'C', 3).kind, 'repeat');
  assert.deepEqual(pitches(st, 'C', 4), [40, 40, 40, 40]);
});

test('layer-wide fields (instrument/volume/fx) are shared by every bar of the layer', () => {
  const st = fresh(4);
  editLayerBar(st, 3, 'A', setPitch(72));
  editLayerBar(st, 3, 'A', (sh) => { sh.volume = 0.5; });
  for (let b = 0; b < 8; b++) assert.equal(st.scenes[b].shapes[0].volume, 0.5);
  editLayerAll(st, 'A', (sh) => { sh.timbre = 'organ'; });
  for (let b = 0; b < 8; b++) assert.equal(st.scenes[b].shapes[0].timbre, 'organ');
  assert.equal(barStatus(st, 'A', 1).kind, 'repeat', 'layer-wide edits do not create overrides');
});

test('phrase length > 1: repeats follow the phrase, an override is single-bar', () => {
  const st = fresh(8);
  setLoopLength(st, 'A', 2);
  editLayerBar(st, 1, 'A', setPitch(62));
  assert.deepEqual(pitches(st, 'A'), [60, 62, 60, 62, 60, 62, 60, 62]);
  editLayerBar(st, 4, 'A', setPitch(72));
  assert.deepEqual(pitches(st, 'A'), [60, 62, 60, 62, 72, 62, 60, 62]);
});

test('changing loop length keeps what phrase bars play; grows the song if needed', () => {
  const st = fresh(1);
  setLoopLength(st, 'A', 3);
  assert.equal(songLength(st), 3);
  assert.deepEqual(pitches(st, 'A', 3), [60, 60, 60]);
  editLayerBar(st, 2, 'A', setPitch(67));
  setLoopLength(st, 'A', 2); // bar 3 leaves the phrase but keeps its edit
  assert.deepEqual(pitches(st, 'A', 4), [60, 60, 67, 60]);
});

test('revert an override returns the bar to the loop', () => {
  const st = fresh(4);
  editLayerBar(st, 3, 'A', setPitch(72));
  assert.ok(revertBar(st, 'A', 3));
  assert.deepEqual(pitches(st, 'A', 4), [60, 60, 60, 60]);
  assert.equal(revertBar(st, 'A', 0), false, 'phrase bars cannot be reverted');
});

test('removing a layer leaves the others intact', () => {
  const st = fresh(4);
  addLayer(st, shape('B', 48));
  editLayerBar(st, 3, 'A', setPitch(72));
  removeLayer(st, 'B');
  for (let b = 0; b < 8; b++) assert.deepEqual(st.scenes[b].shapes.map(s => s.id), ['A']);
  assert.equal(st.layerLoops.B, undefined);
  assert.deepEqual(pitches(st, 'A', 4), [60, 60, 60, 72]);
});

test('song shrink is blocked while any layer owns the last bar', () => {
  const st = fresh(4);
  addLayer(st, shape('B', 48));
  editLayerBar(st, 3, 'B', setPitch(50));
  assert.equal(canShrinkSong(st), false);
  revertBar(st, 'B', 3);
  assert.ok(shrinkSong(st));
  assert.equal(songLength(st), 3);
  assert.equal(songScenes(st).length, 3);
});

test('legacy whole-scene project migrates to per-layer loops (stable ids, same playback)', () => {
  const st = {
    scenes: [
      { shapes: [shape('s0a', 60), shape('s0b', 48)] },
      { shapes: [shape('s1a', 62), shape('s1b', 50)] },
      { shapes: [] }, { shapes: [] },
      { shapes: [shape('s4a', 64), shape('s4b', 52)] },
      { shapes: [] }, { shapes: [] }, { shapes: [] },
    ],
    enabledSlots: [true, true, false, false, true, false, false, false],
  };
  normalizeLoops(st);
  assert.deepEqual(st.layerOrder, ['s0a', 's0b']);
  assert.equal(songLength(st), 5);
  // Old phrase order was [0,1,0,1,4]
  assert.deepEqual(pitches(st, 's0a', 5), [60, 62, 60, 62, 64]);
  assert.deepEqual(pitches(st, 's0b', 5), [48, 50, 48, 50, 52]);
  for (let b = 0; b < 8; b++) assert.deepEqual(st.scenes[b].shapes.map(s => s.id), ['s0a', 's0b']);
  assert.equal(st.layerLoops.s0a.loopLength, 2);
});

test('migration is idempotent and the default state is already per-layer', () => {
  const st = createDefaultState();
  assert.equal(st.layerOrder.length, 1);
  const id = st.layerOrder[0];
  for (let b = 0; b < 8; b++) assert.equal(st.scenes[b].shapes[0].id, id);
  assert.deepEqual(st.enabledSlots, [true, false, false, false, false, false, false, false]);
  const snap = JSON.stringify(st);
  normalizeLoops(st);
  assert.equal(JSON.stringify(st), snap);
});

test('the audio scheduler plays the per-bar edit only in its bar', () => {
  const st = fresh(4);
  editLayerBar(st, 3, 'A', setPitch(72));
  const n = songLength(st);
  const evs = [];
  for (let t = 0; t < 8; t += 0.5) {
    evs.push(...collectWindowEvents({
      scenes: st.scenes, sceneForCycle: (c) => c % n, transportStart: 0, cycleDur: 1, from: t, to: t + 0.5, minEventSpacing: 0,
    }));
  }
  const byCycle = {};
  for (const e of evs) if (e.vertexIndex === 0 && e.subIndex === 0) byCycle[e.cycle] = e.stepData.pitches[0];
  assert.deepEqual(Object.values(byCycle), [60, 60, 60, 72, 60, 60, 60, 72]);
});

test('strip model: selected layer status per bar + one colored marker per layer', async () => {
  const { stripModel, stripSignature } = await import('../src/looper.js');
  const st = fresh(4);
  addLayer(st, shape('B', 48, { colorIndex: 1 }));
  editLayerBar(st, 3, 'A', setPitch(72));
  const m = stripModel(st, 'A');
  assert.equal(m.songLength, 4);
  assert.deepEqual(m.bars.slice(0, 5).map(b => b.kind), ['unique', 'repeat', 'repeat', 'unique', 'repeat']);
  assert.equal(m.bars[2].source, 0);
  assert.deepEqual(m.bars[3].layers, [{ id: 'A', colorIndex: 0, unique: true }, { id: 'B', colorIndex: 1, unique: false }]);
  const mb = stripModel(st, 'B');
  assert.equal(mb.selectedColorIndex, 1);
  assert.equal(mb.bars[3].kind, 'repeat');
  const sig = stripSignature(st, 'A');
  editLayerBar(st, 2, 'B', setPitch(50));
  assert.notEqual(stripSignature(st, 'A'), sig, 'other layer markers are part of the signature');
  assert.equal(stripModel(st, 'gone').selectedId, 'A', 'stale selection falls back to the first layer');
});

test('shapes written outside the looper are not dropped by a sync', () => {
  const st = fresh(2);
  st.scenes[0].shapes.push(shape('X', 30));
  editLayerBar(st, 1, 'A', setPitch(61));
  assert.ok(st.scenes[0].shapes.some(s => s.id === 'X'));
  normalizeLoops(st);
  assert.ok(st.layerOrder.includes('X'));
});

test('MIDI export covers the song bars only (not the preview repeats)', async () => {
  const { buildMidiNotes } = await import('../src/midi/midiBuild.js');
  const st = fresh(3);
  editLayerBar(st, 2, 'A', setPitch(72));
  const { notes } = buildMidiNotes({ bpm: 120, ...st });
  const firsts = notes.filter(n => n.pitch === 72);
  assert.ok(firsts.length > 0, 'the bar-3 edit is exported');
  const bars = new Set(notes.map(n => Math.floor(n.tick / (128 * 4))));
  assert.ok(bars.size <= 3, 'no notes past bar 3: ' + [...bars]);
});
