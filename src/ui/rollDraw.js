// Draws the whole piano roll (grid, step header, note labels, corner) into one
// Skia canvas on the UI thread. Called every frame the roll moves, but only the
// rows and columns inside the view are drawn, so the cost doesn't grow with the
// number of rows. Nothing here touches React.
import { Skia, ClipOp, PaintStyle } from '@shopify/react-native-skia';
import { cellWidth, cellHeight, visibleRange } from './rollGeometry.js';

export const ROLL_THEME = {
  bg: '#FFFFFF',
  line: 'rgba(0,0,0,0.06)',
  strong: 'rgba(0,0,0,0.12)',
  border: 'rgba(0,0,0,0.1)',
  selTint: 'rgba(0,0,0,0.035)',
  muted: 'rgba(0,0,0,0.12)',
  emptyDot: 'rgba(0,0,0,0.06)',
  muteRing: 'rgba(0,0,0,0.22)',
  text: '#333333',
  textDim: 'rgba(0,0,0,0.35)',
  textFaint: 'rgba(0,0,0,0.25)',
};

/**
 * @param canvas SkCanvas
 * @param d      rollData (see rollData.js)
 * @param g      geometry: cols, rows, baseCellW, baseCellH, minCellW, minCellH, viewW, viewH, labelW, headerH
 * @param v      { ox, oy, zh, zv } live scroll + zoom
 * @param F      fonts { label, labelBold, num, numSmall, drum, corner }
 * @param color  layer colour (hex)
 * @param hair   hairline width in px
 */
