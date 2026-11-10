import React, { useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, runOnJS, withDecay } from 'react-native-reanimated';
import { COLORS, NOTE_NAMES, PITCH, DRUM_TIMBRES, DRUM_SLOTS } from '../constants.js';
import { updateState, panelBarIndex } from '../state.js';
import { editLayerBar } from '../looper.js';
import { useStore } from '../hooks/useStore.js';
import PianoRollCell from './PianoRollCell.js';

function getStepData(vertex, stepIndex) {
  if (stepIndex === 0) return vertex;
  return vertex.subs && vertex.subs[stepIndex - 1];
}

function buildRows(scale, shape) {
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
  for (const v of shape.vertices) {
    if (v && v.pitches) for (const p of v.pitches) rowSet.add(p);
    if (v && v.subs) for (const sub of v.subs) {
      if (sub && sub.pitches) for (const p of sub.pitches) rowSet.add(p);
    }
  }
  return Array.from(rowSet).sort((a, b) => b - a);
}

function pitchLabel(pitch) {
  const nearest = Math.round(pitch);
  const cents = Math.round((pitch - nearest) * 100);
  const name = NOTE_NAMES[((nearest % 12) + 12) % 12];
  const octave = Math.floor(nearest / 12 - 1);
  if (cents === 0) return name + octave;
  return name + octave + (cents > 0 ? '+' : '') + cents + '¢';
}

export default function PianoRoll({ shape, color }) {
  if (!shape) return null;
  if (DRUM_TIMBRES.has(shape.timbre)) return <DrumGrid shape={shape} color={color} />;
  return <MelodicGrid shape={shape} color={color} />;
}

// ── Zoom persister — runs ONLY at gesture end ────────────────
// Zoom visuals are fully UI-thread (animated width/height), so React
// state is just persistence: it survives unmount/remount of the grid.
function persistZoom(h, v) {
  updateState(s => {
    s.ui.rollZoom = h;
    s.ui.rollZoomV = v;
  });
}

