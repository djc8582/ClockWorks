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
    const minOctave = Math.floor(PITCH.min / 12);
    const maxOctave = Math.floor(PITCH.max / 12);
    for (let oct = minOctave; oct <= maxOctave; oct++) {
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
    if (v && v.subs) {
      for (const sub of v.subs) {
        if (sub && sub.pitches) for (const p of sub.pitches) rowSet.add(p);
      }
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
  const isDrum = DRUM_TIMBRES.has(shape.timbre);
  if (isDrum) return <DrumGrid shape={shape} color={color} />;
  return <MelodicGrid shape={shape} color={color} />;
}

// ── Module-level zoom setters (stable refs for runOnJS) ──────
function setZoomH(z) { updateState(s => { s.ui.rollZoom = z; }); }
function setZoomV(z) { updateState(s => { s.ui.rollZoomV = z; }); }

// ── Gesture hook: pan + pinch, no ScrollView ─────────────────
// Architecture B: all interaction via Gesture.Simultaneous(pan, pinch).
// Pan = 1-finger drag. Pinch = 2-finger axis-locked focal-point zoom.
function usePianoGestures() {
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const rollZoomV = useStore(s => s.ui.rollZoomV || 1.0);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const isPinching = useSharedValue(false);
  const axis = useSharedValue(0);
  const savedFX = useSharedValue(0);
  const savedFY = useSharedValue(0);
  const savedTX = useSharedValue(0);
  const savedTY = useSharedValue(0);
  const savedZH = useSharedValue(1);
  const savedZV = useSharedValue(1);
  const panSTX = useSharedValue(0);
  const panSTY = useSharedValue(0);
  const minTX = useSharedValue(0);
  const minTY = useSharedValue(0);

  useEffect(() => { savedZH.value = rollZoom; }, [rollZoom]);
  useEffect(() => { savedZV.value = rollZoomV; }, [rollZoomV]);

  const pan = useMemo(() => Gesture.Pan()
    .onStart(() => {
      'worklet';
      panSTX.value = translateX.value;
      panSTY.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (e.numberOfPointers === 1 && !isPinching.value) {
        translateX.value = Math.max(minTX.value, Math.min(0, panSTX.value + e.translationX));
        translateY.value = Math.max(minTY.value, Math.min(0, panSTY.value + e.translationY));
      }
    }), []);

  const pinch = useMemo(() => Gesture.Pinch()
    .onTouchesDown((e) => {
      'worklet';
      if (e.numberOfTouches >= 2) {
        isPinching.value = true;
        const t = e.allTouches;
        axis.value = Math.abs(t[0].x - t[1].x) > Math.abs(t[0].y - t[1].y) ? 1 : 2;
      }
    })
    .onStart((e) => {
      'worklet';
      savedFX.value = e.focalX;
      savedFY.value = e.focalY;
      savedTX.value = translateX.value;
      savedTY.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      // Finger lifted mid-pinch: transition to pan
      if (e.numberOfPointers === 1 && isPinching.value) {
        isPinching.value = false;
        panSTX.value = translateX.value;
        panSTY.value = translateY.value;
        return;
      }
      if (e.numberOfPointers !== 2) return;
      const d = Math.pow(e.scale, 0.5);
      if (axis.value === 1) {
        const nz = Math.round(Math.min(4.0, Math.max(1.0, savedZH.value * d)) * 100) / 100;
        const r = nz / savedZH.value;
        translateX.value = savedFX.value - (savedFX.value - savedTX.value) * r;
        runOnJS(setZoomH)(nz);
      } else if (axis.value === 2) {
        const nz = Math.round(Math.min(3.0, Math.max(0.6, savedZV.value * d)) * 100) / 100;
        const r = nz / savedZV.value;
        translateY.value = savedFY.value - (savedFY.value - savedTY.value) * r;
        runOnJS(setZoomV)(nz);
      }
    })
    .onEnd(() => { 'worklet'; isPinching.value = false; axis.value = 0; })
    .onFinalize(() => { 'worklet'; isPinching.value = false; axis.value = 0; }),
  []);

  const gesture = useMemo(() => Gesture.Simultaneous(pan, pinch), []);

  const gridStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));
  const headerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return { gesture, gridStyle, headerStyle, labelStyle, translateX, translateY, minTX, minTY, rollZoom, rollZoomV };
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

  useEffect(() => { g.minTX.value = Math.min(0, viewW - totalCols * cellW); }, [totalCols, cellW, viewW]);
  useEffect(() => { g.minTY.value = Math.min(0, viewH - slotLabels.length * cellH); }, [cellH, viewH]);

  // Reset position when shape changes
  const prevId = useRef(shape.id);
  useEffect(() => {
    if (prevId.current !== shape.id) { prevId.current = shape.id; g.translateX.value = 0; g.translateY.value = 0; }
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
        {/* Grid */}
        <Animated.View style={[{ position: 'absolute', left: labelW, top: headerH, right: 0, bottom: 0, overflow: 'hidden' }]}>
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
                          s === 0 && vi > 0 && styles.groupStart, vi === selectedNode && styles.drumCellSelected]}
                        onPress={() => toggleSlot(vi, s, slotIdx)}>
                        <View style={[styles.drumDot, isActive ? { backgroundColor: color.main } : { backgroundColor: 'rgba(0,0,0,0.06)' }]} />
                      </Pressable>
                    );
                  })
                )}
              </View>
            ))}
          </Animated.View>
        </Animated.View>
        {/* Headers */}
        <Animated.View style={[{ position: 'absolute', left: labelW, top: 0, right: 0, height: headerH, overflow: 'hidden', backgroundColor: COLORS.panelBg, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)', zIndex: 2 }]}>
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
        </Animated.View>
        {/* Labels */}
        <Animated.View style={[{ position: 'absolute', left: 0, top: headerH, width: labelW, bottom: 0, overflow: 'hidden', backgroundColor: COLORS.panelBg, zIndex: 1 }]}>
          <Animated.View style={g.labelStyle}>
            {slotLabels.map((slot, slotIdx) => (
              <View key={`dl-${slotIdx}`} style={[styles.label, { width: labelW, height: cellH }]}>
                <Text style={styles.drumLabel}>{slot.charAt(0).toUpperCase() + slot.slice(1)}</Text>
              </View>
            ))}
          </Animated.View>
        </Animated.View>
        {/* Corner */}
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

  // Sync bounds
  useEffect(() => { g.minTX.value = Math.min(0, viewW - totalCols * cellW); }, [totalCols, cellW, viewW]);
  useEffect(() => { g.minTY.value = Math.min(0, viewH - rows.length * cellH); }, [rows.length, cellH, viewH]);

  // ── Row windowing via useAnimatedReaction ──
  const [scrollY, setScrollY] = useState(0);
  const windowThreshold = useSharedValue(cellH * 2);
  const lastWindowY = useSharedValue(0);
  useEffect(() => { windowThreshold.value = Math.max(1, cellH * 2); }, [cellH]);

  const _translateY = g.translateY;
  useAnimatedReaction(
    () => { 'worklet'; return _translateY.value; },
    (ty) => {
      'worklet';
      const absY = Math.max(0, -ty);
      if (Math.abs(absY - lastWindowY.value) > windowThreshold.value) {
        lastWindowY.value = absY;
        runOnJS(setScrollY)(absY);
      }
    }, []
  );

  const firstVisible = Math.max(0, Math.floor(scrollY / Math.max(1, cellH)) - ROW_BUFFER);
  const lastVisible = Math.min(rows.length - 1, Math.ceil((scrollY + viewH) / Math.max(1, cellH)) + ROW_BUFFER);
  const visibleRows = rows.slice(firstVisible, lastVisible + 1);
  const topSpacer = firstVisible * cellH;
  const bottomSpacer = Math.max(0, (rows.length - lastVisible - 1) * cellH);

  // ── Initial scroll to pitch area ──
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
    g.translateY.value = -targetY;
    lastWindowY.value = targetY;
    setScrollY(targetY);
  }, [shape.id]);

  // Reset X when shape changes
  const prevId = useRef(shape.id);
  useEffect(() => {
    if (prevId.current !== shape.id) { prevId.current = shape.id; g.translateX.value = 0; }
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
        {/* Grid */}
        <Animated.View style={[{ position: 'absolute', left: labelW, top: headerH, right: 0, bottom: 0, overflow: 'hidden' }]}>
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
        </Animated.View>
        {/* Headers */}
        <Animated.View style={[{ position: 'absolute', left: labelW, top: 0, right: 0, height: headerH, overflow: 'hidden', backgroundColor: COLORS.panelBg, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)', zIndex: 2 }]}>
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
        </Animated.View>
        {/* Labels */}
        <Animated.View style={[{ position: 'absolute', left: 0, top: headerH, width: labelW, bottom: 0, overflow: 'hidden', backgroundColor: COLORS.panelBg, zIndex: 1 }]}>
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
        </Animated.View>
        {/* Corner */}
        <View style={[styles.corner, { width: labelW, height: headerH }]}>
          <Text style={styles.cornerText}>Edit</Text>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
