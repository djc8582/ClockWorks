import React, { useRef, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { COLORS, PITCH } from '../constants.js';
import { getState, updateState } from '../state.js';
import { playPreview, rescheduleAll } from '../audio/audioEngine.js';

function getStepData(vertex, stepIndex) {
  if (stepIndex === 0) return vertex;
  return vertex.subs && vertex.subs[stepIndex - 1];
}

export default function PianoRollCell({
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
  cellWidth,
  cellHeight,
}) {
  const startY = useRef(0);
  const lastY = useRef(0);
  const mode = useRef(null); // 'velocity' | null

  const onTap = useCallback(() => {
    const state = getState();
    const scene = state.scenes[state.activeSceneIndex];
    const shape = scene.shapes.find(s => s.id === shapeId);
    if (!shape || !shape.vertices[vertexIndex]) return;

    const stepData = getStepData(shape.vertices[vertexIndex], stepIndex);
    if (!stepData) return;
    const hasPitch = stepData.pitches.includes(pitch);

    if (hasPitch && !stepData.muted) {
      // Remove from chord or mute
      updateState(s => {
        const sh = s.scenes[s.activeSceneIndex].shapes.find(ss => ss.id === shapeId);
        if (!sh) return;
        const sd = stepIndex === 0 ? sh.vertices[vertexIndex] : sh.vertices[vertexIndex].subs[stepIndex - 1];
        if (!sd) return;
        if (sd.pitches.length > 1) {
          sd.pitches = sd.pitches.filter(p => p !== pitch);
        } else {
          sd.pitches = [];
          sd.muted = true;
        }
      });
    } else {
      // Add pitch to chord
      updateState(s => {
        const sh = s.scenes[s.activeSceneIndex].shapes.find(ss => ss.id === shapeId);
        if (!sh) return;
        const sd = stepIndex === 0 ? sh.vertices[vertexIndex] : sh.vertices[vertexIndex].subs[stepIndex - 1];
        if (!sd) return;
        if (hasPitch) {
          if (sd.pitches.length > 1) {
            sd.pitches = sd.pitches.filter(p => p !== pitch);
          }
        } else {
          sd.pitches.push(pitch);
          sd.pitches.sort((a, b) => a - b);
        }
        if (sd.muted) sd.muted = false;
        s.ui.selectedNodeIndex = vertexIndex;
      });

      const state2 = getState();
      const shape2 = state2.scenes[state2.activeSceneIndex].shapes.find(s => s.id === shapeId);
      if (shape2) playPreview(shape2, vertexIndex, stepIndex);
    }
  }, [shapeId, vertexIndex, stepIndex, pitch]);

  const tap = Gesture.Tap().runOnJS(true).onEnd(onTap);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .onStart((e) => {
      startY.current = e.y;
      lastY.current = e.y;
      mode.current = null;
    })
    .onUpdate((e) => {
      const totalDy = startY.current - e.y;

      if (mode.current === null) {
        if (Math.abs(totalDy) > 3 && isActive) {
          mode.current = 'velocity';
        } else {
          return;
        }
      }

      if (mode.current === 'velocity') {
        const frameDy = lastY.current - e.y;
        lastY.current = e.y;

        updateState(s => {
          const sh = s.scenes[s.activeSceneIndex].shapes.find(ss => ss.id === shapeId);
          if (!sh || !sh.vertices[vertexIndex]) return;
          const sd = stepIndex === 0 ? sh.vertices[vertexIndex] : sh.vertices[vertexIndex].subs[stepIndex - 1];
          if (sd) {
            sd.velocity = Math.round(Math.max(1, Math.min(127, sd.velocity + frameDy * 0.5)));
          }
        });
      }
    })
    .onEnd(() => {
      if (mode.current === 'velocity') {
        const state = getState();
        const shape = state.scenes[state.activeSceneIndex].shapes.find(s => s.id === shapeId);
        if (shape) playPreview(shape, vertexIndex, stepIndex);
      }
      mode.current = null;
    });

  const gesture = isActive ? Gesture.Race(pan, tap) : tap;

  const velPercent = Math.round((velocity / 127) * 100);

  return (
    <GestureDetector gesture={gesture}>
      <View style={[
        styles.cell,
        { width: cellWidth, height: cellHeight },
        isC && styles.isC,
        isSelectedColumn && styles.selCol,
        isGroupStart && styles.groupStart,
      ]}>
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
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  cell: {
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
    borderRadius: 2,
  },
  barMuted: {
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
});
