import React, { useMemo, useRef, useState, useCallback } from 'react';
import { View, ScrollView, Text, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { COLORS, NOTE_NAMES, PITCH, DIMENSIONS } from '../constants.js';
import { getState, updateState } from '../state.js';
import { useStore } from '../hooks/useStore.js';
import PianoRollCell from './PianoRollCell.js';

function getStepData(vertex, stepIndex) {
  if (stepIndex === 0) return vertex;
  return vertex.subs && vertex.subs[stepIndex - 1];
}

function buildRows(scale, shape) {
  const rowSet = new Set();
  for (let p = PITCH.max; p >= PITCH.min; p--) {
    if (scale.includes(p % 12)) rowSet.add(p);
  }
  for (const v of shape.vertices) {
    for (const p of (v.pitches || [])) rowSet.add(p);
    if (v.subs) {
      for (const sub of v.subs) {
        for (const p of (sub.pitches || [])) rowSet.add(p);
      }
    }
  }
  return Array.from(rowSet).sort((a, b) => b - a);
}

export default function PianoRoll({ shape, color }) {
  if (!shape) return null;

  const { width: screenWidth } = useWindowDimensions();
  const scale = useStore(s => s.scale);
  const selectedNode = useStore(s => s.ui.selectedNodeIndex);
  const rollZoom = useStore(s => s.ui.rollZoom || 1.0);
  const scrollRef = useRef(null);

  const sub = shape.subdivision || 1;
  const totalCols = shape.sides * sub;

  // Flexible cell width: fill available width, then zoom scales it
  const labelW = 42;
  const availableWidth = screenWidth - labelW;
  const baseCellW = Math.max(40, Math.floor(availableWidth / totalCols));
  const cellW = Math.round(baseCellW * rollZoom);
  const cellH = Math.round(40 * rollZoom);
  const headerH = Math.round(44 * rollZoom);

  const rows = useMemo(() => buildRows(scale, shape), [scale, shape]);

  // Pinch-to-zoom on the roll
  const applyZoom = useCallback((newZoom) => {
    updateState(s => {
      s.ui.rollZoom = Math.max(DIMENSIONS.rollZoomMin, Math.min(DIMENSIONS.rollZoomMax, newZoom));
    });
  }, []);

  const pinch = useMemo(() => {
    let startZoom = 1;
    return Gesture.Pinch()
      .onStart(() => {
        'worklet';
        startZoom = rollZoom;
      })
      .onUpdate((e) => {
        'worklet';
        runOnJS(applyZoom)(startZoom * e.scale);
      });
  }, [rollZoom, applyZoom]);

  function toggleMute(vi, si) {
    updateState(s => {
      const sh = s.scenes[s.activeSceneIndex].shapes.find(ss => ss.id === shape.id);
      if (!sh || !sh.vertices[vi]) return;
      const sd = si === 0 ? sh.vertices[vi] : sh.vertices[vi].subs[si - 1];
      if (sd) sd.muted = !sd.muted;
    });
  }

  return (
    <GestureDetector gesture={pinch}>
      <ScrollView style={styles.outerScroll} nestedScrollEnabled>
        <ScrollView
          ref={scrollRef}
          horizontal
          style={styles.innerScroll}
          nestedScrollEnabled
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

            {/* Pitch rows */}
            {rows.map(pitch => {
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
          </View>
        </ScrollView>
      </ScrollView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  outerScroll: {
    flex: 1,
  },
  innerScroll: {
    flex: 1,
  },
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
  cornerText: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textDim,
  },
  colHeader: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(0,0,0,0.06)',
  },
  colHeaderSelected: {
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  colNum: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  muteBtn: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.15)',
    backgroundColor: 'transparent',
  },
  groupStart: {
    borderLeftWidth: 1.5,
    borderLeftColor: 'rgba(0,0,0,0.12)',
  },
  row: {
    flexDirection: 'row',
  },
  label: {
    justifyContent: 'center',
    paddingLeft: 4,
    backgroundColor: COLORS.panelBg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  labelC: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  labelText: {
    fontSize: 9,
    color: COLORS.textDim,
  },
  labelTextC: {
    fontWeight: '700',
    color: COLORS.text,
  },
});
