import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, FlatList } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, SCALE_DEFINITIONS, NOTE_NAMES } from '../constants.js';
import { updateState } from '../state.js';
import { updateBPM, rescheduleAll } from '../audio/audioEngine.js';
import { setScalePreset, getCurrentScaleName } from '../scale.js';
import { useStore } from '../hooks/useStore.js';

export default React.memo(function TopBar() {
  const bpm = useStore(s => s.bpm);
  const [scalePickerVisible, setScalePickerVisible] = useState(false);
  const scaleName = getCurrentScaleName();

  const debounceRef = React.useRef(null);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const onBpmChange = useCallback((val) => {
    const newBpm = Math.round(val);
    updateState(s => { s.bpm = newBpm; });
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateBPM(newBpm), 50);
  }, []);

  const scaleOptions = React.useMemo(() => {
    const options = [];
    for (const [name] of Object.entries(SCALE_DEFINITIONS)) {
      for (let root = 0; root < 12; root++) {
        const rootName = NOTE_NAMES[root];
        const label = name === "Chromatic" ? name : `${rootName} ${name}`;
        if (name === "Chromatic" && root > 0) continue;
        options.push({ name, root, label });
      }
    }
    return options;
  }, []);

  function onScaleSelect(item) {
    setScalePreset(item.name, item.root);
    rescheduleAll();
    setScalePickerVisible(false);
  }

  return (
    <View style={styles.container}>
      {/* BPM slider */}
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

      {/* Scale picker */}
      <Pressable
        style={styles.scaleBtn}
        onPress={() => setScalePickerVisible(true)}
      >
        <Text style={styles.scaleBtnText}>{scaleName}</Text>
      </Pressable>

      {/* Scale picker modal */}
      <Modal
        visible={scalePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setScalePickerVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setScalePickerVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Scale</Text>
            <FlatList
              data={scaleOptions}
              keyExtractor={(item) => `${item.name}-${item.root}`}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.scaleItem}
                  onPress={() => onScaleSelect(item)}
                >
                  <Text style={styles.scaleItemText}>{item.label}</Text>
                </Pressable>
              )}
              style={styles.scaleList}
            />
          </View>
        </Pressable>
      </Modal>
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
  scaleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  scaleBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: 260,
    maxHeight: 400,
    backgroundColor: COLORS.panelBg,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  scaleList: {
    maxHeight: 340,
  },
  scaleItem: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  scaleItemText: {
    fontSize: 14,
    color: COLORS.text,
  },
});
