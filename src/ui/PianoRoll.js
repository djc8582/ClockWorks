// Piano roll + drum step grid, drawn as ONE Skia picture on the UI thread.
//
// Why: the previous version mounted a React view per cell and swapped rows in
// and out while scrolling. Rows mounted a frame after the scroll moved, spacer
// heights lagged the rows, and the scroll limits were guessed from the screen
// height — so scrolling jumped, flickered, showed blank rows on a fling and
// could not reach the lowest notes. Now scroll and zoom are shared values, the
// picture is redrawn from them every frame (only the visible cells), and React
// only rebuilds the flat note arrays when the pattern itself changes.
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, PixelRatio, Platform } from 'react-native';
import { Canvas, Picture, createPicture, matchFont } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useSharedValue, useDerivedValue, runOnJS, withDecay, withSpring, cancelAnimation,
} from 'react-native-reanimated';
import { DRUM_TIMBRES, ROLL } from '../constants.js';
import { updateState, getState, panelBarIndex } from '../state.js';
import { editLayerBar } from '../looper.js';
import { useStore } from '../hooks/useStore.js';
import { playPreview } from '../audio/audioEngine.js';
import { buildRollData, focusRow, getStepData } from './rollData.js';
import {
  scrollMin, clamp, rubber, unrubber, zoomAround, hitTest, offsetForRow, cellWidth, cellHeight,
} from './rollGeometry.js';
import { drawRoll, ROLL_THEME } from './rollDraw.js';

const FAMILY = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
const FONTS = {
  label: matchFont({ fontFamily: FAMILY, fontSize: 9 }),
  labelBold: matchFont({ fontFamily: FAMILY, fontSize: 9, fontWeight: 'bold' }),
  num: matchFont({ fontFamily: FAMILY, fontSize: 11, fontWeight: 'bold' }),
  numSmall: matchFont({ fontFamily: FAMILY, fontSize: 9 }),
  drum: matchFont({ fontFamily: FAMILY, fontSize: 12, fontWeight: 'bold' }),
  corner: matchFont({ fontFamily: FAMILY, fontSize: 11, fontWeight: '600' }),
};
const HAIR = 1 / PixelRatio.get();

function persistZoom(h, v) {
  updateState((s) => { s.ui.rollZoom = h; s.ui.rollZoomV = v; });
}

// ── edits (JS thread) ─────────────────────────────────────────
function stepOf(sh, vi, si) {
  if (!sh.vertices[vi]) return null;
  return si === 0 ? sh.vertices[vi] : (sh.vertices[vi].subs && sh.vertices[vi].subs[si - 1]);
}

function panelShapeNow(shapeId) {
  const st = getState();
  const scene = st.scenes[panelBarIndex(st)];
  return scene && scene.shapes.find((s) => s.id === shapeId);
}

function toggleNote(shapeId, vi, si, pitch) {
  const shape = panelShapeNow(shapeId);
  const sd = shape && getStepData(shape.vertices[vi], si);
  if (!sd) return;
  const has = (sd.pitches || []).some((p) => Math.abs(p - pitch) < 0.01);
  const removing = has && !sd.muted;
  // Lands on the edited bar only — a repeat bar becomes an override
  updateState((s) => {
    editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
      const d = stepOf(sh, vi, si);
      if (!d) return;
      if (!d.pitches) d.pitches = [];
      if (removing) {
        d.pitches = d.pitches.filter((p) => Math.abs(p - pitch) > 0.01);
        if (d.pitches.length === 0) d.muted = true;
      } else {
        if (!has) { d.pitches.push(pitch); d.pitches.sort((a, b) => a - b); }
        d.muted = false;
      }
    });
  });
  if (!removing) {
    const after = panelShapeNow(shapeId);
    if (after) playPreview(after, vi, si);
  }
}

