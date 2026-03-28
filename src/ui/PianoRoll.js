import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedProps, runOnJS } from 'react-native-reanimated';
import { COLORS, NOTE_NAMES, PITCH, DRUM_TIMBRES, DRUM_SLOTS } from '../constants.js';

// Use Reanimated's Animated.ScrollView (wraps RN's ScrollView, NOT RNGH's).
// RNGH's ScrollView has a pre-applied NativeViewGestureHandler that conflicts
// with external pinch gestures (confirmed by maintainer in RNGH issue #3266).
import { updateState, safePanelScene } from '../state.js';
import { useStore } from '../hooks/useStore.js';
import PianoRollCell from './PianoRollCell.js';

function getStepData(vertex, stepIndex) {
  if (stepIndex === 0) return vertex;
  return vertex.subs && vertex.subs[stepIndex - 1];
}

function buildRows(scale, shape) {
  const rowSet = new Set();
  // Check if scale has any fractional pitch classes (microtonal)
  const hasFractional = scale.some(pc => pc !== Math.floor(pc));

  if (hasFractional) {
    // Microtonal: generate rows for each octave × each fractional PC
    const minOctave = Math.floor(PITCH.min / 12);
    const maxOctave = Math.floor(PITCH.max / 12);
    for (let oct = minOctave; oct <= maxOctave; oct++) {
      for (const pc of scale) {
        const pitch = Math.round((oct * 12 + pc) * 100) / 100;
        if (pitch >= PITCH.min && pitch <= PITCH.max) rowSet.add(pitch);
      }
    }
  } else {
    // Standard 12-TET: integer pitch classes
    const scaleSet = new Set(scale);
    for (let p = PITCH.max; p >= PITCH.min; p--) {
      if (scaleSet.has(((p % 12) + 12) % 12)) rowSet.add(p);
    }
  }

  // Include any active pitches from the shape
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

// Label for a pitch — handles fractional (microtonal) pitches
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
  const isDrum = DRUM_TIMBRES.has(shape.timbre);
  if (isDrum) return <DrumGrid shape={shape} color={color} />;
  return <MelodicGrid shape={shape} color={color} />;
}

// ── Pinch-to-zoom — worklet callbacks on UI thread ─────────
// Key: ScrollView is from react-native (not RNGH), wrapped with Gesture.Native()
// using simultaneousWithExternalGesture to coexist with the pinch gesture.
// isPinching shared value disables scroll via animatedProps synchronously.
function usePianoZoom(rollZoomH, rollZoomV) {
  const isPinching = useSharedValue(false);
  const axis = useSharedValue(0);
  const startZoomH = useSharedValue(1);
  const startZoomV = useSharedValue(1);
  const currentZoomH = useSharedValue(rollZoomH);
  const currentZoomV = useSharedValue(rollZoomV);

  useEffect(() => { currentZoomH.value = rollZoomH; }, [rollZoomH]);
  useEffect(() => { currentZoomV.value = rollZoomV; }, [rollZoomV]);

  function persistZoom(h, v) {
    updateState(s => { s.ui.rollZoom = h; s.ui.rollZoomV = v; });
  }

  const pinch = useMemo(() =>
    Gesture.Pinch()
      .onTouchesDown((e) => {
        'worklet';
        if (e.numberOfTouches >= 2) {
          isPinching.value = true;
          const t = e.allTouches;
          const dx = Math.abs(t[0].x - t[1].x);
          const dy = Math.abs(t[0].y - t[1].y);
          axis.value = dx > dy ? 1 : 2;
        }
      })
      .onStart(() => {
        'worklet';
        startZoomH.value = currentZoomH.value;
        startZoomV.value = currentZoomV.value;
      })
      .onUpdate((e) => {
        'worklet';
        const dampened = Math.pow(e.scale, 0.5);
        if (axis.value === 1) {
          const z = Math.min(4.0, Math.max(1.0, startZoomH.value * dampened));
          currentZoomH.value = Math.round(z * 100) / 100;
        } else if (axis.value === 2) {
          const z = Math.min(3.0, Math.max(0.6, startZoomV.value * dampened));
          currentZoomV.value = Math.round(z * 100) / 100;
        }
        runOnJS(persistZoom)(currentZoomH.value, currentZoomV.value);
      })
      .onEnd(() => { 'worklet'; isPinching.value = false; axis.value = 0; })
      .onFinalize(() => { 'worklet'; isPinching.value = false; axis.value = 0; }),
    []
  );

  // Gesture.Native() wrappers tell native gesture system about scroll↔pinch relationship
  const nativeOuter = useMemo(() => Gesture.Native().simultaneousWithExternalGesture(pinch), [pinch]);
  const nativeInner = useMemo(() => Gesture.Native().simultaneousWithExternalGesture(pinch), [pinch]);

  const outerAnimatedProps = useAnimatedProps(() => ({
    scrollEnabled: !isPinching.value,
  }));
  const innerAnimatedProps = useAnimatedProps(() => ({
    scrollEnabled: !isPinching.value,
  }));

  return { pinch, nativeOuter, nativeInner, outerAnimatedProps, innerAnimatedProps };
}

