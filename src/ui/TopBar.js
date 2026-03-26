import React, { useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../constants.js';
import { updateState } from '../state.js';
import { updateCycleDuration, rescheduleAll } from '../audio/audioEngine.js';
import { useStore } from '../hooks/useStore.js';

// Top header — project name + mixer toggle
export function TopBar() {
  const mixerOpen = useStore(s => s.ui.mixerOpen);

  function toggleMixer() {
    updateState(s => { s.ui.mixerOpen = !s.ui.mixerOpen; });
  }

  return (
    <View style={styles.header}>
      <Text style={styles.projectName}>Clockworks</Text>
      <Pressable
        style={[styles.mixerBtn, mixerOpen && styles.mixerBtnActive]}
        onPress={toggleMixer}
      >
        <Text style={[styles.mixerBtnText, mixerOpen && styles.mixerBtnTextActive]}>Mixer</Text>
      </Pressable>
    </View>
  );
}

// BPM control strip — sits above the scene strip
export function TempoBar() {
  const bpm = useStore(s => s.bpm);
  const debounceRef = React.useRef(null);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const onBpmChange = useCallback((val) => {
    const newBpm = Math.round(val);
    updateState(s => { s.bpm = newBpm; });
    updateCycleDuration();
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => rescheduleAll(), 50);
  }, []);

  return (
    <View style={styles.tempoBar}>
      <Text style={styles.bpmLabel}>{bpm} BPM</Text>
      <Slider
        style={styles.bpmSlider}
        minimumValue={10}
        maximumValue={400}
        step={1}
        value={bpm}
        onValueChange={onBpmChange}
        minimumTrackTintColor={COLORS.shapes[0].main}
        maximumTrackTintColor="rgba(0,0,0,0.1)"
      />
    </View>
  );
}

export default TopBar;

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: COLORS.panelBg,
  },
  projectName: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: -0.3,
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
  tempoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    backgroundColor: COLORS.panelBg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
    gap: 8,
  },
  bpmLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
    width: 55,
  },
  bpmSlider: {
    flex: 1,
    height: 28,
  },
});