// ── Gesture + layout hook ────────────────────────────────────
// SINGLE-CHANNEL ZOOM: pinch updates zoomH/zoomV shared values; row
// width/height are animated styles derived from them, committed to the
// shadow tree on the UI thread every frame. React is NOT involved while
// the gesture runs — no layout/transform race, no mid-gesture commits,
// no scale-bridge. Cells are flex:1 and never re-render during zoom.
function usePianoGestures() {
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const rollZoomV = useStore(s => s.ui.rollZoomV || 1.0);

  // Position
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  // Zoom (live, UI thread)
  const zoomH = useSharedValue(rollZoom);
  const zoomV = useSharedValue(rollZoomV);
  // Pinch state
  const isPinching = useSharedValue(false);
  const wasPinching = useSharedValue(false); // for post-pinch drag
  const pinchAxis = useSharedValue(0); // 0=none, 1=H, 2=V, 3=both
  const pinchFocalX = useSharedValue(0);
  const pinchFocalY = useSharedValue(0);
  const pinchStartOX = useSharedValue(0);
  const pinchStartOY = useSharedValue(0);
  const pinchStartZH = useSharedValue(1);
  const pinchStartZV = useSharedValue(1);
  // Post-pinch drag tracking
  const lastFocalX = useSharedValue(0);
  const lastFocalY = useSharedValue(0);
  // Pan state
  const panStartOX = useSharedValue(0);
  const panStartOY = useSharedValue(0);
  // Grid dimensions for worklet clamping (synced from React)
  const sv_totalCols = useSharedValue(1);
  const sv_baseCellW = useSharedValue(40);
  const sv_totalRows = useSharedValue(1);
  const sv_baseCellH = useSharedValue(28);
  const sv_minCellH = useSharedValue(14);
  const sv_viewW = useSharedValue(300);
  const sv_viewH = useSharedValue(300);
  const sv_labelW = useSharedValue(42);
  const sv_headerH = useSharedValue(44);

  // External zoom changes (mount, project load) → shared values.
  // Never while a pinch is live — the gesture owns the values then.
  useEffect(() => {
    if (!isPinching.value && !wasPinching.value) zoomH.value = rollZoom;
  }, [rollZoom]);
  useEffect(() => {
    if (!isPinching.value && !wasPinching.value) zoomV.value = rollZoomV;
  }, [rollZoomV]);

  // Worklet clamp helpers
  function clampX(x) {
    'worklet';
    const cw = sv_totalCols.value * Math.max(20, sv_baseCellW.value * zoomH.value);
    return Math.max(Math.min(0, sv_viewW.value - cw), Math.min(0, x));
  }
  function clampY(y) {
    'worklet';
    const ch = sv_totalRows.value * Math.max(sv_minCellH.value, sv_baseCellH.value * zoomV.value);
    return Math.max(Math.min(0, sv_viewH.value - ch), Math.min(0, y));
  }

  // ── Pan gesture ────────────────────────────────────────────
  const pan = useMemo(() => Gesture.Pan()
    .maxPointers(1)  // NEVER fires for 2+ fingers — prevents scroll during pinch
    .minDistance(5)   // responsive but won't steal taps
    .onStart(() => {
      'worklet';
      panStartOX.value = offsetX.value;
      panStartOY.value = offsetY.value;
    })
    .onUpdate((e) => {
      'worklet';
      offsetX.value = clampX(panStartOX.value + e.translationX);
      offsetY.value = clampY(panStartOY.value + e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      // Fling momentum with edge clamping — scrolling that stops dead on
      // finger-lift feels broken on mobile
      const cw = sv_totalCols.value * Math.max(20, sv_baseCellW.value * zoomH.value);
      const ch = sv_totalRows.value * Math.max(sv_minCellH.value, sv_baseCellH.value * zoomV.value);
      const minX = Math.min(0, sv_viewW.value - cw);
      const minY = Math.min(0, sv_viewH.value - ch);
      offsetX.value = withDecay({ velocity: e.velocityX, clamp: [minX, 0] });
      offsetY.value = withDecay({ velocity: e.velocityY, clamp: [minY, 0] });
    }), []);

  // ── Pinch gesture ──────────────────────────────────────────
  const pinch = useMemo(() => Gesture.Pinch()
    .onTouchesDown((e) => {
      'worklet';
      if (e.numberOfTouches >= 2) {
        isPinching.value = true;
        wasPinching.value = true;
        const t = e.allTouches;
        const dx = Math.abs(t[0].x - t[1].x);
        const dy = Math.abs(t[0].y - t[1].y);
        // Axis from finger arrangement: side-by-side → time axis,
        // stacked → pitch axis, diagonal → both at once
        const ratio = dx / (dy + 0.001);
        if (ratio > 1.4) pinchAxis.value = 1;        // clearly horizontal
        else if (ratio < 0.7) pinchAxis.value = 2;    // clearly vertical
        else pinchAxis.value = 3;                     // diagonal → both axes
        // Focal point in GRID VIEWPORT coordinates
        pinchFocalX.value = (t[0].x + t[1].x) / 2 - sv_labelW.value;
        pinchFocalY.value = (t[0].y + t[1].y) / 2 - sv_headerH.value;
      }
    })
    .onStart(() => {
      'worklet';
      pinchStartOX.value = offsetX.value;
      pinchStartOY.value = offsetY.value;
      pinchStartZH.value = zoomH.value;
      pinchStartZV.value = zoomV.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (e.numberOfPointers === 1) {
        // Post-pinch single-finger drag
        if (isPinching.value) {
          // First frame after finger lift — just capture position, don't move
          isPinching.value = false;
          lastFocalX.value = e.focalX;
          lastFocalY.value = e.focalY;
          return;
        }
        if (wasPinching.value) {
          // Subsequent frames — drag via focal delta
          const fdx = e.focalX - lastFocalX.value;
          const fdy = e.focalY - lastFocalY.value;
          lastFocalX.value = e.focalX;
          lastFocalY.value = e.focalY;
          offsetX.value = clampX(offsetX.value + fdx);
          offsetY.value = clampY(offsetY.value + fdy);
        }
        return;
      }
      if (e.numberOfPointers !== 2) return;

      // 1:1 zoom — fingers spreading 2x means content 2x
      const factor = e.scale;
      // LIVE focal point: the content under the fingers stays glued to the
      // fingers as they spread AND move — zoom + pan in one gesture
      const focalNowX = e.focalX - sv_labelW.value;
      const focalNowY = e.focalY - sv_headerH.value;

      if (pinchAxis.value === 1 || pinchAxis.value === 3) {
        const newZH = Math.min(4.0, Math.max(1.0, pinchStartZH.value * factor));
        const zRatio = newZH / pinchStartZH.value;
        let newOX = focalNowX - (pinchFocalX.value - pinchStartOX.value) * zRatio;
        const cw = sv_totalCols.value * Math.max(20, sv_baseCellW.value * newZH);
        const minX = Math.min(0, sv_viewW.value - cw);
        newOX = Math.max(minX, Math.min(0, newOX));
        offsetX.value = newOX;
        zoomH.value = newZH;
        if (pinchAxis.value === 1) {
          // Zoom is H-locked but the fingers can still drift vertically —
          // follow them (pan the un-zoomed axis by the focal delta)
          offsetY.value = clampY(pinchStartOY.value + (focalNowY - pinchFocalY.value));
        }
      }
      if (pinchAxis.value === 2 || pinchAxis.value === 3) {
        const newZV = Math.min(3.0, Math.max(0.6, pinchStartZV.value * factor));
        const zRatio = newZV / pinchStartZV.value;
        let newOY = focalNowY - (pinchFocalY.value - pinchStartOY.value) * zRatio;
        const ch = sv_totalRows.value * Math.max(sv_minCellH.value, sv_baseCellH.value * newZV);
        const minY = Math.min(0, sv_viewH.value - ch);
        newOY = Math.max(minY, Math.min(0, newOY));
        offsetY.value = newOY;
        zoomV.value = newZV;
        if (pinchAxis.value === 2) {
          // V-locked zoom — follow horizontal finger drift on the time axis
          offsetX.value = clampX(pinchStartOX.value + (focalNowX - pinchFocalX.value));
        }
      }
    })
    .onEnd(() => {
      'worklet';
      isPinching.value = false;
      wasPinching.value = false;
      pinchAxis.value = 0;
      // Persist for remounts — visuals already correct on the UI thread
      runOnJS(persistZoom)(zoomH.value, zoomV.value);
    })
    .onFinalize(() => {
      'worklet';
      isPinching.value = false;
      wasPinching.value = false;
      pinchAxis.value = 0;
      // Safety net — onFinalize always fires even if onEnd doesn't
      runOnJS(persistZoom)(zoomH.value, zoomV.value);
    }),
  []);

  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), []);

  // ── Animated styles ─────────────────────────────────────────
  // Pure translation — zoom lives in the SIZE styles built per-grid, so
  // there is no scale transform and nothing for React to race against.
  const panBothStyle = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateX: offsetX.value }, { translateY: offsetY.value }] };
  });
  const panXStyle = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateX: offsetX.value }] };
  });
  const panYStyle = useAnimatedStyle(() => {
    'worklet';
    return { transform: [{ translateY: offsetY.value }] };
  });

  // Shared size styles — attached to EVERY row / label / header strip.
  // Width/height update on the UI thread each pinch frame (Fabric).
  const rowSizeStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      width: sv_totalCols.value * Math.max(20, sv_baseCellW.value * zoomH.value),
      height: Math.max(sv_minCellH.value, sv_baseCellH.value * zoomV.value),
    };
  });
  const labelSizeStyle = useAnimatedStyle(() => {
    'worklet';
    return { height: Math.max(sv_minCellH.value, sv_baseCellH.value * zoomV.value) };
  });
  const headerWidthStyle = useAnimatedStyle(() => {
    'worklet';
    return { width: sv_totalCols.value * Math.max(20, sv_baseCellW.value * zoomH.value) };
  });

  return {
    gesture, panBothStyle, panXStyle, panYStyle,
    rowSizeStyle, labelSizeStyle, headerWidthStyle,
    offsetX, offsetY, zoomH, zoomV, isPinching,
    sv_totalCols, sv_baseCellW, sv_totalRows, sv_baseCellH, sv_minCellH, sv_viewW, sv_viewH,
    sv_labelW, sv_headerH,
    rollZoom, rollZoomV,
  };
}

