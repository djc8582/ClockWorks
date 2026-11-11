// Pure: turns a shape + scale into the flat arrays the Skia roll draws.
// Rebuilt on the JS thread only when the pattern, scale, selection or color changes —
// never while scrolling or zooming. Node-tested (tests/roll.test.mjs).
import { PITCH, NOTE_NAMES, DRUM_SLOTS } from '../constants.js';

export function getStepData(vertex, stepIndex) {
  if (!vertex) return null;
  if (stepIndex === 0) return vertex;
  return (vertex.subs && vertex.subs[stepIndex - 1]) || null;
}

export function buildRows(scale, shape) {
  const rowSet = new Set();
  const hasFractional = scale.some(pc => pc !== Math.floor(pc));
  if (hasFractional) {
    const minOct = Math.floor(PITCH.min / 12);
    const maxOct = Math.floor(PITCH.max / 12);
    for (let oct = minOct; oct <= maxOct; oct++) {
      for (const pc of scale) {
        const pitch = Math.round((oct * 12 + pc) * 100) / 100;
        if (pitch >= PITCH.min && pitch <= PITCH.max) rowSet.add(pitch);
      }
    }
  } else {
    const scaleSet = new Set(scale);
    for (let p = PITCH.max; p >= PITCH.min; p--) {
      if (scaleSet.has(((p % 12) + 12) % 12)) rowSet.add(p);
    }
  }
  // Notes outside the scale keep a row so they stay visible and removable
  for (const v of shape.vertices) {
    if (v && v.pitches) for (const p of v.pitches) rowSet.add(p);
    if (v && v.subs) for (const sub of v.subs) {
      if (sub && sub.pitches) for (const p of sub.pitches) rowSet.add(p);
    }
  }
  return Array.from(rowSet).sort((a, b) => b - a);
}

export function pitchLabel(pitch) {
  const nearest = Math.round(pitch);
  const cents = Math.round((pitch - nearest) * 100);
  const name = NOTE_NAMES[((nearest % 12) + 12) % 12];
  const octave = Math.floor(nearest / 12 - 1);
  if (cents === 0) return name + octave;
  return name + octave + (cents > 0 ? '+' : '') + cents + '¢';
}

const isCPitch = (p) => Math.abs(((p % 12) + 12) % 12) < 0.01 || Math.abs(((p % 12) + 12) % 12 - 12) < 0.01;
const samePitch = (a, b) => Math.abs(a - b) < 0.01;

/**
 * cells[row * cols + col]: 0 empty, 1 sounding note, 2 muted note.
 * col = vertex * sub + step.
 */
export function buildRollData(shape, scale, drum, selectedNode) {
  const sub = shape.subdivision || 1;
  const sides = shape.sides;
  const cols = sides * sub;
  const rowValues = drum ? DRUM_SLOTS.map((_, i) => i) : buildRows(scale, shape);
  const rows = rowValues.length;
  const cells = new Array(rows * cols).fill(0);
  const vel = new Array(cols).fill(0);
  const colMuted = new Array(cols).fill(0);
  const colLabels = new Array(cols);
  const index = new Map(rowValues.map((p, i) => [drum ? p : Math.round(p * 100), i]));
  for (let vi = 0; vi < sides; vi++) {
    for (let s = 0; s < sub; s++) {
      const col = vi * sub + s;
      colLabels[col] = s === 0 ? String(vi + 1) : (drum ? '' : String(s + 1));
      const sd = getStepData(shape.vertices[vi], s);
      if (!sd) continue;
      vel[col] = Math.max(0, Math.min(1, (sd.velocity || 85) / 127));
      colMuted[col] = sd.muted ? 1 : 0;
      for (const p of sd.pitches || []) {
        const r = index.get(drum ? p : Math.round(p * 100));
        if (r === undefined) continue;
        cells[r * cols + col] = drum ? 1 : (sd.muted ? 2 : 1);
      }
    }
  }
  const labels = drum
    ? DRUM_SLOTS.map((n) => n.charAt(0).toUpperCase() + n.slice(1))
    : rowValues.map(pitchLabel);
  const isC = drum ? rowValues.map(() => 0) : rowValues.map((p) => (isCPitch(p) ? 1 : 0));
  return {
    drum: !!drum, sides, sub, cols, rows, rowValues, labels, isC, cells, vel, colMuted, colLabels,
    sel: typeof selectedNode === 'number' ? selectedNode : -1,
  };
}

/** Row to centre on when a layer opens: the middle of its notes, or middle C. */
export function focusRow(shape, rowValues) {
  let sum = 0, count = 0;
  for (const v of shape.vertices) {
    if (v && v.pitches) for (const p of v.pitches) { sum += p; count++; }
  }
  const mid = count > 0 ? sum / count : 60;
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < rowValues.length; i++) {
    const d = Math.abs(rowValues[i] - mid);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

export { samePitch };