function toggleDrum(shapeId, vi, si, slot) {
  updateState((s) => {
    editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
      const d = stepOf(sh, vi, si);
      if (!d) return;
      if (!d.pitches) d.pitches = [];
      const i = d.pitches.indexOf(slot);
      if (i !== -1) {
        d.pitches.splice(i, 1);
        if (d.pitches.length === 0) d.muted = true;
      } else {
        d.pitches.push(slot); d.pitches.sort((a, b) => a - b);
        d.muted = false;
      }
    });
  });
}

function toggleMute(shapeId, vi, si) {
  updateState((s) => {
    editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
      const d = stepOf(sh, vi, si);
      if (d) d.muted = !d.muted;
    });
  });
}

// ── component ─────────────────────────────────────────────────
export default function PianoRoll({ shape, color }) {
  if (!shape) return null;
  return <Roll shape={shape} color={color} drum={DRUM_TIMBRES.has(shape.timbre)} />;
}

function Roll({ shape, color, drum }) {
  const scale = useStore((s) => s.scale);
  const selectedNode = useStore((s) => s.ui.selectedNodeIndex);
  const rollZoom = useStore((s) => s.ui.rollZoom || 1);
  const rollZoomV = useStore((s) => s.ui.rollZoomV || 1);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Keyed on the pattern's content: every state update makes new shape objects
  // (and edits mutate vertices in place), so neither reference says if notes changed
  const sig = `${shape.sides}|${shape.subdivision || 1}|${JSON.stringify(shape.vertices)}`;
  const data = useMemo(() => buildRollData(shape, scale, drum, selectedNode),
    [sig, scale.join(','), drum, selectedNode]);
  const labelW = drum ? ROLL.drumLabelW : ROLL.labelW;
  const headerH = drum ? ROLL.drumHeaderH : ROLL.headerH;
  const viewW = Math.max(0, size.w - labelW);
  const viewH = Math.max(0, size.h - headerH);
  const geo = useMemo(() => ({
    cols: data.cols, rows: data.rows,
    baseCellW: data.cols > 0 ? viewW / data.cols : 40,
    baseCellH: drum ? ROLL.drumCellH : ROLL.cellH,
    minCellW: ROLL.minCellW, minCellH: drum ? 12 : ROLL.minCellH,
    viewW, viewH, labelW, headerH,
  }), [data.cols, data.rows, viewW, viewH, labelW, headerH, drum]);

  // UI-thread state
  const ox = useSharedValue(0), oy = useSharedValue(0);
  const zh = useSharedValue(rollZoom), zv = useSharedValue(rollZoomV);
  const G = useSharedValue(geo);
  const D = useSharedValue(data);
  const accent = useSharedValue(color.main);
  const rawX = useSharedValue(0), rawY = useSharedValue(0);
  const flinging = useSharedValue(0);       // axes still decaying
  const stoppedFling = useSharedValue(false);
  const pinching = useSharedValue(false);
  const rebase = useSharedValue(true);
  const axis = useSharedValue(3);            // 1 time, 2 pitch, 3 both
  const lastF = useSharedValue({ x: 0, y: 0, ok: false });
  const p0 = useSharedValue({ ox: 0, oy: 0, zh: 1, zv: 1, fx: 0, fy: 0, scale: 1 });

  // Bring each new frame of data/geometry to the UI thread, and keep the view inside the new limits
  useEffect(() => { D.value = data; }, [data]);
  useEffect(() => { accent.value = color.main; }, [color.main]);
  useEffect(() => {
    G.value = geo;
    const lo = scrollMin(geo, zh.value, zv.value);
    if (!pinching.value && !flinging.value) {
      ox.value = clamp(ox.value, lo.x, 0);
      oy.value = clamp(oy.value, lo.y, 0);
    }
  }, [geo]);
  useEffect(() => { if (!pinching.value) zh.value = rollZoom; }, [rollZoom]);
  useEffect(() => { if (!pinching.value) zv.value = rollZoomV; }, [rollZoomV]);

  // Open a layer (or change scale) scrolled to its notes; a new layer starts at step 1
  const focusKey = `${shape.id}|${drum}|${scale.join(',')}|${viewH > 0}`;
  const lastFocus = useRef('');
  const lastId = useRef(shape.id);
  useEffect(() => {
    if (viewH <= 0 || lastFocus.current === focusKey) return;
    lastFocus.current = focusKey;
    cancelAnimation(ox); cancelAnimation(oy); flinging.value = 0;
    if (lastId.current !== shape.id) { lastId.current = shape.id; ox.value = 0; }
    oy.value = drum ? 0 : offsetForRow(geo, focusRow(shape, data.rowValues), zv.value);
  }, [focusKey]);

  // ── taps (JS) ──
  const onTap = useCallback((x, y, sx, sy, szh, szv) => {
    const g = G.value, d = D.value;
    const hit = hitTest(g, x, y, sx, sy, szh, szv);
    if (hit.region === 'grid') {
      const vi = Math.floor(hit.col / d.sub), si = hit.col % d.sub;
      if (d.drum) toggleDrum(shape.id, vi, si, d.rowValues[hit.row]);
      else toggleNote(shape.id, vi, si, d.rowValues[hit.row]);
    } else if (hit.region === 'header' && !d.drum) {
      toggleMute(shape.id, Math.floor(hit.col / d.sub), hit.col % d.sub);
    }
  }, [shape.id]);

  // ── gestures (UI thread) ──
  const gesture = useMemo(() => {
    const endFling = () => { 'worklet'; flinging.value = Math.max(0, flinging.value - 1); };

    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(ROLL.panMinDistance)
      .onBegin(() => {
        'worklet';
        // Touching a moving roll stops it, and that touch is not a tap
        stoppedFling.value = flinging.value > 0;
        if (flinging.value > 0) { cancelAnimation(ox); cancelAnimation(oy); flinging.value = 0; }
      })
      .onStart(() => {
        'worklet';
        cancelAnimation(ox); cancelAnimation(oy); flinging.value = 0;
        const lo = scrollMin(G.value, zh.value, zv.value);
        rawX.value = unrubber(ox.value, lo.x, 0, ROLL.overscroll);
        rawY.value = unrubber(oy.value, lo.y, 0, ROLL.overscroll);
        p0.value = { ...p0.value, ox: rawX.value, oy: rawY.value };
      })
      .onUpdate((e) => {
        'worklet';
        if (pinching.value) return;
        const lo = scrollMin(G.value, zh.value, zv.value);
        ox.value = rubber(p0.value.ox + e.translationX, lo.x, 0, ROLL.overscroll);
        oy.value = rubber(p0.value.oy + e.translationY, lo.y, 0, ROLL.overscroll);
      })
      .onEnd((e, ok) => {
        'worklet';
        const lo = scrollMin(G.value, zh.value, zv.value);
        const fling = ok && !pinching.value;
        const settle = (sv, lim, vel) => {
          'worklet';
          if (sv.value > 0 || sv.value < lim) {
            flinging.value += 1;
            sv.value = withSpring(clamp(sv.value, lim, 0), { damping: 26, stiffness: 260, overshootClamping: true }, endFling);
          } else if (fling && Math.abs(vel) > 40) {
            flinging.value += 1;
            sv.value = withDecay({ velocity: vel, deceleration: 0.997, clamp: [lim, 0], rubberBandEffect: true, rubberBandFactor: 0.7 }, endFling);
          }
        };
        settle(ox, lo.x, e.velocityX);
        settle(oy, lo.y, e.velocityY);
      });

    const pinch = Gesture.Pinch()
      .onTouchesDown((e) => {
        'worklet';
        if (e.numberOfTouches < 2) return;
        const t = e.allTouches;
        const dx = Math.abs(t[0].x - t[1].x), dy = Math.abs(t[0].y - t[1].y);
        // Side by side → stretch time, stacked → stretch pitch, diagonal → both
        const ratio = dx / (dy + 0.001);
        axis.value = ratio > 1.4 ? 1 : ratio < 0.7 ? 2 : 3;
        rebase.value = true;
      })
      .onTouchesUp(() => { rebase.value = true; })
      .onStart(() => {
        'worklet';
        pinching.value = true;
        lastF.value = { x: 0, y: 0, ok: false };
        cancelAnimation(ox); cancelAnimation(oy); flinging.value = 0;
        rebase.value = true;
      })
      .onUpdate((e) => {
        'worklet';
        const g = G.value;
        if (e.numberOfPointers < 2) {
          // One finger left on the glass: keep scrolling with it
          rebase.value = true;
          const lf = lastF.value;
          if (lf.ok) {
            const lo = scrollMin(g, zh.value, zv.value);
            ox.value = clamp(ox.value + (e.focalX - lf.x), lo.x, 0);
            oy.value = clamp(oy.value + (e.focalY - lf.y), lo.y, 0);
          }
          lastF.value = { x: e.focalX, y: e.focalY, ok: true };
          return;
        }
        lastF.value = { x: 0, y: 0, ok: false };
        const fx = e.focalX - g.labelW, fy = e.focalY - g.headerH;
        if (rebase.value) {
          // Finger count changed: start from where things are now, no jump
          rebase.value = false;
          p0.value = { ox: ox.value, oy: oy.value, zh: zh.value, zv: zv.value, fx, fy, scale: e.scale };
          return;
        }
        const s = p0.value;
        const factor = e.scale / s.scale;
        const a = axis.value;
        if (a === 1 || a === 3) {
          const nz = clamp(s.zh * factor, ROLL.zoomHMin, ROLL.zoomHMax);
          zh.value = nz;
          ox.value = zoomAround(s.ox, s.fx, fx, cellWidth(g, s.zh), cellWidth(g, nz), scrollMin(g, nz, zv.value).x);
        } else {
          ox.value = clamp(s.ox + (fx - s.fx), scrollMin(g, zh.value, zv.value).x, 0);
        }
        if (a === 2 || a === 3) {
          const nz = clamp(s.zv * factor, ROLL.zoomVMin, ROLL.zoomVMax);
          zv.value = nz;
          oy.value = zoomAround(s.oy, s.fy, fy, cellHeight(g, s.zv), cellHeight(g, nz), scrollMin(g, zh.value, nz).y);
        } else {
          oy.value = clamp(s.oy + (fy - s.fy), scrollMin(g, zh.value, zv.value).y, 0);
        }
      })
      .onFinalize(() => {
        'worklet';
        if (!pinching.value) return;
        pinching.value = false;
        runOnJS(persistZoom)(zh.value, zv.value);
      });

    const tap = Gesture.Tap()
      .maxDistance(ROLL.tapSlop)
      .maxDuration(400)
      .onBegin(() => {
        'worklet';
        stoppedFling.value = flinging.value > 0;
        if (flinging.value > 0) { cancelAnimation(ox); cancelAnimation(oy); flinging.value = 0; }
      })
      .onEnd((e, ok) => {
        'worklet';
        if (!ok || stoppedFling.value || pinching.value) return;
        runOnJS(onTap)(e.x, e.y, ox.value, oy.value, zh.value, zv.value);
      });

    return Gesture.Simultaneous(pinch, Gesture.Race(pan, tap));
  }, [onTap]);

  // ── drawing (UI thread, every frame something moves) ──
  const picture = useDerivedValue(() => {
    const g = G.value, d = D.value, col = accent.value;
    const v = { ox: ox.value, oy: oy.value, zh: zh.value, zv: zv.value };
    return createPicture((canvas) => {
      drawRoll(canvas, d, g, v, FONTS, col, HAIR, ROLL_THEME, ROLL.drumDot, ROLL.muteDot);
    });
  });

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (Math.abs(s.w - width) < 0.5 && Math.abs(s.h - height) < 0.5 ? s : { w: width, h: height }));
  }, []);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.container} onLayout={onLayout} collapsable={false}>
        {size.w > 0 && (
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden' },
});