// ── Scroll helpers ───────────────────────────────────────────
// Disables outer vertical scroll while inner horizontal is active
function useNestedScroll(shapeId) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const prevShapeId = useRef(shapeId);
  const [outerEnabled, setOuterEnabled] = useState(true);

  const onOuterScroll = useCallback((e) => {
    pos.current.y = e.nativeEvent.contentOffset.y;
  }, []);
  const onInnerScroll = useCallback((e) => {
    pos.current.x = e.nativeEvent.contentOffset.x;
  }, []);

  // Disable outer while inner is scrolling
  const onInnerDragStart = useCallback(() => setOuterEnabled(false), []);
  const onInnerDragEnd = useCallback(() => setOuterEnabled(true), []);
  const onInnerMomentumEnd = useCallback(() => setOuterEnabled(true), []);

  useEffect(() => {
    if (prevShapeId.current !== shapeId) {
      pos.current = { x: 0, y: 0 };
      prevShapeId.current = shapeId;
      return;
    }
    if (pos.current.y > 0 && outerRef.current) {
      outerRef.current.scrollTo({ y: pos.current.y, animated: false });
    }
    if (pos.current.x > 0 && innerRef.current) {
      innerRef.current.scrollTo({ x: pos.current.x, animated: false });
    }
  }, [shapeId]);

  return { outerRef, innerRef, onOuterScroll, onInnerScroll, onInnerDragStart, onInnerDragEnd, onInnerMomentumEnd, outerEnabled, pos };
}

