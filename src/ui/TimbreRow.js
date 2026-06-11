import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { COLORS, UI, TIMBRES, DRUM_TIMBRES, SCALE_CATEGORIES, NO_TRANSPOSE_SCALES, NOTE_NAMES, PITCH } from '../constants.js';
import { updateState, safePanelScene } from '../state.js';
import { swapTimbre, rescheduleAll } from '../audio/audioEngine.js';
import { setScalePreset, getCurrentScaleName } from '../scale.js';
import EffectsPanel from './EffectsPanel.js';

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
  const [instrumentVisible, setInstrumentVisible] = useState(false);
  const [scalePhase, setScalePhase] = useState(null); // null | 'scale' | 'root'
  const [pendingScale, setPendingScale] = useState(null);
  const [fxVisible, setFxVisible] = useState(false);

  const grouped = useMemo(() => groupByCategory(TIMBRES), []);

  // After all hooks — early returns above a hook violate the Rules of Hooks
  if (!shape) return null;

  function onTimbrePress(timbreId) {
    const shapeId = shape.id;
    const wasDrum = DRUM_TIMBRES.has(shape.timbre);
    const isDrum = DRUM_TIMBRES.has(timbreId);
    // Fix #3: bounds-check activeSceneIndex
    updateState(s => {
      const scene = safePanelScene(s);
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
        // Drum → melodic: main steps get the default pitch, subdivision
        // steps reset to the muted default (matches makeDefaultStep)
        for (const v of sh.vertices) {
          v.pitches = [PITCH.defaultPitch];
          v.muted = false;
          if (v.subs) {
            for (const sub of v.subs) {
              sub.pitches = [];
              sub.muted = true;
            }
          }
        }
      }
    });
    swapTimbre({ ...shape, timbre: timbreId });
    rescheduleAll();
    setInstrumentVisible(false);
  }

  function onScaleNamePress(name) {
    if (NO_TRANSPOSE_SCALES.has(name)) {
      setScalePreset(name, 0);
      rescheduleAll();
      setScalePhase(null);
    } else {
      setPendingScale(name);
      setScalePhase('root');
    }
  }

  function onRootPress(root) {
    if (!pendingScale) return;
    setScalePreset(pendingScale, root);
    rescheduleAll();
    setScalePhase(null);
  }

  const currentTimbre = TIMBRES.find(t => t.id === shape.timbre);
  const scaleName = getCurrentScaleName();

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          style={[styles.sectionBtn, { backgroundColor: color.fill }]}
          onPress={() => setInstrumentVisible(true)}
        >
          <Text style={styles.sectionLabel}>Instrument</Text>
          <Text style={[styles.sectionValue, { color: color.main }]}>
            {currentTimbre ? currentTimbre.label : 'E.Piano'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.sectionBtn, { backgroundColor: color.fill }]}
          onPress={() => setScalePhase('scale')}
        >
          <Text style={styles.sectionLabel}>Key</Text>
          <Text style={[styles.sectionValue, { color: color.main }]}>{scaleName}</Text>
        </Pressable>

        <Pressable
          style={[styles.fxBtn, { backgroundColor: color.fill }]}
          onPress={() => setFxVisible(true)}
        >
          <Text style={styles.sectionLabel}>FX</Text>
          <Text style={[styles.sectionValue, { color: color.main }]}>{'♫'}</Text>
        </Pressable>
      </View>

      {/* Per-track effects rack */}
      <EffectsPanel
        visible={fxVisible}
        onClose={() => setFxVisible(false)}
        shapeId={shape.id}
        color={color}
      />

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

      {/* Scale picker — Phase 1: pick scale name (categorized) */}
      <Modal
        visible={scalePhase === 'scale'}
        transparent
        animationType="fade"
        onRequestClose={() => setScalePhase(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setScalePhase(null)}
        >
          <View style={styles.modalContentLarge}>
            <Text style={styles.modalTitle}>Scale</Text>
            <ScrollView style={styles.modalScroll}>
              {SCALE_CATEGORIES.map(cat => (
                <View key={cat.name}>
                  <Text style={styles.categoryLabel}>{cat.name}</Text>
                  {cat.scales.map(name => (
                    <Pressable
                      key={name}
                      style={styles.modalItem}
                      onPress={() => onScaleNamePress(name)}
                    >
                      <Text style={styles.modalItemText}>{name}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Scale picker — Phase 2: pick root note */}
      <Modal
        visible={scalePhase === 'root'}
        transparent
        animationType="fade"
        onRequestClose={() => setScalePhase(null)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setScalePhase(null)}
        >
          <View style={styles.rootModalContent}>
            <View style={styles.rootHeader}>
              <Pressable onPress={() => setScalePhase('scale')} hitSlop={12}>
                <Text style={styles.rootBack}>Back</Text>
              </Pressable>
              <Text style={styles.rootTitle}>{pendingScale}</Text>
              <View style={{ width: 36 }} />
            </View>
            <Text style={styles.rootSubtitle}>Choose root note</Text>
            <View style={styles.rootGrid}>
              {NOTE_NAMES.map((name, i) => (
                <Pressable
                  key={i}
                  style={[styles.rootBtn, { backgroundColor: color.fill }]}
                  onPress={() => onRootPress(i)}
                >
                  <Text style={[styles.rootBtnText, { color: color.main }]}>{name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: UI.separator,
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 10,
  },
  sectionBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: UI.radius,
  },
  fxBtn: {
    width: 56,
    paddingVertical: 8,
    borderRadius: UI.radius,
    alignItems: 'center',
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: COLORS.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionValue: {
    fontSize: 13,
    fontWeight: '800',
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
    borderRadius: 24,
    overflow: 'hidden',
    ...UI.cardShadow,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: UI.separator,
  },
  modalScroll: {
    flexGrow: 0,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textDim,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 18,
    paddingTop: 16,
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
  rootModalContent: {
    width: 280,
    backgroundColor: COLORS.panelBg,
    borderRadius: 24,
    paddingBottom: 20,
    overflow: 'hidden',
    ...UI.cardShadow,
  },
  rootHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: UI.separator,
  },
  rootBack: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  rootTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  rootSubtitle: {
    fontSize: 12,
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  rootGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 8,
    justifyContent: 'center',
  },
  rootBtn: {
    width: 56,
    height: 44,
    borderRadius: UI.radiusSmall,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rootBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
