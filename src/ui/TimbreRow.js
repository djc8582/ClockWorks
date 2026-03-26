import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { COLORS, TIMBRES, DRUM_TIMBRES, SCALE_DEFINITIONS, NOTE_NAMES, PITCH } from '../constants.js';
import { updateState, safeActiveScene } from '../state.js';
import { swapTimbre, rescheduleAll } from '../audio/audioEngine.js';
import { setScalePreset, getCurrentScaleName } from '../scale.js';

// Group timbres by category
function groupByCategory(timbres) {
  const groups = {};
  for (const t of timbres) {
    const cat = t.category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(t);
  }
  return groups;
}

export default function TimbreRow({ shape, color }) {
  if (!shape) return null;

  const [instrumentVisible, setInstrumentVisible] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);

  const grouped = useMemo(() => groupByCategory(TIMBRES), []);

  function onTimbrePress(timbreId) {
    const shapeId = shape.id;
    const wasDrum = DRUM_TIMBRES.has(shape.timbre);
    const isDrum = DRUM_TIMBRES.has(timbreId);
    // Fix #3: bounds-check activeSceneIndex
    updateState(s => {
      const scene = safeActiveScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shapeId);
      if (!sh) return;
      sh.timbre = timbreId;
      // Convert pitches when switching between melodic ↔ drum
      if (isDrum && !wasDrum) {
        // Melodic → drum: set each vertex to its slot (kick/snare/hihat/perc cycling)
        for (let i = 0; i < sh.vertices.length; i++) {
          sh.vertices[i].pitches = [i % 4];
          sh.vertices[i].muted = false;
          if (sh.vertices[i].subs) {
            for (const sub of sh.vertices[i].subs) {
              sub.pitches = [];
              sub.muted = true;
            }
          }
        }
      } else if (!isDrum && wasDrum) {
        // Drum → melodic: reset to default melodic pitches
        for (const v of sh.vertices) {
          v.pitches = [PITCH.defaultPitch];
          v.muted = false;
          if (v.subs) {
            for (const sub of v.subs) {
              sub.pitches = [PITCH.defaultPitch];
              sub.muted = false;
            }
          }
        }
      }
    });
    swapTimbre({ ...shape, timbre: timbreId });
    rescheduleAll();
    setInstrumentVisible(false);
  }

  const scaleOptions = useMemo(() => {
    const options = [];
    for (const [name] of Object.entries(SCALE_DEFINITIONS)) {
      for (let root = 0; root < 12; root++) {
        if (name === "Chromatic" && root > 0) continue;
        const label = name === "Chromatic" ? name : `${NOTE_NAMES[root]} ${name}`;
        options.push({ name, root, label });
      }
    }
    return options;
  }, []);

  function onScaleSelect(item) {
    setScalePreset(item.name, item.root);
    rescheduleAll();
    setKeyVisible(false);
  }

  const currentTimbre = TIMBRES.find(t => t.id === shape.timbre);
  const scaleName = getCurrentScaleName();

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          style={[styles.sectionBtn, { borderColor: color.main + '40' }]}
          onPress={() => setInstrumentVisible(true)}
        >
          <Text style={styles.sectionLabel}>Instrument</Text>
          <Text style={[styles.sectionValue, { color: color.main }]}>
            {currentTimbre ? currentTimbre.label : 'E.Piano'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.sectionBtn, { borderColor: color.main + '40' }]}
          onPress={() => setKeyVisible(true)}
        >
          <Text style={styles.sectionLabel}>Key</Text>
          <Text style={[styles.sectionValue, { color: color.main }]}>{scaleName}</Text>
        </Pressable>
      </View>

      {/* Instrument picker — large categorized modal */}
      <Modal
        visible={instrumentVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setInstrumentVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setInstrumentVisible(false)}
        >
          <View style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>Instrument</Text>
            <ScrollView style={styles.modalScroll}>
              {Object.entries(grouped).map(([category, timbres]) => (
                <View key={category}>
                  <Text style={styles.categoryLabel}>{category}</Text>
                  {timbres.map(t => {
                    const active = t.id === shape.timbre;
                    return (
                      <Pressable
                        key={t.id}
                        style={[styles.modalItem, active && { backgroundColor: color.main + '15' }]}
                        onPress={() => onTimbrePress(t.id)}
                      >
                        <Text style={[
                          styles.modalItemText,
                          active && { color: color.main, fontWeight: '700' },
                        ]}>
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Key picker — large modal */}
      <Modal
        visible={keyVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setKeyVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setKeyVisible(false)}
        >
          <View style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>Scale</Text>
            <ScrollView style={styles.modalScroll}>
              {scaleOptions.map(item => (
                <Pressable
                  key={`${item.name}-${item.root}`}
                  style={styles.modalItem}
                  onPress={() => onScaleSelect(item)}
                >
                  <Text style={styles.modalItemText}>{item.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
  },
  sectionBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '500',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.text,
    marginTop: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContentLarge: {
    width: 300,
    maxHeight: '70%',
    backgroundColor: COLORS.panelBg,
    borderRadius: 20,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
    textAlign: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  modalScroll: {
    flexGrow: 0,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 4,
  },
  modalItem: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  modalItemText: {
    fontSize: 16,
    color: COLORS.text,
  },
});
