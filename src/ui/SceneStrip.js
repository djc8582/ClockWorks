import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, MAX_SCENES } from '../constants.js';
import { getState, updateState, captureScene, loadScene, deleteScene } from '../state.js';
import { rescheduleAll } from '../audio/audioEngine.js';
import { resetCycleCount } from '../sequencer.js';
import { useStore } from '../hooks/useStore.js';

export default React.memo(function SceneStrip() {
  const scenes = useStore(s => s.scenes);
  const activeIndex = useStore(s => s.activeSceneIndex);

  function onScenePress(index) {
    const state = getState();
    if (index !== state.activeSceneIndex) {
      loadScene(index);
      resetCycleCount();
      rescheduleAll();
    }
    updateState(s => {
      s.ui.panelSceneIndex = index;
      s.ui.panelShapeId = null;
    });
  }

  function onAddScene() {
    const newIndex = captureScene();
    if (newIndex < 0) return;
    loadScene(newIndex);
    updateState(s => {
      s.ui.panelSceneIndex = newIndex;
      s.ui.panelShapeId = null;
    });
    rescheduleAll();
  }

  function onDeleteScene() {
    const state = getState();
    deleteScene(state.activeSceneIndex);
    updateState(s => {
      s.ui.panelSceneIndex = s.activeSceneIndex;
      s.ui.panelShapeId = null;
    });
    rescheduleAll();
  }

  return (
    <View style={styles.container}>
      {scenes.map((_, i) => {
        const active = i === activeIndex;
        return (
          <Pressable
            key={`scene-${i}`}
            style={[styles.pill, active && styles.pillActive]}
            onPress={() => onScenePress(i)}
          >
            <Text style={[styles.pillText, active && styles.pillTextActive]}>
              {i + 1}
            </Text>
          </Pressable>
        );
      })}

      {scenes.length < MAX_SCENES && (
        <Pressable style={styles.addBtn} onPress={onAddScene}>
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      )}

      {scenes.length > 1 && (
        <Pressable style={styles.deleteBtn} onPress={onDeleteScene}>
          <Text style={styles.deleteBtnText}>{'\u00D7'}</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 6,
    backgroundColor: COLORS.panelBg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  pillActive: {
    backgroundColor: COLORS.text,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
  },
  pillTextActive: {
    color: '#fff',
  },
  addBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  addBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  deleteBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDim,
  },
});
