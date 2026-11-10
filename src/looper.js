// Per-layer looper — pure (no React / RN imports, Node-tested).
//
// MODEL
//   bar        = one scene slot (state.scenes[b], b = 0..MAX_SCENES-1).
//   layer      = one instrument/shape. A layer keeps the SAME shape id in
//                every bar (state.layerOrder lists the ids, bottom → top).
//   song       = bars 0..songLength-1 (state.enabledSlots is a contiguous
//                prefix of `true`s; the sequencer plays them in order).
//
//   Each layer owns its looping rules in state.layerLoops[id]:
//     loopLength  — the layer's base phrase is bars 0..loopLength-1
//     unique[b]   — bar b holds the layer's OWN pattern (an edit/override)
//   Every other bar REPEATS the phrase: bar b plays bar (b % loopLength).
//
//   state.scenes is a fully materialized cache: every bar holds a copy of
//   every layer, so the audio engine, canvas and exports read scenes as-is.
//   syncLayer() rewrites the repeat bars from their source after a change.
//
// RULES (owner spec)
//   - Editing a bar that is a repeat turns that bar (only) into a unique
//     override; bars before AND after keep repeating the phrase. Editing a
//     phrase bar (b < loopLength) changes every bar that repeats it, but
//     never a unique override.
//   - Layers are independent: no operation on one layer's loop touches
//     another layer's loop or content.
//   - A new layer copies the loop rules (loopLength + which bars are unique)
//     of the layer directly below it, then is fully disconnected.
//   - Layer-wide properties (instrument, volume, fx, color) are the same in
//     every bar of a layer; the pattern (sides, subdivision, notes) is per bar.
import { MAX_SCENES } from './constants.js';

export const LAYER_FIELDS = ['timbre', 'volume', 'fx', 'colorIndex'];

const clone = (o) => JSON.parse(JSON.stringify(o));

function barCount(state) {
  return (state.scenes && state.scenes.length) || MAX_SCENES;
}

export function songLength(state) {
  const en = state.enabledSlots;
  if (!Array.isArray(en)) return 1;
  let n = 0;
  for (let i = 0; i < en.length; i++) if (en[i]) n = i + 1;
  return Math.max(1, n);
}

function setSongLength(state, n) {
  const total = barCount(state);
  n = Math.max(1, Math.min(total, n));
  state.enabledSlots = Array.from({ length: total }, (_, i) => i < n);
}

function makeLoop(loopLength = 1, unique = null, total = MAX_SCENES) {
  const u = Array.from({ length: total }, (_, i) => !!(unique && unique[i]));
  const L = Math.max(1, Math.min(total, loopLength | 0 || 1));
  for (let i = 0; i < L; i++) u[i] = true;
  return { loopLength: L, unique: u };
}

export function getLoop(state, id) {
  return state.layerLoops && state.layerLoops[id];
}

// Which bar does `bar` of layer `id` take its pattern from?
export function sourceBar(loop, bar) {
  if (!loop) return 0;
  if (loop.unique[bar]) return bar;
  return bar % loop.loopLength;
}

export function isUnique(state, id, bar) {
  const loop = getLoop(state, id);
  return !!(loop && loop.unique[bar]);
}

function findShape(scene, id) {
  return scene && scene.shapes ? scene.shapes.find(s => s.id === id) : undefined;
}

// Rebuild every bar's shape list from the layer order + loop rules.
// Unique bars keep their own object (or absence); repeat bars get a fresh
// copy of their source. Scene objects are replaced so React selectors see
// new references for any bar whose content changed.
export function syncLayers(state, ids = null) {
  const order = state.layerOrder || [];
  const total = barCount(state);
  const only = ids ? new Set(ids) : null;
  for (let b = 0; b < total; b++) {
    const scene = state.scenes[b] || { shapes: [] };
    const next = [];
    for (const id of order) {
      const loop = getLoop(state, id);
      if (!loop) continue;
      const existing = findShape(scene, id);
      if (only && !only.has(id)) { if (existing) next.push(existing); continue; }
      const src = sourceBar(loop, b);
      if (src === b) { if (existing) next.push(existing); continue; }
      const from = findShape(state.scenes[src], id);
      if (from) next.push(clone(from));
    }
    // Shapes written outside the looper (not in layerOrder) are kept where
    // they are rather than silently dropped; normalizeLoops adopts them.
    const known = new Set(order);
    for (const sh of scene.shapes || []) if (sh && !known.has(sh.id)) next.push(sh);
    state.scenes[b] = { ...scene, shapes: next };
  }
}

// Copy the layer-wide fields of `shape` onto every bar's copy of its layer
export function propagateLayerFields(state, id, fromShape) {
  for (let b = 0; b < barCount(state); b++) {
    const sh = findShape(state.scenes[b], id);
    if (!sh || sh === fromShape) continue;
    for (const f of LAYER_FIELDS) {
      if (fromShape[f] !== undefined) sh[f] = clone(fromShape[f]);
    }
  }
}

