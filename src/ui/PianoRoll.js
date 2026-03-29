import React, { useMemo, useRef, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedReaction, runOnJS } from 'react-native-reanimated';
import { COLORS, NOTE_NAMES, PITCH, DRUM_TIMBRES, DRUM_SLOTS } from '../constants.js';
import { updateState, safePanelScene } from '../state.js';
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
  return name + octave + (cents > 0 ? '+' : '') + cents + '\u00A2';
}

export default function PianoRoll({ shape, color }) {
  if (!shape) return null;
  if (DRUM_TIMBRES.has(shape.timbre)) return <DrumGrid shape={shape} color={color} />;
  return <MelodicGrid shape={shape} color={color} />;
}

// ── Stable zoom persister for runOnJS ────────────────────────
function persistZoom(h, v) {
  updateState(s => {
    s.ui.rollZoom = Math.round(h * 100) / 100;
    s.ui.rollZoomV = Math.round(v * 100) / 100;
  });
}

// ── Gesture + layout hook ────────────────────────────────────
// No ScrollView. All interaction via Gesture.Simultaneous(pan, pinch).
// Content position driven by offsetX/offsetY shared values on UI thread.
function usePianoGestures() {
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const rollZoomV = useStore(s => s.ui.rollZoomV || 1.0);

  // Position
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);
  // Zoom on UI thread (live — set by worklet during pinch)
  const zoomH = useSharedValue(rollZoom);
  const zoomV = useSharedValue(rollZoomV);
  // React-committed zoom (follows React state, for scale transform ratio)
  const reactZoomH = useSharedValue(rollZoom);
  const reactZoomV = useSharedValue(rollZoomV);
  // Sync immediately on every render to avoid 1-frame lag vs useEffect
  reactZoomH.value = rollZoom;
  reactZoomV.value = rollZoomV;
  // Pinch state
  const isPinching = useSharedValue(false);
  const wasPinching = useSharedValue(false); // for post-pinch drag
  const pinchAxis = useSharedValue(0); // 0=none, 1=H, 2=V
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

  // Sync zoom: React state → shared values
  useEffect(() => { zoomH.value = rollZoom; }, [rollZoom]);
  useEffect(() => { zoomV.value = rollZoomV; }, [rollZoomV]);

  // Worklet clamp helpers
  function clampX(x) {
    'worklet';
    const cw = sv_totalCols.value * Math.max(20, Math.round(sv_baseCellW.value * zoomH.value));
    return Math.max(Math.min(0, sv_viewW.value - cw), Math.min(0, x));
  }
  function clampY(y) {
    'worklet';
    const ch = sv_totalRows.value * Math.max(sv_minCellH.value, Math.round(sv_baseCellH.value * zoomV.value));
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
        // Axis detection with dead zone
        const ratio = dx / (dy + 0.001);
        if (ratio > 1.5) pinchAxis.value = 1;        // clearly horizontal
        else if (ratio < 0.67) pinchAxis.value = 2;   // clearly vertical
        else pinchAxis.value = 1;                      // ambiguous → default horizontal
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

      const dampened = Math.pow(e.scale, 0.65); // more responsive than 0.5

      if (pinchAxis.value === 1) {
        // Horizontal zoom
        const newZH = Math.min(4.0, Math.max(1.0, pinchStartZH.value * dampened));
        const zRatio = newZH / pinchStartZH.value;
        // Anchor-point: keep content under focal point stationary
        let newOX = pinchFocalX.value - (pinchFocalX.value - pinchStartOX.value) * zRatio;
        const cw = sv_totalCols.value * Math.max(20, Math.round(sv_baseCellW.value * newZH));
        const minX = Math.min(0, sv_viewW.value - cw);
        newOX = Math.max(minX, Math.min(0, newOX));
        offsetX.value = newOX;
        zoomH.value = newZH;
        runOnJS(persistZoom)(newZH, zoomV.value);
      } else if (pinchAxis.value === 2) {
        // Vertical zoom
        const newZV = Math.min(3.0, Math.max(0.6, pinchStartZV.value * dampened));
        const zRatio = newZV / pinchStartZV.value;
        let newOY = pinchFocalY.value - (pinchFocalY.value - pinchStartOY.value) * zRatio;
        const ch = sv_totalRows.value * Math.max(sv_minCellH.value, Math.round(sv_baseCellH.value * newZV));
        const minY = Math.min(0, sv_viewH.value - ch);
        newOY = Math.max(minY, Math.min(0, newOY));
        offsetY.value = newOY;
        zoomV.value = newZV;
        runOnJS(persistZoom)(zoomH.value, newZV);
      }
    })
    .onEnd(() => {
      'worklet';
      isPinching.value = false;
      wasPinching.value = false;
      pinchAxis.value = 0;
    })
    .onFinalize(() => {
      'worklet';
      isPinching.value = false;
      wasPinching.value = false;
      pinchAxis.value = 0;
    }),
  []);

  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), []);

  // ── Animated styles with scale compensation ─────────────────
  // During pinch, zoomH/V (worklet) lead reactZoomH/V (React state).
  // The scale transform bridges the 1-frame gap so visual zoom is instant
  // while cellH catches up asynchronously via React re-render.
  const gridStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scaleX: zoomH.value / reactZoomH.value },
      { scaleY: zoomV.value / reactZoomV.value },
    ],
    transformOrigin: 'left top',
  }));
  const headerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { scaleX: zoomH.value / reactZoomH.value },
    ],
    transformOrigin: 'left top',
  }));
  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: offsetY.value },
      { scaleY: zoomV.value / reactZoomV.value },
    ],
    transformOrigin: 'left top',
  }));

  return {
    gesture, gridStyle, headerStyle, labelStyle,
    offsetX, offsetY, zoomH, zoomV,
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
  const cellW = Math.max(20, Math.round(baseDrumW * g.rollZoom));
  const cellH = Math.round(48 * g.rollZoomV);
  const headerH = Math.round(36 * g.rollZoomV);
  const slotLabels = DRUM_SLOTS || ['Kick', 'Snare', 'HiHat', 'Perc'];
  const viewW = screenWidth - labelW;
  const viewH = screenHeight * 0.45 - headerH;

  // Sync grid dimensions → shared values for worklet clamping
  useEffect(() => { g.sv_totalCols.value = totalCols; }, [totalCols]);
  useEffect(() => { g.sv_baseCellW.value = baseDrumW; }, [baseDrumW]);
  useEffect(() => { g.sv_totalRows.value = slotLabels.length; }, [slotLabels.length]);
  useEffect(() => { g.sv_baseCellH.value = 48; }, []);
  useEffect(() => { g.sv_minCellH.value = 1; }, []); // drums have no min cell height
  useEffect(() => { g.sv_viewW.value = viewW; }, [viewW]);
  useEffect(() => { g.sv_viewH.value = viewH; }, [viewH]);
  useEffect(() => { g.sv_labelW.value = labelW; }, []);
  useEffect(() => { g.sv_headerH.value = headerH; }, [headerH]);

  // Reset position on shape change
  const prevId = useRef(shape.id);
  useEffect(() => {
    if (prevId.current !== shape.id) {
      prevId.current = shape.id;
      g.offsetX.value = 0;
      g.offsetY.value = 0;
    }
  }, [shape.id]);

  function toggleSlot(vi, si, slotIdx) {
    updateState(s => {
      const scene = safePanelScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shape.id);
      if (!sh || !sh.vertices[vi]) return;
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
  }

  return (
    <GestureDetector gesture={g.gesture}>
      <View style={styles.container}>
        {/* Grid content — scrolls both X and Y */}
        <View style={[styles.clip, { left: labelW, top: headerH }]}>
          <Animated.View style={g.gridStyle}>
            {slotLabels.map((slot, slotIdx) => (
              <View key={`dr-${slotIdx}`} style={styles.row}>
                {Array.from({ length: shape.sides }).map((_, vi) =>
                  Array.from({ length: sub }).map((_, s) => {
                    const stepData = getStepData(shape.vertices[vi], s);
                    const pitches = stepData ? (stepData.pitches || []) : [];
                    const isActive = pitches.includes(slotIdx);
                    return (
                      <Pressable key={`dc-${vi}-${s}-${slotIdx}`}
                        style={[styles.drumCell, { width: cellW, height: cellH },
                          s === 0 && vi > 0 && styles.groupStart,
                          vi === selectedNode && styles.drumCellSelected]}
                        onPress={() => toggleSlot(vi, s, slotIdx)}>
                        <View style={[styles.drumDot, isActive ? { backgroundColor: color.main } : { backgroundColor: 'rgba(0,0,0,0.06)' }]} />
                      </Pressable>
                    );
                  })
                )}
              </View>
            ))}
          </Animated.View>
        </View>
        {/* Column headers — scrolls X, pinned Y */}
        <View style={[styles.clip, styles.headerClip, { left: labelW, height: headerH }]}>
          <Animated.View style={[styles.headerRow, g.headerStyle]}>
            {Array.from({ length: shape.sides }).map((_, vi) =>
              Array.from({ length: sub }).map((_, s) => {
                const sel = vi === selectedNode;
                return (
                  <View key={`dh-${vi}-${s}`} style={[styles.colHeader, { width: cellW, height: headerH },
                    sel && styles.colHeaderSelected, s === 0 && vi > 0 && styles.groupStart]}>
                    <Text style={[styles.colNum, sel && { color: color.main, fontWeight: '700' }]}>{s === 0 ? vi + 1 : ''}</Text>
                  </View>
                );
              })
            )}
          </Animated.View>
        </View>
        {/* Row labels — scrolls Y, pinned X */}
        <View style={[styles.clip, styles.labelClip, { top: headerH, width: labelW }]}>
          <Animated.View style={g.labelStyle}>
            {slotLabels.map((slot, slotIdx) => (
              <View key={`dl-${slotIdx}`} style={[styles.label, { width: labelW, height: cellH }]}>
                <Text style={styles.drumLabel}>{slot.charAt(0).toUpperCase() + slot.slice(1)}</Text>
              </View>
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
const ROW_BUFFER = 4;

function MelodicGrid({ shape, color }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scale = useStore(s => s.scale);
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const g = usePianoGestures();

  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;
  const labelW = 42;
  const baseCellW = (screenWidth - labelW) / totalCols;
  const cellW = Math.max(20, Math.round(baseCellW * g.rollZoom));
  const cellH = Math.max(14, Math.round(28 * g.rollZoomV));
  const headerH = Math.round(44 * Math.min(g.rollZoomV, 1.5));

  const rows = useMemo(() => buildRows(scale, shape), [scale, shape]);
  const viewW = screenWidth - labelW;
  const viewH = screenHeight * 0.45 - headerH;

  // Sync grid dimensions → shared values for worklet clamping
  useEffect(() => { g.sv_totalCols.value = totalCols; }, [totalCols]);
  useEffect(() => { g.sv_baseCellW.value = baseCellW; }, [baseCellW]);
  useEffect(() => { g.sv_totalRows.value = rows.length; }, [rows.length]);
  useEffect(() => { g.sv_baseCellH.value = 28; }, []);
  useEffect(() => { g.sv_minCellH.value = 14; }, []); // melodic min cell height
  useEffect(() => { g.sv_viewW.value = viewW; }, [viewW]);
  useEffect(() => { g.sv_viewH.value = viewH; }, [viewH]);
  useEffect(() => { g.sv_labelW.value = labelW; }, []);
  useEffect(() => { g.sv_headerH.value = headerH; }, [headerH]);

  // ── Row windowing ──────────────────────────────────────────
  const [scrollY, setScrollY] = useState(0);
  const _offsetY = g.offsetY;
  const _thresholdSV = useSharedValue(Math.max(1, cellH * 2));
  const _lastWinY = useSharedValue(0);
  useEffect(() => { _thresholdSV.value = Math.max(1, cellH * 2); }, [cellH]);

  useAnimatedReaction(
    () => { 'worklet'; return _offsetY.value; },
    (oy, prevOy) => {
      'worklet';
      const absY = Math.max(0, -oy);
      if (prevOy === null || Math.abs(absY - _lastWinY.value) > _thresholdSV.value) {
        _lastWinY.value = absY;
        runOnJS(setScrollY)(absY);
      }
    }, []
  );

  const firstVisible = Math.max(0, Math.floor(scrollY / Math.max(1, cellH)) - ROW_BUFFER);
  const lastVisible = Math.min(rows.length - 1, Math.ceil((scrollY + viewH) / Math.max(1, cellH)) + ROW_BUFFER);
  const visibleRows = rows.slice(firstVisible, lastVisible + 1);
  const topSpacer = firstVisible * cellH;
  const bottomSpacer = Math.max(0, (rows.length - lastVisible - 1) * cellH);

  // ── Initial scroll to shape's pitch area ──
  const hasScrolledInit = useRef(null);
  useEffect(() => {
    if (hasScrolledInit.current === shape.id || rows.length === 0) return;
    hasScrolledInit.current = shape.id;
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
    const targetY = Math.max(0, targetIdx * cellH - cellH * 3);
    g.offsetY.value = -targetY;
    _lastWinY.value = targetY;
    setScrollY(targetY);
  }, [shape.id]);

  // Reset X on shape change
  const prevId = useRef(shape.id);
  useEffect(() => {
    if (prevId.current !== shape.id) { prevId.current = shape.id; g.offsetX.value = 0; }
  }, [shape.id]);

  function toggleMute(vi, si) {
    updateState(s => {
      const scene = safePanelScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shape.id);
      if (!sh || !sh.vertices[vi]) return;
      const sd = si === 0 ? sh.vertices[vi] : (sh.vertices[vi].subs && sh.vertices[vi].subs[si - 1]);
      if (sd) sd.muted = !sd.muted;
    });
  }

  return (
    <GestureDetector gesture={g.gesture}>
      <View style={styles.container}>
        {/* Grid content — scrolls both X and Y */}
        <View style={[styles.clip, { left: labelW, top: headerH }]}>
          <Animated.View style={g.gridStyle}>
            {topSpacer > 0 && <View style={{ height: topSpacer }} />}
            {visibleRows.map(pitch => {
              const isC = Math.abs(pitch % 12) < 0.01 || Math.abs(pitch % 12 - 12) < 0.01;
              return (
                <View key={`row-${pitch}`} style={styles.row}>
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
                        <PianoRollCell key={`cell-${vi}-${s}-${pitch}`} shapeId={shape.id} vertexIndex={vi} stepIndex={s} pitch={pitch} isActive={isActive} isMuted={isMuted} velocity={vel} color={color} isSelectedColumn={sel} isC={isC} isGroupStart={isFirst && vi > 0} cellWidth={cellW} cellHeight={cellH} />
                      );
                    })
                  )}
                </View>
              );
            })}
            {bottomSpacer > 0 && <View style={{ height: bottomSpacer }} />}
          </Animated.View>
        </View>
        {/* Column headers — scrolls X, pinned Y */}
        <View style={[styles.clip, styles.headerClip, { left: labelW, height: headerH }]}>
          <Animated.View style={[styles.headerRow, g.headerStyle]}>
            {Array.from({ length: shape.sides }).map((_, vi) =>
              Array.from({ length: sub }).map((_, s) => {
                const isFirst = s === 0;
                const sel = vi === selectedNode;
                const stepData = getStepData(shape.vertices[vi], s);
                const muted = stepData ? stepData.muted : false;
                return (
                  <View key={`hdr-${vi}-${s}`} style={[styles.colHeader, { width: cellW, height: headerH },
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
        </View>
        {/* Row labels — scrolls Y, pinned X */}
        <View style={[styles.clip, styles.labelClip, { top: headerH, width: labelW }]}>
          <Animated.View style={g.labelStyle}>
            {topSpacer > 0 && <View style={{ height: topSpacer }} />}
            {visibleRows.map(pitch => {
              const noteName = pitchLabel(pitch);
              const isC = Math.abs(pitch % 12) < 0.01 || Math.abs(pitch % 12 - 12) < 0.01;
              return (
                <View key={`lbl-${pitch}`} style={[styles.label, { width: labelW, height: cellH }, isC && styles.labelC]}>
                  <Text style={[styles.labelText, isC && styles.labelTextC]}>{noteName}</Text>
                </View>
              );
            })}
            {bottomSpacer > 0 && <View style={{ height: bottomSpacer }} />}
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
  colHeader: { justifyContent: 'center', alignItems: 'center', gap: 2, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)' },
  colHeaderSelected: { backgroundColor: 'rgba(0,0,0,0.04)' },
  colNum: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  muteBtn: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)', backgroundColor: 'transparent' },
  groupStart: { borderLeftWidth: 1.5, borderLeftColor: 'rgba(0,0,0,0.12)' },
  row: { flexDirection: 'row' },
  label: { justifyContent: 'center', paddingLeft: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  labelC: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.12)' },
  labelText: { fontSize: 9, color: COLORS.textDim },
  labelTextC: { fontWeight: '700', color: COLORS.text },
  corner: { position: 'absolute', top: 0, left: 0, zIndex: 3, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.panelBg, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)' },
  cornerText: { fontSize: 11, fontWeight: '500', color: COLORS.textDim },
  drumLabel: { fontSize: 12, fontWeight: '600', color: COLORS.text },
  drumCell: { justifyContent: 'center', alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  drumCellSelected: { backgroundColor: 'rgba(0,0,0,0.03)' },
  drumDot: { width: 24, height: 24, borderRadius: 12 },
});
