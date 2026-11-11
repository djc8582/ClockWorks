import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import {
  cellWidth, cellHeight, scrollMin, clamp, rubber, unrubber, visibleRange, zoomAround, hitTest, offsetForRow,
} from '../src/ui/rollGeometry.js';
import { buildRollData, buildRows, focusRow, pitchLabel } from '../src/ui/rollData.js';

const geo = (o = {}) => ({ cols: 16, rows: 75, baseCellW: 333 / 16, baseCellH: 28, minCellW: 20, minCellH: 14,
  viewW: 333, viewH: 260, labelW: 42, headerH: 44, ...o });

test('scroll limits reach the last row and column exactly', () => {
  const g = geo();
  const lo = scrollMin(g, 1, 1);
  assert.equal(lo.y, 260 - 75 * 28);
  // the bottom of the last row sits on the bottom of the view
  assert.equal(-lo.y + g.viewH, g.rows * cellHeight(g, 1));
  // 16 columns at zoom 1 fit exactly; wider when zoomed
  assert.equal(lo.x, Math.min(0, 333 - 16 * Math.max(20, 333 / 16)));
  assert.ok(scrollMin(g, 2, 1).x < -300);
  // content smaller than the view never scrolls
  assert.deepEqual(scrollMin(geo({ rows: 4 }), 1, 1), { x: lo.x, y: 0 });
});

test('cells never get narrower or shorter than the minimum', () => {
  const g = geo({ cols: 96, baseCellW: 333 / 96 });
  assert.equal(cellWidth(g, 1), 20);
  assert.equal(cellHeight(g, 0.1), 14);
});

test('visible range covers exactly the rows in view', () => {
  assert.deepEqual(visibleRange(0, 28, 260, 75), { first: 0, last: 9 });
  assert.deepEqual(visibleRange(-28 * 10 - 5, 28, 260, 75), { first: 10, last: 19 });
  assert.deepEqual(visibleRange(-(75 * 28 - 260), 28, 260, 75).last, 74);
  assert.deepEqual(visibleRange(30, 28, 260, 75).first, 0); // overscrolled past the top
  assert.deepEqual(visibleRange(0, 28, 260, 0), { first: 0, last: -1 });
});

test('rubber band is continuous at the edge, bounded, and invertible', () => {
  assert.equal(rubber(-50, -100, 0, 60), -50);
  assert.ok(Math.abs(rubber(0.001, -100, 0, 60)) < 0.01);
  assert.ok(rubber(10000, -100, 0, 60) < 60);
  assert.ok(rubber(-10000, -100, 0, 60) > -160);
  for (const v of [-300, -130, -100, -20, 0, 15, 200]) {
    assert.ok(Math.abs(unrubber(rubber(v, -100, 0, 60), -100, 0, 60) - v) < 1e-6, String(v));
  }
});

test('zooming keeps the note under the fingers in place', () => {
  // focal at 100px in the view, content offset -50, cells grow 20 → 40
  const o = zoomAround(-50, 100, 100, 20, 40, -10000);
  // content point under the finger before: 100 + 50 = 150 → index 7.5 cells; after: 7.5*40 = 300 → offset 100-300
  assert.equal(o, -200);
  assert.equal(zoomAround(-50, 100, 100, 20, 40, -150), -150); // clamped to the limit
  assert.equal(zoomAround(0, 0, 0, 20, 10, -10000), 0);
});

test('hit testing maps a touch to the cell under it, at any scroll and zoom', () => {
  const g = geo();
  const cw = cellWidth(g, 1);
  assert.deepEqual(hitTest(g, 10, 10, 0, 0, 1, 1).region, 'corner');
  assert.deepEqual(hitTest(g, 42 + cw * 3 + 1, 20, 0, 0, 1, 1), { region: 'header', row: -1, col: 3 });
  assert.deepEqual(hitTest(g, 20, 44 + 28 * 2 + 1, 0, -28 * 10, 1, 1), { region: 'label', row: 12, col: -1 });
  const cw2 = cellWidth(g, 2);
  assert.deepEqual(hitTest(g, 42 + cw2 * 5 + 2, 44 + 56 * 4 + 2, -cw2 * 2, -56 * 3, 2, 2), { region: 'grid', row: 7, col: 7 });
  // past the content (overscrolled) is nothing
  assert.equal(hitTest(g, 100, 100, 0, 200, 1, 1).region, 'none');
});

