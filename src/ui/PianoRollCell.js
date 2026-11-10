import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { COLORS } from '../constants.js';
import { getState, updateState, panelBarIndex } from '../state.js';
import { editLayerBar } from '../looper.js';
import { playPreview } from '../audio/audioEngine.js';

function getStepData(vertex, stepIndex) {
  if (stepIndex === 0) return vertex;
  return vertex.subs && vertex.subs[stepIndex - 1];
}

export default React.memo(function PianoRollCell({
  shapeId,
  vertexIndex,
  stepIndex,
  pitch,
  isActive,
  isMuted,
  velocity,
  color,
  isSelectedColumn,
  isC,
  isGroupStart,
}) {
  function onPress() {
    const state = getState();
    const idx = state.ui ? state.ui.panelSceneIndex : 0;
    const scene = state.scenes[idx];
    if (!scene) return;
    const shape = scene.shapes.find(s => s.id === shapeId);
    if (!shape || !shape.vertices[vertexIndex]) return;

    const stepData = getStepData(shape.vertices[vertexIndex], stepIndex);
    if (!stepData) return;
    const pitches = stepData.pitches || [];
    // Tolerance-based matching for fractional (microtonal) pitches
    const hasPitch = pitches.some(p => Math.abs(p - pitch) < 0.01);

    if (hasPitch && !stepData.muted) {
      // Lands on the edited bar only — a repeat bar becomes an override
      updateState(s => {
        editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
          if (!sh.vertices[vertexIndex]) return;
          const sd = stepIndex === 0 ? sh.vertices[vertexIndex] : (sh.vertices[vertexIndex].subs && sh.vertices[vertexIndex].subs[stepIndex - 1]);
          if (!sd || !sd.pitches) return;
          if (sd.pitches.length > 1) {
            sd.pitches = sd.pitches.filter(p => Math.abs(p - pitch) > 0.01);
          } else {
            sd.pitches = [];
            sd.muted = true;
          }
        });
      });
    } else {
      updateState(s => {
        editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
          if (!sh.vertices[vertexIndex]) return;
          const sd = stepIndex === 0 ? sh.vertices[vertexIndex] : (sh.vertices[vertexIndex].subs && sh.vertices[vertexIndex].subs[stepIndex - 1]);
          if (!sd) return;
          if (!sd.pitches) sd.pitches = [];
          if (!hasPitch) {
            sd.pitches.push(pitch);
            sd.pitches.sort((a, b) => a - b);
          }
          if (sd.muted) sd.muted = false;
        });
      });

      const currentState = getState();
      const pidx = currentState.ui ? currentState.ui.panelSceneIndex : 0;
      const shape2 = currentState.scenes[pidx]?.shapes?.find(s => s.id === shapeId);
      if (shape2) playPreview(shape2, vertexIndex, stepIndex);
    }
  }

  const velPercent = Math.round(((velocity || 85) / 127) * 100);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.cell,
        isC && styles.isC,
        isSelectedColumn && styles.selCol,
        isGroupStart && styles.groupStart,
      ]}
    >
      {isActive && (
        <View style={[
          styles.bar,
          { height: `${velPercent}%`, backgroundColor: color.main },
        ]} />
      )}
      {isMuted && (
        <View style={[
          styles.bar,
          styles.barMuted,
          { height: `${velPercent}%` },
        ]} />
      )}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  cell: {
    // Sized by the parent row (animated width/height on the UI thread) —
    // cells never re-render during zoom
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  isC: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  selCol: {
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  groupStart: {
    borderLeftWidth: 1.5,
    borderLeftColor: 'rgba(0,0,0,0.12)',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barMuted: {
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
});
