import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, UI } from '../constants.js';
import { getState, updateState } from '../state.js';
import { rescheduleAll } from '../audio/audioEngine.js';
import { rebuildPlaybackOrder } from '../sequencer.js';
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
      // Tap empty slot → copy scene into it, enable, and select for editing — all in one update
      updateState(s => {
        const srcScene = s.scenes[s.ui.panelSceneIndex];
        const copy = JSON.parse(JSON.stringify(srcScene || { shapes: [] }));
        for (const shape of copy.shapes) {
          shape.id = "shape-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
        }
        s.scenes[index] = copy;
        s.enabledSlots[index] = true;
        s.ui.panelSceneIndex = index;
        s.ui.panelShapeId = copy.shapes.length > 0 ? copy.shapes[0].id : null;
        s.ui.selectedNodeIndex = 0;
      });
      rebuildPlaybackOrder();
      rescheduleAll();
      return;
    }

    // Select already-enabled slot for editing
    updateState(s => {
      s.ui.panelSceneIndex = index;
      const scene = s.scenes[index];
      s.ui.panelShapeId = scene && scene.shapes.length > 0 ? scene.shapes[0].id : null;
      s.ui.selectedNodeIndex = 0;
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
          // Each slot borrows a palette color — the strip reads like the
          // colored vertex dots on the canvas
          const pal = COLORS.shapes[i % COLORS.shapes.length];

          return (
            <Pressable
              key={i}
              style={[
                styles.slot,
                inRange && !enabled && styles.slotLooped,
                enabled && !isEditing && { backgroundColor: pal.fill },
                isEditing && [styles.slotEditing, { backgroundColor: pal.main }],
              ]}
              onPress={() => onSlotPress(i)}
            >
              <Text style={[
                styles.slotText,
                inRange && styles.slotTextInRange,
                enabled && !isEditing && { color: pal.main },
                isEditing && styles.slotTextEditing,
              ]}>
                {i + 1}
              </Text>
              {isPlaying && !isEditing && (
                <View style={[styles.playingDot, { backgroundColor: pal.main }]} />
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
    paddingVertical: 6,
    paddingHorizontal: 10,
    gap: 8,
    backgroundColor: COLORS.panelBg,
    borderTopWidth: 1,
    borderTopColor: UI.separator,
  },
  slots: {
    flex: 1,
    flexDirection: 'row',
    gap: 5,
  },
  slot: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: UI.pill,
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotLooped: {
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  slotEditing: {
    ...UI.softShadow,
  },
  slotText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(0,0,0,0.18)',
  },
  slotTextInRange: {
    color: 'rgba(0,0,0,0.35)',
  },
  slotTextEditing: {
    color: '#fff',
  },
  mixerBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: UI.pill,
    backgroundColor: COLORS.shapes[3].fill,
  },
  mixerBtnActive: {
    backgroundColor: COLORS.shapes[3].main,
  },
  mixerBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.shapes[3].main,
  },
  mixerBtnTextActive: {
    color: '#fff',
  },
  playingDot: {
    position: 'absolute',
    top: 3,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.shapes[0].main,
  },
});