export function drawRoll(canvas, d, g, v, F, color, hair, T, dotSize, muteDot) {
  'worklet';
  if (!d || !g || g.viewW <= 0 || g.viewH <= 0) return;
  const cw = cellWidth(g, v.zh), ch = cellHeight(g, v.zv);
  const W = g.labelW + g.viewW, H = g.headerH + g.viewH;
  const gx = g.labelW + v.ox, gy = g.headerH + v.oy; // grid origin on screen
  const cr = visibleRange(v.ox, cw, g.viewW, d.cols);
  const rr = visibleRange(v.oy, ch, g.viewH, d.rows);

  const fill = Skia.Paint(); fill.setAntiAlias(true);
  const stroke = Skia.Paint(); stroke.setAntiAlias(true); stroke.setStyle(PaintStyle.Stroke);
  const C = (c) => Skia.Color(c);
  const accent = C(color);

  fill.setColor(C(T.bg));
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), fill);

  const sub = d.sub;
  const selX = d.sel >= 0 ? gx + d.sel * sub * cw : 0;

  // ── grid ──────────────────────────────────────────────
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(g.labelW, g.headerH, g.viewW, g.viewH), ClipOp.Intersect, false);
  if (d.sel >= 0) { fill.setColor(C(T.selTint)); canvas.drawRect(Skia.XYWHRect(selX, g.headerH, sub * cw, g.viewH), fill); }

  // row lines
  const gridR = Math.min(W, gx + d.cols * cw);
  for (let r = rr.first; r <= rr.last; r++) {
    const y = gy + (r + 1) * ch;
    const c = d.isC[r] === 1;
    stroke.setStrokeWidth(c ? 1 : hair);
    stroke.setColor(C(c ? T.strong : T.line));
    canvas.drawLine(g.labelW, y, gridR, y, stroke);
  }
  // column lines (beat starts are stronger)
  const gridB = Math.min(H, gy + d.rows * ch);
  for (let c = cr.first; c <= cr.last + 1 && c <= d.cols; c++) {
    const x = gx + c * cw;
    const beat = c > 0 && c < d.cols && c % sub === 0;
    stroke.setStrokeWidth(beat ? 1.5 : hair);
    stroke.setColor(C(beat ? T.strong : T.line));
    canvas.drawLine(x, g.headerH, x, gridB, stroke);
  }

  // notes
  for (let r = rr.first; r <= rr.last; r++) {
    const y0 = gy + r * ch;
    for (let c = cr.first; c <= cr.last; c++) {
      const s = d.cells[r * d.cols + c];
      const x0 = gx + c * cw;
      if (d.drum) {
        const rad = Math.max(3, Math.min(dotSize / 2, cw * 0.38, ch * 0.38));
        fill.setColor(s ? accent : C(T.emptyDot));
        canvas.drawCircle(x0 + cw / 2, y0 + ch / 2, rad, fill);
      } else if (s) {
        const bh = Math.max(3, (ch - 1) * (d.vel[c] || 0.67));
        const top = y0 + ch - bh;
        fill.setColor(s === 1 ? accent : C(T.muted));
        const rad = Math.min(3, bh / 2, (cw - 2) / 2);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x0 + 1, top, cw - 2, bh), rad, rad), fill);
        canvas.drawRect(Skia.XYWHRect(x0 + 1, top + rad, cw - 2, bh - rad), fill);
      }
    }
  }
  canvas.restore();

  // ── step header ───────────────────────────────────────
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(g.labelW, 0, g.viewW, g.headerH), ClipOp.Intersect, false);
  fill.setColor(C(T.bg)); canvas.drawRect(Skia.XYWHRect(g.labelW, 0, g.viewW, g.headerH), fill);
  if (d.sel >= 0) { fill.setColor(C(T.selTint)); canvas.drawRect(Skia.XYWHRect(selX, 0, sub * cw, g.headerH), fill); }
  for (let c = cr.first; c <= cr.last; c++) {
    const x0 = gx + c * cw, cx = x0 + cw / 2;
    const first = c % sub === 0;
    const vi = Math.floor(c / sub);
    const label = d.colLabels[c];
    if (label) {
      const f = first ? F.num : F.numSmall;
      const w = f.measureText(label).width;
      fill.setColor(first ? (vi === d.sel ? accent : C(T.text)) : C(T.textFaint));
      const ty = d.drum ? g.headerH / 2 + 4 : g.headerH * 0.42;
      canvas.drawText(label, cx - w / 2, ty, fill, f);
    }
    if (!d.drum) {
      const r = muteDot / 2, cy = g.headerH * 0.7;
      if (!d.colMuted[c]) { fill.setColor(accent); canvas.drawCircle(cx, cy, r, fill); }
      else { stroke.setStrokeWidth(1.5); stroke.setColor(C(T.muteRing)); canvas.drawCircle(cx, cy, r - 0.75, stroke); }
    }
    const beat = c > 0 && first;
    if (beat) { stroke.setStrokeWidth(1.5); stroke.setColor(C(T.strong)); canvas.drawLine(x0, 0, x0, g.headerH, stroke); }
  }
  canvas.restore();

  // ── note / drum labels ────────────────────────────────
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(0, g.headerH, g.labelW, g.viewH), ClipOp.Intersect, false);
  fill.setColor(C(T.bg)); canvas.drawRect(Skia.XYWHRect(0, g.headerH, g.labelW, g.viewH), fill);
  for (let r = rr.first; r <= rr.last; r++) {
    const y0 = gy + r * ch;
    const c = d.isC[r] === 1;
    const f = d.drum ? F.drum : (c ? F.labelBold : F.label);
    fill.setColor(C(d.drum || c ? T.text : T.textDim));
    const size = d.drum ? 12 : 9;
    canvas.drawText(d.labels[r], 4, y0 + ch / 2 + size * 0.36, fill, f);
    stroke.setStrokeWidth(c ? 1 : hair);
    stroke.setColor(C(c ? T.strong : T.line));
    canvas.drawLine(0, y0 + ch, g.labelW, y0 + ch, stroke);
  }
  canvas.restore();

  // ── frame lines + corner ──────────────────────────────
  stroke.setStrokeWidth(hair); stroke.setColor(C(T.line));
  canvas.drawLine(g.labelW, 0, g.labelW, H, stroke);
  fill.setColor(C(T.bg)); canvas.drawRect(Skia.XYWHRect(0, 0, g.labelW, g.headerH), fill);
  const corner = d.drum ? 'Step' : 'Edit';
  const cwid = F.corner.measureText(corner).width;
  fill.setColor(C(T.textDim));
  canvas.drawText(corner, (g.labelW - cwid) / 2, g.headerH / 2 + 4, fill, F.corner);
  stroke.setStrokeWidth(1); stroke.setColor(C(T.border));
  canvas.drawLine(0, g.headerH, W, g.headerH, stroke);
}