// ── Drum step sequencer ──────────────────────────────────────
function DrumGrid({ shape, color }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const g = usePianoGestures();

  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;
  const labelW = 70;
  const baseDrumW = (screenWidth - labelW) / totalCols;
  const headerH = 36;
  const slotLabels = DRUM_SLOTS || ['Kick', 'Snare', 'HiHat', 'Perc'];
  const viewW = screenWidth - labelW;
  const viewH = screenHeight * 0.45 - headerH;

  // Sync grid dimensions → shared values (drives size styles + clamping)
  useEffect(() => { g.sv_totalCols.value = totalCols; }, [totalCols]);
  useEffect(() => { g.sv_baseCellW.value = baseDrumW; }, [baseDrumW]);
  useEffect(() => { g.sv_totalRows.value = slotLabels.length; }, [slotLabels.length]);
  useEffect(() => { g.sv_baseCellH.value = 48; }, []);
  useEffect(() => { g.sv_minCellH.value = 1; }, []); // drums have no min cell height
  useEffect(() => { g.sv_viewW.value = viewW; }, [viewW]);
  useEffect(() => { g.sv_viewH.value = viewH; }, [viewH]);
  useEffect(() => { g.sv_labelW.value = labelW; }, []);
  useEffect(() => { g.sv_headerH.value = headerH; }, []);

  // Reset position on shape change
  const prevId = useRef(shape.id);
  useEffect(() => {
    if (prevId.current !== shape.id) {
      prevId.current = shape.id;
      g.offsetX.value = 0;
      g.offsetY.value = 0;
    }
  }, [shape.id]);

  // Pattern edits go through the looper: they land on the edited bar only
  function toggleSlot(vi, si, slotIdx) {
    updateState(s => {
      editLayerBar(s, panelBarIndex(s), shape.id, (sh) => {
        if (!sh.vertices[vi]) return;
        const sd = si === 0 ? sh.vertices[vi] : (sh.vertices[vi].subs && sh.vertices[vi].subs[si - 1]);
        if (!sd) return;
        if (!sd.pitches) sd.pitches = [];
        const idx = sd.pitches.indexOf(slotIdx);
        if (idx !== -1) {
          sd.pitches.splice(idx, 1);
          if (sd.pitches.length === 0) sd.muted = true;
        } else {
          sd.pitches.push(slotIdx);
          sd.pitches.sort((a, b) => a - b);
          sd.muted = false;
        }
      });
    });
  }

  return (
    <GestureDetector gesture={g.gesture}>
      <View style={styles.container}>
        {/* Grid content — scrolls both X and Y */}
        <View style={[styles.clip, { left: labelW, top: headerH }]}>
          <Animated.View style={g.panBothStyle}>
            {slotLabels.map((slot, slotIdx) => (
              <Animated.View key={`dr-${slotIdx}`} style={[styles.row, g.rowSizeStyle]}>
                {Array.from({ length: shape.sides }).map((_, vi) =>
                  Array.from({ length: sub }).map((_, s) => {
                    const stepData = getStepData(shape.vertices[vi], s);
                    const pitches = stepData ? (stepData.pitches || []) : [];
                    const isActive = pitches.includes(slotIdx);
                    return (
                      <Pressable key={`dc-${vi}-${s}-${slotIdx}`}
                        style={[styles.drumCell,
                          s === 0 && vi > 0 && styles.groupStart,
                          vi === selectedNode && styles.drumCellSelected]}
                        onPress={() => toggleSlot(vi, s, slotIdx)}>
                        <View style={[styles.drumDot, isActive ? { backgroundColor: color.main } : { backgroundColor: 'rgba(0,0,0,0.06)' }]} />
                      </Pressable>
                    );
                  })
                )}
              </Animated.View>
            ))}
          </Animated.View>
        </View>
        {/* Column headers — scrolls X, pinned Y */}
        <View style={[styles.clip, styles.headerClip, { left: labelW, height: headerH }]}>
          <Animated.View style={g.panXStyle}>
            <Animated.View style={[styles.headerRow, { height: headerH }, g.headerWidthStyle]}>
              {Array.from({ length: shape.sides }).map((_, vi) =>
                Array.from({ length: sub }).map((_, s) => {
                  const sel = vi === selectedNode;
                  return (
                    <View key={`dh-${vi}-${s}`} style={[styles.colHeader,
                      sel && styles.colHeaderSelected, s === 0 && vi > 0 && styles.groupStart]}>
                      <Text style={[styles.colNum, sel && { color: color.main, fontWeight: '700' }]}>{s === 0 ? vi + 1 : ''}</Text>
                    </View>
                  );
                })
              )}
            </Animated.View>
          </Animated.View>
        </View>
        {/* Row labels — scrolls Y, pinned X */}
        <View style={[styles.clip, styles.labelClip, { top: headerH, width: labelW }]}>
          <Animated.View style={g.panYStyle}>
            {slotLabels.map((slot, slotIdx) => (
              <Animated.View key={`dl-${slotIdx}`} style={[styles.label, { width: labelW }, g.labelSizeStyle]}>
                <Text style={styles.drumLabel}>{slot.charAt(0).toUpperCase() + slot.slice(1)}</Text>
              </Animated.View>
            ))}
          </Animated.View>
        </View>
        {/* Corner — fixed */}
        <View style={[styles.corner, { width: labelW, height: headerH }]}>
          <Text style={styles.cornerText}>Step</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

// ── Melodic piano roll (windowed) ────────────────────────────
const ROW_BUFFER = 8;

function MelodicGrid({ shape, color }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scale = useStore(s => s.scale);
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const g = usePianoGestures();

  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;
  const labelW = 42;
  const baseCellW = (screenWidth - labelW) / totalCols;
  const headerH = 44;

  const rows = useMemo(() => buildRows(scale, shape), [scale, shape]);
  const viewW = screenWidth - labelW;
  const viewH = screenHeight * 0.45 - headerH;

  // Sync grid dimensions → shared values (drives size styles + clamping)
  useEffect(() => { g.sv_totalCols.value = totalCols; }, [totalCols]);
  useEffect(() => { g.sv_baseCellW.value = baseCellW; }, [baseCellW]);
  useEffect(() => { g.sv_totalRows.value = rows.length; }, [rows.length]);
  useEffect(() => { g.sv_baseCellH.value = 28; }, []);
  useEffect(() => { g.sv_minCellH.value = 14; }, []); // melodic min cell height
  useEffect(() => { g.sv_viewW.value = viewW; }, [viewW]);
  useEffect(() => { g.sv_viewH.value = viewH; }, [viewH]);
  useEffect(() => { g.sv_labelW.value = labelW; }, []);
  useEffect(() => { g.sv_headerH.value = headerH; }, []);

  // ── Row windowing ──────────────────────────────────────────
  // Decides WHICH rows mount; spacer SIZES are animated (UI thread), so
  // window updates are never visible — they just swap row content.
  const [scrollY, setScrollY] = useState(0);
  const [winZoom, setWinZoom] = useState(g.rollZoomV);
  const _offsetY = g.offsetY;
  const _zoomV = g.zoomV;
  const _lastWinY = useSharedValue(0);
  const _lastWinZV = useSharedValue(g.rollZoomV);

  function handleScrollUpdate(absY, zoom) {
    setScrollY(absY);
    setWinZoom(zoom);
  }

  useAnimatedReaction(
    () => { 'worklet'; return { oy: _offsetY.value, zv: _zoomV.value }; },
    (curr, prev) => {
      'worklet';
      const absY = Math.max(0, -curr.oy);
      const effectiveCH = Math.max(g.sv_minCellH.value, g.sv_baseCellH.value * curr.zv);
      const threshold = Math.max(1, effectiveCH * 2);
      const zoomChanged = prev !== null && Math.abs(curr.zv - _lastWinZV.value) > 0.06;
      if (prev === null || Math.abs(absY - _lastWinY.value) > threshold || zoomChanged) {
        _lastWinY.value = absY;
        _lastWinZV.value = curr.zv;
        runOnJS(handleScrollUpdate)(absY, curr.zv);
      }
    }, []
  );

  const effectiveCellH = Math.max(14, 28 * winZoom);
  const firstVisible = Math.max(0, Math.floor(scrollY / effectiveCellH) - ROW_BUFFER);
  const lastVisible = Math.min(rows.length - 1, Math.ceil((scrollY + viewH) / effectiveCellH) + ROW_BUFFER);
  const visibleRows = rows.slice(firstVisible, lastVisible + 1);

  // Spacer heights animate with zoom so windowed rows always sit at the
  // exact position the full list would put them
  const sv_firstVisible = useSharedValue(firstVisible);
  const sv_rowsAfter = useSharedValue(Math.max(0, rows.length - lastVisible - 1));
  useEffect(() => { sv_firstVisible.value = firstVisible; }, [firstVisible]);
  useEffect(() => { sv_rowsAfter.value = Math.max(0, rows.length - lastVisible - 1); }, [lastVisible, rows.length]);
  const topSpacerStyle = useAnimatedStyle(() => {
    'worklet';
    return { height: sv_firstVisible.value * Math.max(g.sv_minCellH.value, g.sv_baseCellH.value * g.zoomV.value) };
  });
  const bottomSpacerStyle = useAnimatedStyle(() => {
    'worklet';
    return { height: sv_rowsAfter.value * Math.max(g.sv_minCellH.value, g.sv_baseCellH.value * g.zoomV.value) };
  });

  // ── Scroll to the shape's pitch area ──
  // Re-runs when the shape changes OR the row set changes (e.g. picking a
  // scale shrinks 132 chromatic rows to ~77) — otherwise the old offset
  // can leave the view stranded in the sub-bass rows.
  const rowsKey = `${shape.id}|${rows.length}|${rows[0]}|${rows[rows.length - 1]}`;
  const hasScrolledInit = useRef(null);
  useEffect(() => {
    if (hasScrolledInit.current === rowsKey || rows.length === 0) return;
    hasScrolledInit.current = rowsKey;
    let sum = 0, count = 0;
    for (const v of shape.vertices) {
      if (v && v.pitches) for (const p of v.pitches) { sum += p; count++; }
    }
    const mid = count > 0 ? Math.round(sum / count) : 60;
    let targetIdx = 0, bestDist = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const d = Math.abs(rows[i] - mid);
      if (d < bestDist) { bestDist = d; targetIdx = i; }
    }
    const cellH = Math.max(14, 28 * g.rollZoomV);
    const targetY = Math.max(0, targetIdx * cellH - cellH * 3);
    g.offsetY.value = -targetY;
    _lastWinY.value = targetY;
    handleScrollUpdate(targetY, g.rollZoomV);
  }, [rowsKey]);

  // Reset X on shape change
  const prevId = useRef(shape.id);
  useEffect(() => {
    if (prevId.current !== shape.id) { prevId.current = shape.id; g.offsetX.value = 0; }
  }, [shape.id]);

  function toggleMute(vi, si) {
    updateState(s => {
      editLayerBar(s, panelBarIndex(s), shape.id, (sh) => {
        if (!sh.vertices[vi]) return;
        const sd = si === 0 ? sh.vertices[vi] : (sh.vertices[vi].subs && sh.vertices[vi].subs[si - 1]);
        if (sd) sd.muted = !sd.muted;
      });
    });
  }

  return (
    <GestureDetector gesture={g.gesture}>
      <View style={styles.container}>
        {/* Grid content — scrolls both X and Y */}
        <View style={[styles.clip, { left: labelW, top: headerH }]}>
          <Animated.View style={g.panBothStyle}>
            <Animated.View style={topSpacerStyle} />
            {visibleRows.map(pitch => {
              const isC = Math.abs(pitch % 12) < 0.01 || Math.abs(pitch % 12 - 12) < 0.01;
              return (
                <Animated.View key={`row-${pitch}`} style={[styles.row, g.rowSizeStyle]}>
                  {Array.from({ length: shape.sides }).map((_, vi) =>
                    Array.from({ length: sub }).map((_, s) => {
                      const stepData = getStepData(shape.vertices[vi], s);
                      const pitches = stepData ? (stepData.pitches || []) : [];
                      const hasPitch = pitches.some(p => Math.abs(p - pitch) < 0.01);
                      const isActive = hasPitch && !stepData?.muted;
                      const isMuted = hasPitch && stepData?.muted;
                      const vel = stepData ? stepData.velocity : 0;
                      const sel = vi === selectedNode;
                      const isFirst = s === 0;
                      return (
                        <PianoRollCell key={`cell-${vi}-${s}-${pitch}`} shapeId={shape.id} vertexIndex={vi} stepIndex={s} pitch={pitch} isActive={isActive} isMuted={isMuted} velocity={vel} color={color} isSelectedColumn={sel} isC={isC} isGroupStart={isFirst && vi > 0} />
                      );
                    })
                  )}
                </Animated.View>
              );
            })}
            <Animated.View style={bottomSpacerStyle} />
          </Animated.View>
        </View>
        {/* Column headers — scrolls X, pinned Y */}
        <View style={[styles.clip, styles.headerClip, { left: labelW, height: headerH }]}>
          <Animated.View style={g.panXStyle}>
            <Animated.View style={[styles.headerRow, { height: headerH }, g.headerWidthStyle]}>
              {Array.from({ length: shape.sides }).map((_, vi) =>
                Array.from({ length: sub }).map((_, s) => {
                  const isFirst = s === 0;
                  const sel = vi === selectedNode;
                  const stepData = getStepData(shape.vertices[vi], s);
                  const muted = stepData ? stepData.muted : false;
                  return (
                    <View key={`hdr-${vi}-${s}`} style={[styles.colHeader,
                      sel && styles.colHeaderSelected, isFirst && vi > 0 && styles.groupStart]}>
                      {isFirst ? (
                        <Text style={[styles.colNum, sel && { color: color.main, fontWeight: '700' }]}>{vi + 1}</Text>
                      ) : (
                        <Text style={[styles.colNum, { fontSize: 9, opacity: 0.4 }]}>{s + 1}</Text>
                      )}
                      <Pressable style={[styles.muteBtn, !muted && { backgroundColor: color.main, borderColor: color.main }]} onPress={() => toggleMute(vi, s)} />
                    </View>
                  );
                })
              )}
            </Animated.View>
          </Animated.View>
        </View>
        {/* Row labels — scrolls Y, pinned X */}
        <View style={[styles.clip, styles.labelClip, { top: headerH, width: labelW }]}>
          <Animated.View style={g.panYStyle}>
            <Animated.View style={topSpacerStyle} />
            {visibleRows.map(pitch => {
              const noteName = pitchLabel(pitch);
              const isC = Math.abs(pitch % 12) < 0.01 || Math.abs(pitch % 12 - 12) < 0.01;
              return (
                <Animated.View key={`lbl-${pitch}`} style={[styles.label, { width: labelW }, g.labelSizeStyle, isC && styles.labelC]}>
                  <Text style={[styles.labelText, isC && styles.labelTextC]}>{noteName}</Text>
                </Animated.View>
              );
            })}
            <Animated.View style={bottomSpacerStyle} />
          </Animated.View>
        </View>
        {/* Corner — fixed */}
        <View style={[styles.corner, { width: labelW, height: headerH }]}>
          <Text style={styles.cornerText}>Edit</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  clip: { position: 'absolute', right: 0, bottom: 0, overflow: 'hidden' },
  headerClip: { top: 0, bottom: undefined, backgroundColor: COLORS.panelBg, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)', zIndex: 2 },
  labelClip: { left: 0, right: undefined, backgroundColor: COLORS.panelBg, zIndex: 1 },
  headerRow: { flexDirection: 'row' },
  colHeader: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 2, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)' },
  colHeaderSelected: { backgroundColor: 'rgba(0,0,0,0.04)' },
  colNum: { fontSize: 11, fontWeight: '700', color: COLORS.text },
  muteBtn: { width: 11, height: 11, borderRadius: 5.5, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.2)', backgroundColor: 'transparent' },
  groupStart: { borderLeftWidth: 1.5, borderLeftColor: 'rgba(0,0,0,0.12)' },
  row: { flexDirection: 'row' },
  label: { justifyContent: 'center', paddingLeft: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  labelC: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.12)' },
  labelText: { fontSize: 9, color: COLORS.textDim },
  labelTextC: { fontWeight: '700', color: COLORS.text },
  corner: { position: 'absolute', top: 0, left: 0, zIndex: 3, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.panelBg, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)' },
  cornerText: { fontSize: 11, fontWeight: '600', color: COLORS.textDim },
  drumLabel: { fontSize: 12, fontWeight: '700', color: COLORS.text },
  drumCell: { flex: 1, justifyContent: 'center', alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  drumCellSelected: { backgroundColor: 'rgba(0,0,0,0.03)' },
  drumDot: { width: 24, height: 24, borderRadius: 12 },
});