test('focus offset puts the target row near the top and stays in range', () => {
  const g = geo();
  assert.equal(offsetForRow(g, 0, 1), 0);
  assert.equal(offsetForRow(g, 30, 1), -(30 * 28 - 84));
  assert.equal(offsetForRow(g, 74, 1), scrollMin(g, 1, 1).y);
});

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
function shapeOf(steps, sub = 1) {
  return {
    id: 's1', sides: steps.length, subdivision: sub,
    vertices: steps.map((p) => ({ pitches: p.pitches || [], muted: !!p.muted, velocity: p.velocity || 85, subs: p.subs })),
  };
}

test('roll data marks sounding and muted notes in the right cells', () => {
  const sh = shapeOf([{ pitches: [60] }, { pitches: [64], muted: true }, {}, { pitches: [60, 67], velocity: 127 }]);
  const d = buildRollData(sh, C_MAJOR, false, 1);
  const r60 = d.rowValues.indexOf(60), r64 = d.rowValues.indexOf(64), r67 = d.rowValues.indexOf(67);
  assert.equal(d.cells[r60 * d.cols + 0], 1);
  assert.equal(d.cells[r64 * d.cols + 1], 2);
  assert.equal(d.cells[r60 * d.cols + 3], 1);
  assert.equal(d.cells[r67 * d.cols + 3], 1);
  assert.equal(d.cells.filter(Boolean).length, 4);
  assert.equal(d.vel[3], 1);
  assert.equal(d.colMuted[1], 1);
  assert.equal(d.sel, 1);
  assert.equal(d.isC[r60], 1);
  assert.equal(d.labels[r60], 'C4');
});

test('subdivisions become extra columns with their own labels', () => {
  const sh = shapeOf([{ pitches: [60], subs: [{ pitches: [62] }, { pitches: [] , muted: true }] }, {}], 3);
  sh.vertices[1].subs = [{ pitches: [] }, { pitches: [] }];
  const d = buildRollData(sh, C_MAJOR, false, -1);
  assert.equal(d.cols, 6);
  assert.deepEqual(d.colLabels, ['1', '2', '3', '2', '2', '3']);
  assert.equal(d.cells[d.rowValues.indexOf(62) * 6 + 1], 1);
  assert.equal(d.colMuted[2], 1);
});

test('off-scale notes keep a row; microtonal pitches match their row', () => {
  const sh = shapeOf([{ pitches: [61] }, { pitches: [60.5] }]);
  const d = buildRollData(sh, C_MAJOR, false, -1);
  assert.ok(d.rowValues.includes(61));
  assert.equal(d.cells[d.rowValues.indexOf(61) * d.cols], 1);
  assert.equal(d.cells[d.rowValues.indexOf(60.5) * d.cols + 1], 1);
  assert.equal(pitchLabel(60.5), 'C#4-50¢');
  const rows = buildRows([0, 3.5, 7], shapeOf([{}]));
  assert.ok(rows.includes(63.5));
});

test('drum grid has one row per kit slot', () => {
  const sh = shapeOf([{ pitches: [0, 2] }, { pitches: [1], muted: true }]);
  const d = buildRollData(sh, C_MAJOR, true, -1);
  assert.equal(d.rows, 4);
  assert.deepEqual(d.labels, ['Kick', 'Snare', 'Hihat', 'Perc']);
  assert.equal(d.cells[0 * 2 + 0], 1);
  assert.equal(d.cells[2 * 2 + 0], 1);
  assert.equal(d.cells[1 * 2 + 1], 1);
});

test('a layer opens on its notes', () => {
  const sh = shapeOf([{ pitches: [72] }, { pitches: [76] }]);
  const rows = buildRows(C_MAJOR, sh);
  assert.equal(rows[focusRow(sh, rows)], 74);
  assert.equal(rows[focusRow(shapeOf([{}]), rows)], 60);
});
