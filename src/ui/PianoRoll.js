import React, { useMemo, useRef, useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { COLORS, NOTE_NAMES, PITCH, DRUM_TIMBRES, DRUM_SLOTS, DIMENSIONS } from '../constants.js';
import { updateState, safeActiveScene } from '../state.js';
import { useStore } from '../hooks/useStore.js';
import PianoRollCell from './PianoRollCell.js';

function getStepData(vertex, stepIndex) {
  if (stepIndex === 0) return vertex;
  return vertex.subs && vertex.subs[stepIndex - 1];
}

// Build all pitch rows for the current scale across the full MIDI range.
// Also includes any out-of-scale pitches that are active in the shape.
function buildRows(scale, shape) {
  const scaleSet = new Set(scale);
  const rowSet = new Set();
  for (let p = PITCH.max; p >= PITCH.min; p--) {
    if (scaleSet.has(p % 12)) rowSet.add(p);
  }
  // Include any active pitches that may be outside the current scale
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

export default function PianoRoll({ shape, color }) {
  if (!shape) return null;

  const isDrum = DRUM_TIMBRES.has(shape.timbre);

  if (isDrum) return <DrumGrid shape={shape} color={color} />;
  return <MelodicGrid shape={shape} color={color} />;
}

// ── Zoom controls ────────────────────────────────────────────
function ZoomControls() {
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);

  function zoomIn() {
    updateState(s => {
      s.ui.rollZoom = Math.min(DIMENSIONS.rollZoomMax, (s.ui.rollZoom || 1) + 0.25);
    });
  }
  function zoomOut() {
    updateState(s => {
      s.ui.rollZoom = Math.max(DIMENSIONS.rollZoomMin, (s.ui.rollZoom || 1) - 0.25);
    });
  }

  return (
    <View style={styles.zoomControls}>
      <Pressable style={styles.zoomBtn} onPress={zoomOut}>
        <Text style={styles.zoomBtnText}>{'\u2212'}</Text>
      </Pressable>
      <Text style={styles.zoomLabel}>{Math.round(rollZoom * 100)}%</Text>
      <Pressable style={styles.zoomBtn} onPress={zoomIn}>
        <Text style={styles.zoomBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

// ── Scroll position preservation hook ────────────────────────
// Fix #5: Only restores scroll on shape change, not every render.
function useScrollPreserver(shapeId) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const prevShapeId = useRef(shapeId);

  const onOuterScroll = useCallback((e) => {
    pos.current.y = e.nativeEvent.contentOffset.y;
  }, []);
  const onInnerScroll = useCallback((e) => {
    pos.current.x = e.nativeEvent.contentOffset.x;
  }, []);

  // Only restore scroll when returning to a shape we had a saved position for,
  // NOT on every render (which fights user scrolling).
  useEffect(() => {
    if (prevShapeId.current !== shapeId) {
      // Shape changed — don't restore old position, let the init-scroll effect handle it
      pos.current = { x: 0, y: 0 };
      prevShapeId.current = shapeId;
      return;
    }
    // Same shape re-render — restore saved position
    if (pos.current.y > 0 && outerRef.current) {
      outerRef.current.scrollTo({ y: pos.current.y, animated: false });
    }
    if (pos.current.x > 0 && innerRef.current) {
      innerRef.current.scrollTo({ x: pos.current.x, animated: false });
    }
  }, [shapeId]);

  return { outerRef, innerRef, onOuterScroll, onInnerScroll, pos };
}

// ── Drum step sequencer ──────────────────────────────────────
// Drum slots are encoded as pitches: 0=kick, 1=snare, 2=hihat, 3=perc.
// Any slot can be active at any step — no vertex-to-slot restriction.
function DrumGrid({ shape, color }) {
  const { width: screenWidth } = useWindowDimensions();
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const { outerRef, innerRef, onOuterScroll, onInnerScroll } = useScrollPreserver(shape.id);
  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;

  const cellW = Math.max(44, Math.round(Math.floor((screenWidth - 70) / totalCols) * rollZoom));
  const cellH = Math.round(48 * rollZoom);
  const headerH = Math.round(36 * rollZoom);

  const slotLabels = DRUM_SLOTS || ['Kick', 'Snare', 'HiHat', 'Perc'];

  // Fix #3: bounds-check activeSceneIndex
  function toggleSlot(vi, si, slotIdx) {
    updateState(s => {
      const scene = safeActiveScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shape.id);
      if (!sh || !sh.vertices[vi]) return;
      const sd = si === 0 ? sh.vertices[vi] : (sh.vertices[vi].subs && sh.vertices[vi].subs[si - 1]);
      if (!sd) return;
      if (!sd.pitches) sd.pitches = [];
      const idx = sd.pitches.indexOf(slotIdx);
      if (idx !== -1) {
        // Remove this slot
        sd.pitches.splice(idx, 1);
        if (sd.pitches.length === 0) sd.muted = true;
      } else {
        // Add this slot
        sd.pitches.push(slotIdx);
        sd.pitches.sort((a, b) => a - b);
        sd.muted = false;
      }
    });
  }

  return (
    <View style={{ flex: 1 }}>
    <ZoomControls />
    <ScrollView ref={outerRef} style={styles.outerScroll} nestedScrollEnabled onScroll={onOuterScroll} scrollEventThrottle={16}>
      <ScrollView ref={innerRef} horizontal style={styles.innerScroll} nestedScrollEnabled onScroll={onInnerScroll} scrollEventThrottle={16}>
        <View>
          {/* Column headers */}
          <View style={[styles.headerRow, { height: headerH }]}>
            <View style={[styles.cornerCell, { width: 70 }]}>
              <Text style={styles.cornerText}>Step</Text>
            </View>
            {Array.from({ length: shape.sides }).map((_, vi) =>
              Array.from({ length: sub }).map((_, s) => {
                const sel = vi === selectedNode;
                return (
                  <View
                    key={`dh-${vi}-${s}`}
                    style={[
                      styles.colHeader,
                      { width: cellW, height: headerH },
                      sel && styles.colHeaderSelected,
                      s === 0 && vi > 0 && styles.groupStart,
                    ]}
                  >
                    <Text style={[styles.colNum, sel && { color: color.main, fontWeight: '700' }]}>
                      {s === 0 ? vi + 1 : ''}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Drum slot rows — every cell is tappable */}
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
                      <Pressable
                        key={`dc-${vi}-${s}-${slotIdx}`}
                        style={[
                          styles.drumCell,
                          { width: cellW, height: cellH },
                          s === 0 && vi > 0 && styles.groupStart,
                          vi === selectedNode && styles.drumCellSelected,
                        ]}
                        onPress={() => toggleSlot(vi, s, slotIdx)}
                      >
                        <View style={[
                          styles.drumDot,
                          isActive
                            ? { backgroundColor: color.main }
                            : { backgroundColor: 'rgba(0,0,0,0.06)' },
                        ]} />
                      </Pressable>
                    );
                  })
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </ScrollView>
    </View>
  );
}

// ── Melodic piano roll ───────────────────────────────────────
// Fix #2: Row windowing — only renders visible rows + buffer. Reduces worst case
// from 7008 components to ~600 (visible viewport only).
const ROW_BUFFER = 4; // extra rows above/below viewport

function MelodicGrid({ shape, color }) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const scale = useStore(s => s.scale);
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const { outerRef, innerRef, onOuterScroll: baseOuterScroll, onInnerScroll, pos } = useScrollPreserver(shape.id);

  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;

  const labelW = 42;
  const availableWidth = screenWidth - labelW;
  const baseCellW = Math.max(40, Math.floor(availableWidth / totalCols));
  const cellW = Math.round(baseCellW * rollZoom);
  const cellH = Math.round(40 * rollZoom);
  const headerH = Math.round(44 * rollZoom);

  const rows = useMemo(() => buildRows(scale, shape), [scale, shape]);

  // Track scroll offset for row windowing
  const [scrollY, setScrollY] = useState(0);
  const scrollYRef = useRef(0);
  const onOuterScroll = useCallback((e) => {
    const y = e.nativeEvent.contentOffset.y;
    baseOuterScroll(e);
    scrollYRef.current = y;
    // Batch scroll state updates to avoid per-pixel re-renders
    const prev = scrollYRef.prevWindow || 0;
    if (Math.abs(y - prev) > cellH * 2) {
      scrollYRef.prevWindow = y;
      setScrollY(y);
    }
  }, [baseOuterScroll, cellH]);

  // Compute visible row window
  const viewportH = screenHeight * 0.45; // approximate panel height
  const firstVisible = Math.max(0, Math.floor(scrollY / cellH) - ROW_BUFFER);
  const lastVisible = Math.min(rows.length - 1, Math.ceil((scrollY + viewportH) / cellH) + ROW_BUFFER);
  const visibleRows = rows.slice(firstVisible, lastVisible + 1);
  const topSpacer = firstVisible * cellH;
  const bottomSpacer = Math.max(0, (rows.length - lastVisible - 1) * cellH);

  const hasScrolledInit = useRef(null);

  // Fix #5: Only scroll on shape change, not every render
  useEffect(() => {
    if (hasScrolledInit.current === shape.id || rows.length === 0) return;
    hasScrolledInit.current = shape.id;
    let sum = 0, count = 0;
    for (const v of shape.vertices) {
      if (v && v.pitches) for (const p of v.pitches) { sum += p; count++; }
    }
    const mid = count > 0 ? Math.round(sum / count) : 60;
    let targetIdx = 0;
    let bestDist = Infinity;
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

  // Fix #3: bounds-check activeSceneIndex in every updateState callback
  function toggleMute(vi, si) {
    updateState(s => {
      const scene = safeActiveScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shape.id);
      if (!sh || !sh.vertices[vi]) return;
      const sd = si === 0 ? sh.vertices[vi] : (sh.vertices[vi].subs && sh.vertices[vi].subs[si - 1]);
      if (sd) sd.muted = !sd.muted;
    });
  }

  return (
    <View style={{ flex: 1 }}>
    <ZoomControls />
    <ScrollView ref={outerRef} style={styles.outerScroll} nestedScrollEnabled onScroll={onOuterScroll} scrollEventThrottle={16}>
      <ScrollView
        ref={innerRef}
        horizontal
        style={styles.innerScroll}
        nestedScrollEnabled
        onScroll={onInnerScroll}
        scrollEventThrottle={16}
      >
          <View>
            {/* Column headers */}
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
                    <View
                      key={`hdr-${vi}-${s}`}
                      style={[
                        styles.colHeader,
                        { width: cellW, height: headerH },
                        sel && styles.colHeaderSelected,
                        isFirst && vi > 0 && styles.groupStart,
                      ]}
                    >
                      {isFirst ? (
                        <Text style={[
                          styles.colNum,
                          sel && { color: color.main, fontWeight: '700' },
                        ]}>
                          {vi + 1}
                        </Text>
                      ) : (
                        <Text style={[styles.colNum, { fontSize: 9, opacity: 0.4 }]}>
                          {s + 1}
                        </Text>
                      )}
                      <Pressable
                        style={[
                          styles.muteBtn,
                          !muted && { backgroundColor: color.main, borderColor: color.main },
                        ]}
                        onPress={() => toggleMute(vi, s)}
                      />
                    </View>
                  );
                })
              )}
            </View>

            {/* Fix #2: Windowed pitch rows — only visible rows are mounted */}
            {topSpacer > 0 && <View style={{ height: topSpacer }} />}
            {visibleRows.map(pitch => {
              const noteName = NOTE_NAMES[pitch % 12] + Math.floor(pitch / 12 - 1);
              const isC = pitch % 12 === 0;

              return (
                <View key={`row-${pitch}`} style={styles.row}>
                  <View style={[styles.label, { width: labelW, height: cellH }, isC && styles.labelC]}>
                    <Text style={[styles.labelText, isC && styles.labelTextC]}>{noteName}</Text>
                  </View>

                  {Array.from({ length: shape.sides }).map((_, vi) =>
                    Array.from({ length: sub }).map((_, s) => {
                      const stepData = getStepData(shape.vertices[vi], s);
                      const pitches = stepData ? (stepData.pitches || []) : [];
                      const isActive = pitches.includes(pitch) && !stepData?.muted;
                      const isMuted = pitches.includes(pitch) && stepData?.muted;
                      const vel = stepData ? stepData.velocity : 0;
                      const sel = vi === selectedNode;
                      const isFirst = s === 0;

                      return (
                        <PianoRollCell
                          key={`cell-${vi}-${s}-${pitch}`}
                          shapeId={shape.id}
                          vertexIndex={vi}
                          stepIndex={s}
                          pitch={pitch}
                          isActive={isActive}
                          isMuted={isMuted}
                          velocity={vel}
                          color={color}
                          isSelectedColumn={sel}
                          isC={isC}
                          isGroupStart={isFirst && vi > 0}
                          cellWidth={cellW}
                          cellHeight={cellH}
                        />
                      );
                    })
                  )}
                </View>
              );
            })}
            {bottomSpacer > 0 && <View style={{ height: bottomSpacer }} />}
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  outerScroll: { flex: 1 },
  innerScroll: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  cornerCell: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.panelBg,
  },
  cornerText: { fontSize: 11, fontWeight: '500', color: COLORS.textDim },
  colHeader: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(0,0,0,0.06)',
  },
  colHeaderSelected: { backgroundColor: 'rgba(0,0,0,0.04)' },
  colNum: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  muteBtn: {
    width: 10, height: 10, borderRadius: 5,
    borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.15)', backgroundColor: 'transparent',
  },
  groupStart: { borderLeftWidth: 1.5, borderLeftColor: 'rgba(0,0,0,0.12)' },
  row: { flexDirection: 'row' },
  label: {
    justifyContent: 'center', paddingLeft: 4, backgroundColor: COLORS.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  labelC: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.12)' },
  labelText: { fontSize: 9, color: COLORS.textDim },
  labelTextC: { fontWeight: '700', color: COLORS.text },
  // Drum grid styles
  drumLabel: { fontSize: 12, fontWeight: '600', color: COLORS.text },
  drumCell: {
    justifyContent: 'center', alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: 'rgba(0,0,0,0.06)',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  drumCellSelected: { backgroundColor: 'rgba(0,0,0,0.03)' },
  drumDot: { width: 24, height: 24, borderRadius: 12 },
  // Zoom controls
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    gap: 6,
    backgroundColor: COLORS.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  zoomBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center', alignItems: 'center',
  },
  zoomBtnText: { fontSize: 14, fontWeight: '600', color: COLORS.text },
  zoomLabel: { fontSize: 10, fontWeight: '500', color: COLORS.textDim, width: 32, textAlign: 'center' },
});