// ── Drum step sequencer ──────────────────────────────────────
function DrumGrid({ shape, color }) {
  const { width: screenWidth } = useWindowDimensions();
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const rollZoomV = useStore(s => s.ui.rollZoomV || 1.0);
  const { pinch, nativeOuter, nativeInner, outerAnimatedProps, innerAnimatedProps } = usePianoZoom(rollZoom, rollZoomV);
  const { outerRef, innerRef, onOuterScroll, onInnerScroll, onInnerDragStart, onInnerDragEnd, onInnerMomentumEnd, outerEnabled } = useNestedScroll(shape.id);
  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;

  const baseDrumW = (screenWidth - 70) / totalCols;
  const cellW = Math.max(20, Math.round(baseDrumW * rollZoom));
  const cellH = Math.round(48 * rollZoomV);
  const headerH = Math.round(36 * rollZoomV);
  const slotLabels = DRUM_SLOTS || ['Kick', 'Snare', 'HiHat', 'Perc'];

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
    <GestureDetector gesture={pinch}>
    <View style={{ flex: 1 }}>
    <GestureDetector gesture={nativeOuter}>
    <Animated.ScrollView
      ref={outerRef}
      style={styles.outerScroll}
      nestedScrollEnabled
      directionalLockEnabled
      animatedProps={outerAnimatedProps}
      onScroll={onOuterScroll}
      scrollEventThrottle={16}
    >
      <GestureDetector gesture={nativeInner}>
      <Animated.ScrollView
        ref={innerRef}
        horizontal
        style={styles.innerScroll}
        nestedScrollEnabled
        directionalLockEnabled
        animatedProps={innerAnimatedProps}
        onScroll={onInnerScroll}
        scrollEventThrottle={16}
      >
        <View>
          <View style={[styles.headerRow, { height: headerH }]}>
            <View style={[styles.cornerCell, { width: 70 }]}>
              <Text style={styles.cornerText}>Step</Text>
            </View>
            {Array.from({ length: shape.sides }).map((_, vi) =>
              Array.from({ length: sub }).map((_, s) => {
                const sel = vi === selectedNode;
                return (
                  <View key={`dh-${vi}-${s}`} style={[styles.colHeader, { width: cellW, height: headerH }, sel && styles.colHeaderSelected, s === 0 && vi > 0 && styles.groupStart]}>
                    <Text style={[styles.colNum, sel && { color: color.main, fontWeight: '700' }]}>{s === 0 ? vi + 1 : ''}</Text>
                  </View>
                );
              })
            )}
          </View>
          {slotLabels.map((slot, slotIdx) => {
            const label = slot.charAt(0).toUpperCase() + slot.slice(1);
            return (
              <View key={`drum-${slotIdx}`} style={styles.row}>
                <View style={[styles.label, { width: 70, height: cellH }]}>
                  <Text style={styles.drumLabel}>{label}</Text>
                </View>
                {Array.from({ length: shape.sides }).map((_, vi) =>
                  Array.from({ length: sub }).map((_, s) => {
                    const stepData = getStepData(shape.vertices[vi], s);
                    const pitches = stepData ? (stepData.pitches || []) : [];
                    const isActive = pitches.includes(slotIdx);
                    return (
                      <Pressable key={`dc-${vi}-${s}-${slotIdx}`} style={[styles.drumCell, { width: cellW, height: cellH }, s === 0 && vi > 0 && styles.groupStart, vi === selectedNode && styles.drumCellSelected]} onPress={() => toggleSlot(vi, s, slotIdx)}>
                        <View style={[styles.drumDot, isActive ? { backgroundColor: color.main } : { backgroundColor: 'rgba(0,0,0,0.06)' }]} />
                      </Pressable>
                    );
                  })
                )}
              </View>
            );
          })}
        </View>
      </Animated.ScrollView>
      </GestureDetector>
    </Animated.ScrollView>
    </GestureDetector>
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
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const rollZoomV = useStore(s => s.ui.rollZoomV || 1.0);
  const { pinch, nativeOuter, nativeInner, outerAnimatedProps, innerAnimatedProps } = usePianoZoom(rollZoom, rollZoomV);
  const { outerRef, innerRef, onOuterScroll: baseOuterScroll, onInnerScroll, onInnerDragStart, onInnerDragEnd, onInnerMomentumEnd, outerEnabled, pos } = useNestedScroll(shape.id);

  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;
  const labelW = 42;
  const availableWidth = screenWidth - labelW;
  const baseCellW = availableWidth / totalCols;
  const cellW = Math.max(20, Math.round(baseCellW * rollZoom));
  const cellH = Math.max(14, Math.round(28 * rollZoomV));
  const headerH = Math.round(44 * Math.min(rollZoomV, 1.5));

  const rows = useMemo(() => buildRows(scale, shape), [scale, shape]);

  const [scrollY, setScrollY] = useState(0);
  const scrollYRef = useRef(0);
  const onOuterScroll = useCallback((e) => {
    const y = e.nativeEvent.contentOffset.y;
    baseOuterScroll(e);
    scrollYRef.current = y;
    const prev = scrollYRef.prevWindow || 0;
    if (Math.abs(y - prev) > cellH * 2) {
      scrollYRef.prevWindow = y;
      setScrollY(y);
    }
  }, [baseOuterScroll, cellH]);

  const viewportH = screenHeight * 0.45;
  const firstVisible = Math.max(0, Math.floor(scrollY / Math.max(1, cellH)) - ROW_BUFFER);
  const lastVisible = Math.min(rows.length - 1, Math.ceil((scrollY + viewportH) / Math.max(1, cellH)) + ROW_BUFFER);
  const visibleRows = rows.slice(firstVisible, lastVisible + 1);
  const topSpacer = firstVisible * cellH;
  const bottomSpacer = Math.max(0, (rows.length - lastVisible - 1) * cellH);

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
    scrollYRef.current = targetY;
    scrollYRef.prevWindow = targetY;
    setScrollY(targetY);
    requestAnimationFrame(() => {
      outerRef.current?.scrollTo({ y: targetY, animated: false });
    });
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
    <GestureDetector gesture={pinch}>
    <View style={{ flex: 1 }}>
    <GestureDetector gesture={nativeOuter}>
    <Animated.ScrollView
      ref={outerRef}
      style={styles.outerScroll}
      nestedScrollEnabled
      directionalLockEnabled
      animatedProps={outerAnimatedProps}
      onScroll={onOuterScroll}
      scrollEventThrottle={16}
    >
      <GestureDetector gesture={nativeInner}>
      <Animated.ScrollView
        ref={innerRef}
        horizontal
        style={styles.innerScroll}
        nestedScrollEnabled
        directionalLockEnabled
        animatedProps={innerAnimatedProps}
        onScroll={onInnerScroll}
        scrollEventThrottle={16}
      >
          <View>
            <View style={[styles.headerRow, { height: headerH }]}>
              <View style={[styles.cornerCell, { width: labelW }]}>
                <Text style={styles.cornerText}>Edit</Text>
              </View>
              {Array.from({ length: shape.sides }).map((_, vi) =>
                Array.from({ length: sub }).map((_, s) => {
                  const isFirst = s === 0;
                  const sel = vi === selectedNode;
                  const stepData = getStepData(shape.vertices[vi], s);
                  const muted = stepData ? stepData.muted : false;
                  return (
                    <View key={`hdr-${vi}-${s}`} style={[styles.colHeader, { width: cellW, height: headerH }, sel && styles.colHeaderSelected, isFirst && vi > 0 && styles.groupStart]}>
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
            </View>

            {topSpacer > 0 && <View style={{ height: topSpacer }} />}
            {visibleRows.map(pitch => {
              const noteName = pitchLabel(pitch);
              const isC = Math.abs(pitch % 12) < 0.01 || Math.abs(pitch % 12 - 12) < 0.01;
              return (
                <View key={`row-${pitch}`} style={styles.row}>
                  <View style={[styles.label, { width: labelW, height: cellH }, isC && styles.labelC]}>
                    <Text style={[styles.labelText, isC && styles.labelTextC]}>{noteName}</Text>
                  </View>
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
          </View>
        </Animated.ScrollView>
        </GestureDetector>
      </Animated.ScrollView>
      </GestureDetector>
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  outerScroll: { flex: 1 },
  innerScroll: { flex: 1 },
  headerRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.1)' },
  cornerCell: { justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.panelBg },
  cornerText: { fontSize: 11, fontWeight: '500', color: COLORS.textDim },
  colHeader: { justifyContent: 'center', alignItems: 'center', gap: 2, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)' },
  colHeaderSelected: { backgroundColor: 'rgba(0,0,0,0.04)' },
  colNum: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  muteBtn: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)', backgroundColor: 'transparent' },
  groupStart: { borderLeftWidth: 1.5, borderLeftColor: 'rgba(0,0,0,0.12)' },
  row: { flexDirection: 'row' },
  label: { justifyContent: 'center', paddingLeft: 4, backgroundColor: COLORS.panelBg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  labelC: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.12)' },
  labelText: { fontSize: 9, color: COLORS.textDim },
  labelTextC: { fontWeight: '700', color: COLORS.text },
  drumLabel: { fontSize: 12, fontWeight: '600', color: COLORS.text },
  drumCell: { justifyContent: 'center', alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)' },
  drumCellSelected: { backgroundColor: 'rgba(0,0,0,0.03)' },
  drumDot: { width: 24, height: 24, borderRadius: 12 },
});
