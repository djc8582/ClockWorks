import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS } from '../constants.js';
import { getState, updateState, loadScene } from '../state.js';
import { rescheduleAll } from '../audio/audioEngine.js';
import { resetCycleCount, rebuildPlaybackOrder } from '../sequencer.js';
import { useStore } from '../hooks/useStore.js';

function MixerToggle() {
  const mixerOpen = useStore(s => s.ui.mixerOpen);
  return (
    <Pressable
      style={[styles.mixerBtn, mixerOpen && styles.mixerBtnActive]}
      onPress={() => updateState(s => { s.ui.mixerOpen = !s.ui.mixerOpen; })}
    >
      <Text style={[styles.mixerBtnText, mixerOpen && styles.mixerBtnTextActive]}>Mix</Text>
    </Pressable>
  );
}

export default React.memo(function SceneStrip() {
  const activeIndex = useStore(s => s.activeSceneIndex);
  const enabledSlots = useStore(s => s.enabledSlots);
  const playing = useStore(s => s.ui.playing);

  // Find the last editable slot (highest enabled)
  let lastEnabled = 0;
  if (enabledSlots) {
    for (let i = enabledSlots.length - 1; i >= 0; i--) {
      if (enabledSlots[i]) { lastEnabled = i; break; }
    }
  }

  // panelSceneIndex = which scene the piano roll edits
  // activeSceneIndex = which scene is currently playing (controlled by sequencer)
  const editIndex = useStore(s => s.ui.panelSceneIndex);

  function onSlotPress(index) {
    const state = getState();
    const enabled = state.enabledSlots || [];
    const isEnabled = enabled[index];
    const isCurrentEdit = index === state.ui.panelSceneIndex;

    if (index === 0) {
      // Slot 1 is always enabled — just select it for editing
      updateState(s => {
        s.ui.panelSceneIndex = 0;
        s.ui.panelShapeId = null;
      });
      return;
    }

    if (isEnabled && isCurrentEdit) {
      // Tap enabled+editing slot → disable it, clear shapes, edit slot 0
      updateState(s => {
        s.enabledSlots[index] = false;
        s.scenes[index] = { shapes: [] };
        s.ui.panelSceneIndex = 0;
        s.ui.panelShapeId = null;
      });
      rebuildPlaybackOrder();
      rescheduleAll();
      return;
    }

    if (!isEnabled) {
      // Tap empty slot → copy the currently edited scene into it, enable
      updateState(s => {
        const srcScene = s.scenes[s.ui.panelSceneIndex];
        const copy = JSON.parse(JSON.stringify(srcScene || { shapes: [] }));
        for (const shape of copy.shapes) {
          shape.id = "shape-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
        }
        s.scenes[index] = copy;
        s.enabledSlots[index] = true;
      });
      rebuildPlaybackOrder();
      rescheduleAll();
    }

    // Select this slot for editing (does NOT change what's playing)
    updateState(s => {
      s.ui.panelSceneIndex = index;
      s.ui.panelShapeId = null;
    });
  }

  return (
    <View style={styles.container}>
      <View style={styles.slots}>
        {Array.from({ length: 8 }, (_, i) => {
          const enabled = enabledSlots && enabledSlots[i];
          const isEditing = i === editIndex;
          const isPlaying = i === activeIndex && playing;
          const inRange = i <= lastEnabled;

          return (
            <Pressable
              key={i}
              style={[
                styles.slot,
                inRange && !enabled && styles.slotLooped,
                enabled && !isEditing && styles.slotEnabled,
                isEditing && styles.slotEditing,
              ]}
              onPress={() => onSlotPress(i)}
            >
              <Text style={[
                styles.slotText,
                inRange && styles.slotTextInRange,
                enabled && styles.slotTextEnabled,
                isEditing && styles.slotTextEditing,
              ]}>
                {i + 1}
              </Text>
              {isPlaying && !isEditing && (
                <View style={styles.playingDot} />
              )}
            </Pressable>
          );
        })}
      </View>
      <MixerToggle />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    gap: 6,
    backgroundColor: COLORS.panelBg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  slots: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  slot: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotLooped: {
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  slotEnabled: {
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  slotEditing: {
    backgroundColor: COLORS.text,
  },
  slotText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(0,0,0,0.15)',
  },
  slotTextInRange: {
    color: 'rgba(0,0,0,0.3)',
  },
  slotTextEnabled: {
    color: COLORS.text,
  },
  slotTextEditing: {
    color: '#fff',
  },
  mixerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  mixerBtnActive: {
    backgroundColor: COLORS.text,
  },
  mixerBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
  },
  mixerBtnTextActive: {
    color: '#fff',
  },
  playingDot: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.shapes[0].main,
  },
});
