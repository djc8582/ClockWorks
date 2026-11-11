// Pure piano-roll geometry: sizes, scroll limits, visible window, hit testing.
// Every function is a worklet so the UI thread (gestures + Skia drawing) and the
// JS thread (tap handling) use the exact same math. Node-tested (tests/roll.test.mjs).

/** Width of one step column. */
export function cellWidth(g, zoomH) {
  'worklet';
  return Math.max(g.minCellW, g.baseCellW * zoomH);
}

/** Height of one row. */
export function cellHeight(g, zoomV) {
  'worklet';
  return Math.max(g.minCellH, g.baseCellH * zoomV);
}

/** Most negative scroll offsets (content scrolls left/up as offsets go negative). */
export function scrollMin(g, zoomH, zoomV) {
  'worklet';
  const contentW = g.cols * cellWidth(g, zoomH);
  const contentH = g.rows * cellHeight(g, zoomV);
  return {
    x: Math.min(0, g.viewW - contentW),
    y: Math.min(0, g.viewH - contentH),
  };
}

export function clamp(v, lo, hi) {
  'worklet';
  return v < lo ? lo : v > hi ? hi : v;
}

/** Offset with a soft edge: past the limit the content follows the finger at a fraction. */
export function rubber(v, lo, hi, reach) {
  'worklet';
  if (v > hi) return hi + reach * (1 - 1 / ((v - hi) / reach + 1));
  if (v < lo) return lo - reach * (1 - 1 / ((lo - v) / reach + 1));
  return v;
}

/** Inverse of rubber(): the raw finger offset that produces a displayed offset. */
export function unrubber(d, lo, hi, reach) {
  'worklet';
  if (d > hi) { const f = Math.min(0.999, (d - hi) / reach); return hi + reach * (1 / (1 - f) - 1); }
  if (d < lo) { const f = Math.min(0.999, (lo - d) / reach); return lo - reach * (1 / (1 - f) - 1); }
  return d;
}

/** First/last index (inclusive) of the rows or columns that intersect the view. */
export function visibleRange(offset, size, view, count) {
  'worklet';
  if (count <= 0 || size <= 0) return { first: 0, last: -1 };
  const first = Math.max(0, Math.floor(-offset / size));
  const last = Math.min(count - 1, Math.floor((-offset + view - 0.001) / size));
  return { first, last };
}

/**
 * New offset along one axis when zooming from z0 to z1 so the content under the
 * focal point (view coords) stays put, then clamped.
 */
export function zoomAround(offset0, focal0, focalNow, size0, size1, lo) {
  'worklet';
  const ratio = size1 / size0;
  const o = focalNow - (focal0 - offset0) * ratio;
  return clamp(o, lo, 0);
}

/**
 * What a touch at (x, y) in the roll's own coordinates hits.
 * region: 'corner' | 'header' | 'label' | 'grid' | 'none'; row/col are indices or -1.
 */
export function hitTest(g, x, y, offsetX, offsetY, zoomH, zoomV) {
  'worklet';
  const inHeader = y < g.headerH, inLabels = x < g.labelW;
  if (inHeader && inLabels) return { region: 'corner', row: -1, col: -1 };
  const cw = cellWidth(g, zoomH), ch = cellHeight(g, zoomV);
  const col = Math.floor((x - g.labelW - offsetX) / cw);
  const row = Math.floor((y - g.headerH - offsetY) / ch);
  const colOk = !inLabels && col >= 0 && col < g.cols;
  const rowOk = !inHeader && row >= 0 && row < g.rows;
  if (inHeader) return colOk ? { region: 'header', row: -1, col } : { region: 'none', row: -1, col: -1 };
  if (inLabels) return rowOk ? { region: 'label', row, col: -1 } : { region: 'none', row: -1, col: -1 };
  if (colOk && rowOk) return { region: 'grid', row, col };
  return { region: 'none', row: -1, col: -1 };
}

/** Scroll offset that puts row `index` a few rows below the top of the view. */
export function offsetForRow(g, index, zoomV) {
  'worklet';
  const ch = cellHeight(g, zoomV);
  const lo = scrollMin(g, 1, zoomV).y;
  return clamp(-(index * ch - ch * 3), lo, 0);
}