// Edit ONE bar of ONE layer. Materializes a repeat bar into a unique
// override first, so the edit lands only there. fn(shape) mutates the shape.
export function editLayerBar(state, bar, id, fn) {
  const loop = getLoop(state, id);
  const scene = state.scenes[bar];
  if (!loop || !scene) return false;
  let sh = findShape(scene, id);
  if (!sh) return false; // layer absent in this bar (legacy data)
  if (!loop.unique[bar]) {
    // Freeze the repeat as this bar's own copy before editing
    loop.unique[bar] = true;
    sh = clone(sh);
    scene.shapes = scene.shapes.map(s => (s.id === id ? sh : s));
  }
  fn(sh);
  propagateLayerFields(state, id, sh);
  syncLayers(state, [id]);
  return true;
}

// Apply fn to the layer in EVERY bar (instrument change, volume, fx, scale
// snap). Never changes which bars are unique.
export function editLayerAll(state, id, fn) {
  let any = false;
  for (let b = 0; b < barCount(state); b++) {
    const sh = findShape(state.scenes[b], id);
    if (sh) { fn(sh, b); any = true; }
  }
  return any;
}

// Add a new layer (shape template; must carry a fresh id). Its loop rules
// are COPIED from the layer directly below it (the previous layer in
// layerOrder); after that the two loops are independent objects.
export function addLayer(state, shape) {
  if (!state.layerOrder) state.layerOrder = [];
  if (!state.layerLoops) state.layerLoops = {};
  const total = barCount(state);
  const belowId = state.layerOrder[state.layerOrder.length - 1];
  const below = belowId ? getLoop(state, belowId) : null;
  state.layerLoops[shape.id] = below
    ? makeLoop(below.loopLength, below.unique, total)
    : makeLoop(1, null, total);
  state.layerOrder.push(shape.id);
  const loop = state.layerLoops[shape.id];
  for (let b = 0; b < total; b++) {
    if (loop.unique[b]) {
      const scene = state.scenes[b] || (state.scenes[b] = { shapes: [] });
      scene.shapes = [...(scene.shapes || []), clone(shape)];
    }
  }
  syncLayers(state, [shape.id]);
}

export function removeLayer(state, id) {
  state.layerOrder = (state.layerOrder || []).filter(x => x !== id);
  if (state.layerLoops) delete state.layerLoops[id];
  for (let b = 0; b < barCount(state); b++) {
    const scene = state.scenes[b];
    if (scene && scene.shapes) state.scenes[b] = { ...scene, shapes: scene.shapes.filter(s => s.id !== id) };
  }
}

// Drop the layer's override on `bar` — it goes back to repeating the phrase.
export function revertBar(state, id, bar) {
  const loop = getLoop(state, id);
  if (!loop || bar < loop.loopLength || !loop.unique[bar]) return false;
  loop.unique[bar] = false;
  syncLayers(state, [id]);
  return true;
}

// Change the layer's phrase length. Bars entering the phrase keep what they
// currently play (frozen as unique); bars leaving it stay as overrides, so
// nothing the user hears in those bars changes — only the repeats follow
// the new phrase. Grows the song if the phrase would not fit.
export function setLoopLength(state, id, n) {
  const loop = getLoop(state, id);
  if (!loop) return false;
  const total = barCount(state);
  n = Math.max(1, Math.min(total, n | 0));
  if (n === loop.loopLength) return false;
  for (let b = 0; b < n; b++) loop.unique[b] = true; // current content frozen in place
  loop.loopLength = n;
  if (songLength(state) < n) setSongLength(state, n);
  syncLayers(state, [id]);
  return true;
}

// ── Song (bar strip) ────────────────────────────────────────
export function extendSongTo(state, bar) {
  if (bar + 1 > songLength(state)) setSongLength(state, bar + 1);
}

// The last bar can be removed when no layer has its own pattern there.
export function canShrinkSong(state) {
  const n = songLength(state);
  if (n <= 1) return false;
  const last = n - 1;
  return !(state.layerOrder || []).some(id => isUnique(state, id, last));
}

export function shrinkSong(state) {
  if (!canShrinkSong(state)) return false;
  setSongLength(state, songLength(state) - 1);
  return true;
}

// The bars to export / render, in play order
export function songScenes(state) {
  if (!state || !state.scenes) return [];
  if (!Array.isArray(state.enabledSlots)) {
    return state.scenes.filter(sc => sc.shapes && sc.shapes.length > 0);
  }
  return state.scenes.slice(0, songLength(state)).filter(sc => sc.shapes && sc.shapes.length > 0);
}

// For the UI: per-bar status of one layer
//   'unique'  — own pattern (phrase bar or override)
//   'repeat'  — repeats bar `source`
export function barStatus(state, id, bar) {
  const loop = getLoop(state, id);
  if (!loop) return { kind: 'none', source: bar, inPhrase: false };
  const src = sourceBar(loop, bar);
  return { kind: src === bar ? 'unique' : 'repeat', source: src, inPhrase: bar < loop.loopLength };
}

