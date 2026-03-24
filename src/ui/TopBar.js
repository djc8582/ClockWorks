import React, { useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../constants.js';
import { updateState } from '../state.js';
import { updateBPM } from '../audio/audioEngine.js';
import { useStore } from '../hooks/useStore.js';

export default React.memo(function TopBar() {
  const bpm = useStore(s => s.bpm);
  const mixerOpen = useStore(s => s.ui.mixerOpen);

  const debounceRef = React.useRef(null);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const onBpmChange = useCallback((val) => {
    const newBpm = Math.round(val);
    updateState(s => { s.bpm = newBpm; });
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateBPM(newBpm), 50);
  }, []);

  function toggleMixer() {
    updateState(s => { s.ui.mixerOpen = !s.ui.mixerOpen; });
  }

  return (
    <View style={styles.container}>
      <View style={styles.bpmGroup}>
        <Text style={styles.bpmLabel}>{bpm} BPM</Text>
        <Slider
          style={styles.bpmSlider}
          minimumValue={30}
          maximumValue={300}
          step={1}
          value={bpm}
          onValueChange={onBpmChange}
          minimumTrackTintColor={COLORS.shapes[0].main}
          maximumTrackTintColor="rgba(0,0,0,0.1)"
        />
      </View>

      <Pressable
        style={[styles.mixerBtn, mixerOpen && styles.mixerBtnActive]}
        onPress={toggleMixer}
      >
        <Text style={[styles.mixerBtnText, mixerOpen && styles.mixerBtnTextActive]}>Mixer</Text>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.9)',
    gap: 12,
  },
  bpmGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bpmLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
    width: 60,
  },
  bpmSlider: {
    flex: 1,
    height: 28,
  },
  mixerBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  mixerBtnActive: {
    backgroundColor: COLORS.text,
  },
  mixerBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  mixerBtnTextActive: {
    color: '#fff',
  },
});
