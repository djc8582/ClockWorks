import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, UI } from '../constants.js';
import { getState, updateState } from '../state.js';
import { stripModel, stripSignature, songLength, extendSongTo, revertBar, shrinkSong } from '../looper.js';
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

// Bar strip. Bars are the song's slots; what each bar shows is the
// SELECTED layer's looping, drawn in that layer's color:
//   solid tint + outline  → the layer has its own pattern in this bar
//   dashed outline + ↻N   → this bar repeats bar N of the layer's loop
//   underline             → bar is part of the layer's phrase (loop length)
// A row of small dots shows every layer's state in its own color
// (filled = own pattern, ring = repeat).
// Tap a bar → edit it (bars past the song end extend the song).
// Tap the bar being edited → drop this layer's edit there (back to the
// loop); if nothing is left on the last bar, tap again to shorten the song.
export default React.memo(function SceneStrip() {
  const activeIndex = useStore(s => s.activeSceneIndex);
  const playing = useStore(s => s.ui.playing);
  const editIndex = useStore(s => s.ui.panelSceneIndex);
  const selectedId = useStore(s => s.ui.panelShapeId);
  // Primitive signature → re-render only when the strip actually changes
  useStore(s => stripSignature(s, s.ui.panelShapeId));
  const model = stripModel(getState(), selectedId);
  const pal = COLORS.shapes[model.selectedColorIndex % COLORS.shapes.length];

  function onSlotPress(index) {
    const state = getState();
    const lenBefore = songLength(state);
    const isCurrentEdit = index === state.ui.panelSceneIndex;
    const layerId = stripModel(state, state.ui.panelShapeId).selectedId;

    if (isCurrentEdit) {
      let changed = false;
      updateState(s => {
        if (layerId && revertBar(s, layerId, index)) { changed = true; return; }
        if (index === songLength(s) - 1 && shrinkSong(s)) {
          changed = true;
          s.ui.panelSceneIndex = index - 1;
          if (!s.ui.playing) s.activeSceneIndex = index - 1;
          s.ui.selectedNotes = [];
        }
      });
      if (changed) {
        rebuildPlaybackOrder();
        rescheduleAll();
      }
      return;
    }

    updateState(s => {
      extendSongTo(s, index);
      s.ui.panelSceneIndex = index;
      // Stopped: the canvas follows the edited bar (and play starts there).
      // Playing: the canvas keeps following the clock.
      if (!s.ui.playing) s.activeSceneIndex = index;
      // Layers keep their id in every bar — keep the selected layer
      const shapes = (s.scenes[index] && s.scenes[index].shapes) || [];
      if (!shapes.some(sh => sh.id === s.ui.panelShapeId)) {
        s.ui.panelShapeId = shapes.length > 0 ? shapes[0].id : null;
        s.ui.selectedNodeIndex = 0;
      }
      s.ui.selectedNotes = [];
    });
    if (songLength(getState()) !== lenBefore) {
      rebuildPlaybackOrder();
      rescheduleAll();
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.slots}>
        {model.bars.map((b) => {
          const i = b.bar;
          const isEditing = i === editIndex;
          const isPlaying = i === activeIndex && playing;
          const own = b.inSong && b.kind === 'unique';
          const repeat = b.inSong && b.kind === 'repeat';

          return (
            <Pressable
              key={i}
              accessibilityLabel={`Bar ${i + 1}` + (repeat ? `, repeats bar ${b.source + 1}` : own ? ', own pattern' : '')}
              style={[
                styles.slot,
                own && { backgroundColor: pal.fill, borderColor: pal.main },
                repeat && [styles.slotRepeat, { borderColor: pal.dim }],
                isEditing && [styles.slotEditing, { backgroundColor: pal.main, borderColor: pal.main }],
              ]}
              onPress={() => onSlotPress(i)}
            >
              <Text style={[
                styles.slotText,
                own && { color: pal.main },
                repeat && { color: pal.dim },
                isEditing && styles.slotTextEditing,
              ]}>
                {i + 1}
              </Text>
              {repeat && (
                <Text style={[styles.repeatCaption, { color: isEditing ? '#fff' : pal.dim }]}>
                  {'\u21BB'}{b.source + 1}
                </Text>
              )}
              {b.inSong && b.layers.length > 1 && (
                <View style={styles.layerDots}>
                  {b.layers.map(l => {
                    const c = COLORS.shapes[l.colorIndex % COLORS.shapes.length];
                    const dotColor = isEditing ? '#fff' : c.main;
                    return (
                      <View
                        key={l.id}
                        style={[
                          styles.layerDot,
                          l.unique ? { backgroundColor: dotColor } : { borderWidth: 1, borderColor: dotColor },
                        ]}
                      />
                    );
                  })}
                </View>
              )}
              {b.inPhrase && b.inSong && (
                <View style={[styles.phraseBar, { backgroundColor: isEditing ? '#fff' : pal.main }]} />
              )}
              {isPlaying && (
                <View style={[styles.playingDot, { backgroundColor: isEditing ? '#fff' : pal.main }]} />
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
    paddingVertical: 6,
    minHeight: 34,
    borderRadius: UI.radiusSmall,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotRepeat: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
  },
  repeatCaption: {
    fontSize: 8,
    fontWeight: '800',
    marginTop: -1,
  },
  layerDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
    marginTop: 2,
    maxHeight: 12,
    overflow: 'hidden',
    paddingHorizontal: 2,
  },
  layerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  phraseBar: {
    position: 'absolute',
    bottom: 2,
    left: '30%',
    right: '30%',
    height: 2,
    borderRadius: 1,
  },
  slotEditing: {
    ...UI.softShadow,
  },
  slotText: {
    fontSize: 12,
    fontWeight: '800',
    color: 'rgba(0,0,0,0.18)',
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