// ── Normalization / migration ───────────────────────────────
// Brings any state (fresh, legacy whole-scene projects, or current format)
// to the per-layer model and re-materializes the cache.
//
// Legacy (no layerLoops): scenes were whole-scene snapshots with their own
// shape ids and enabledSlots marked the edited scenes. Layers are aligned
// by position (shape i of every scene = layer i); every enabled scene
// becomes a unique bar of every layer; the first contiguous run of enabled
// slots becomes the phrase (loopLength). Matches the old playback order for
// bars up to the last enabled slot except after a gap following a 2nd
// phrase (old: repeated the 2nd phrase, new: repeats the 1st).
export function normalizeLoops(state) {
  if (!state || !Array.isArray(state.scenes)) return state;
  const total = state.scenes.length || MAX_SCENES;
  for (let b = 0; b < total; b++) {
    if (!state.scenes[b] || !Array.isArray(state.scenes[b].shapes)) state.scenes[b] = { shapes: [] };
  }
  const en = Array.isArray(state.enabledSlots) ? state.enabledSlots : [true];

  if (!state.layerLoops || !Array.isArray(state.layerOrder)) {
    const enabled = Array.from({ length: total }, (_, i) => i === 0 || !!en[i]);
    let phrase = 0;
    while (phrase < total && enabled[phrase]) phrase++;
    const maxLayers = Math.max(0, ...state.scenes.map((sc, i) => (enabled[i] ? sc.shapes.length : 0)));
    const order = [];
    const loops = {};
    for (let li = 0; li < maxLayers; li++) {
      let id = null;
      for (let b = 0; b < total && !id; b++) if (enabled[b] && state.scenes[b].shapes[li]) id = state.scenes[b].shapes[li].id;
      if (!id || order.includes(id)) id = 'layer-' + li + '-' + Math.floor(Math.random() * 1e9);
      order.push(id);
      loops[id] = makeLoop(phrase, enabled, total);
    }
    for (let b = 0; b < total; b++) {
      const sc = state.scenes[b];
      if (!enabled[b]) { state.scenes[b] = { ...sc, shapes: [] }; continue; }
      state.scenes[b] = {
        ...sc,
        shapes: sc.shapes.slice(0, maxLayers).map((sh, li) => ({ ...sh, id: order[li] })),
      };
    }
    // Layer-wide fields come from each layer's first appearance
    for (const id of order) {
      for (let b = 0; b < total; b++) {
        const sh = findShape(state.scenes[b], id);
        if (sh) { propagateLayerFields(state, id, sh); break; }
      }
    }
    state.layerOrder = order;
    state.layerLoops = loops;
    let last = 0;
    for (let i = 0; i < total; i++) if (enabled[i]) last = i;
    setSongLength(state, last + 1);
  } else {
    // Current format: repair invariants
    const seen = new Set();
    const order = [];
    for (const id of state.layerOrder) if (!seen.has(id)) { seen.add(id); order.push(id); }
    for (const sc of state.scenes) for (const sh of sc.shapes) if (sh && sh.id && !seen.has(sh.id)) { seen.add(sh.id); order.push(sh.id); }
    const loops = {};
    for (const id of order) {
      const l = state.layerLoops[id];
      loops[id] = makeLoop(l ? l.loopLength : 1, l ? l.unique : null, total);
    }
    state.layerOrder = order;
    state.layerLoops = loops;
    setSongLength(state, Math.max(songLength(state),
      ...order.map(id => loops[id].loopLength)));
  }
  syncLayers(state);
  return state;
}

// ── Bar-strip view model (pure; rendered by ui/SceneStrip.js) ──
// For every bar: is it in the song, and what is the SELECTED layer doing
// there (own pattern / repeat of bar N / part of its phrase)? Plus one
// marker per layer (in layer order) so every layer's looping is visible in
// its own color at a glance.
export function stripModel(state, selectedId) {
  const total = barCount(state);
  const len = songLength(state);
  const order = state.layerOrder || [];
  const colorOf = {};
  for (const sc of state.scenes || []) for (const sh of (sc && sc.shapes) || []) {
    if (colorOf[sh.id] === undefined) colorOf[sh.id] = sh.colorIndex || 0;
  }
  const sel = selectedId && getLoop(state, selectedId) ? selectedId : order[0];
  const bars = [];
  for (let b = 0; b < total; b++) {
    const st = barStatus(state, sel, b);
    bars.push({
      bar: b,
      inSong: b < len,
      kind: st.kind,
      source: st.source,
      inPhrase: st.inPhrase,
      layers: order.map(id => ({ id, colorIndex: colorOf[id] || 0, unique: isUnique(state, id, b) })),
    });
  }
  return {
    selectedId: sel || null,
    selectedColorIndex: sel ? (colorOf[sel] || 0) : 0,
    loopLength: sel && getLoop(state, sel) ? getLoop(state, sel).loopLength : 1,
    songLength: len,
    bars,
  };
}

// Stable primitive for React selectors: changes iff the strip would change
export function stripSignature(state, selectedId) {
  const m = stripModel(state, selectedId);
  return m.selectedId + '|' + m.selectedColorIndex + '|' + m.loopLength + '|' + m.songLength + '|' +
    m.bars.map(b => b.kind[0] + b.source + (b.layers.map(l => l.colorIndex + (l.unique ? 'u' : 'r')).join(''))).join(',');
}
