import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput, StyleSheet } from 'react-native';
import Slider from './SmoothSlider.js';
import { COLORS, UI } from '../constants.js';
import { updateState, getState, initState } from '../state.js';
import { updateCycleDuration, rescheduleAll } from '../audio/audioEngine.js';
import { useStore } from '../hooks/useStore.js';
import { saveProject, listProjects, loadProject, deleteProject } from '../projects.js';
import { exportMIDI } from '../midi/midiExport.js';
import { exportAudio, setSampleBanks } from '../export/audioExport.js';
import { exportSheet } from '../export/sheetExport.js';
import { getSampleBank, getDrumBank } from '../audio/timbres.js';
import { rebuildPlaybackOrder } from '../sequencer.js';

export default React.memo(function TopBar() {
  const bpm = useStore(s => s.bpm);
  const debounceRef = React.useRef(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [saveName, setSaveName] = useState('');

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

  async function openProjects() {
    const list = await listProjects();
    setProjects(list);
    setSaveName('');
    setProjectsOpen(true);
  }

  async function handleSave() {
    const name = saveName.trim() || ('Project ' + new Date().toLocaleTimeString());
    await saveProject(name);
    const list = await listProjects();
    setProjects(list);
    setSaveName('');
  }

  async function handleLoad(filename) {
    try {
      await loadProject(filename);
      updateCycleDuration();
      rebuildPlaybackOrder();
      rescheduleAll();
      updateState(() => {});
    } catch (e) {}
    setProjectsOpen(false);
  }

  async function handleDelete(filename) {
    await deleteProject(filename);
    const list = await listProjects();
    setProjects(list);
  }

  function handleNew() {
    // initState() replaces ui too — keep the transport flags, or the UI
    // shows "paused" while the engine keeps playing the new project
    const prevUi = getState().ui;
    initState();
    getState().ui.audioStarted = prevUi.audioStarted;
    getState().ui.playing = prevUi.playing;
    updateCycleDuration();
    // The old project's song length must not outlive it (stale bar order)
    rebuildPlaybackOrder();
    rescheduleAll();
    updateState(() => {});
    setProjectsOpen(false);
  }

  return (
    <View style={styles.header}>
      <Pressable style={styles.projectChip} onPress={openProjects}>
        <Text style={styles.projectName}>Clockworks</Text>
      </Pressable>

      <View style={styles.bpmGroup}>
        <Text style={styles.bpmLabel}>{bpm}</Text>
        <Slider
          style={styles.bpmSlider}
          minimumValue={10}
          maximumValue={500}
          step={1}
          value={bpm}
          onValueChange={onBpmChange}
          minimumTrackTintColor={COLORS.shapes[0].main}
          maximumTrackTintColor="rgba(0,0,0,0.1)"
        />
      </View>

      <Pressable style={styles.exportBtn} onPress={() => setExportOpen(true)}>
        <Text style={styles.exportBtnText}>Export</Text>
      </Pressable>

      {/* Projects modal */}
      <Modal visible={projectsOpen} transparent animationType="fade" onRequestClose={() => setProjectsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setProjectsOpen(false)}>
          <View style={styles.modal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Projects</Text>

            {/* Save current */}
            <View style={styles.saveRow}>
              <TextInput
                style={styles.saveInput}
                placeholder="Project name..."
                placeholderTextColor="rgba(0,0,0,0.3)"
                value={saveName}
                onChangeText={setSaveName}
              />
              <Pressable style={styles.saveRowBtn} onPress={handleSave}>
                <Text style={styles.saveRowBtnText}>Save</Text>
              </Pressable>
            </View>

            {/* New project */}
            <Pressable style={styles.newBtn} onPress={handleNew}>
              <Text style={styles.newBtnText}>New Project</Text>
            </Pressable>

            {/* Project list */}
            <ScrollView style={styles.projectList}>
              {projects.length === 0 && (
                <Text style={styles.emptyText}>No saved projects</Text>
              )}
              {projects.map(p => (
                <View key={p.filename} style={styles.projectRow}>
                  <Pressable style={styles.projectInfo} onPress={() => handleLoad(p.filename)}>
                    <Text style={styles.projectRowName}>{p.name}</Text>
                    <Text style={styles.projectRowDate}>
                      {new Date(p.savedAt).toLocaleDateString()}
                    </Text>
                  </Pressable>
                  <Pressable style={styles.projectDeleteBtn} onPress={() => handleDelete(p.filename)}>
                    <Text style={styles.projectDeleteText}>{'\u00D7'}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* Export modal */}
      <Modal visible={exportOpen} transparent animationType="fade" onRequestClose={() => setExportOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setExportOpen(false)}>
          <View style={styles.exportModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Export</Text>

            <Pressable style={[styles.exportOption, { backgroundColor: COLORS.shapes[0].fill }]} onPress={() => { setExportOpen(false); exportMIDI(); }}>
              <Text style={[styles.exportOptionTitle, { color: COLORS.shapes[0].main }]}>MIDI</Text>
              <Text style={styles.exportOptionDesc}>Standard MIDI file for any DAW</Text>
            </Pressable>

            <Pressable style={[styles.exportOption, { backgroundColor: COLORS.shapes[1].fill }]} onPress={() => {
              setExportOpen(false);
              setSampleBanks(getSampleBank(), getDrumBank());
              exportAudio(4).catch(e => { if (__DEV__) console.warn('Audio export failed:', e); });
            }}>
              <Text style={[styles.exportOptionTitle, { color: COLORS.shapes[1].main }]}>Audio (WAV)</Text>
              <Text style={styles.exportOptionDesc}>4 cycles per scene, normalized</Text>
            </Pressable>

            <Pressable style={[styles.exportOption, { backgroundColor: COLORS.shapes[4].fill }]} onPress={() => { setExportOpen(false); exportSheet(); }}>
              <Text style={[styles.exportOptionTitle, { color: COLORS.shapes[4].main }]}>Sheet Music (PDF)</Text>
              <Text style={styles.exportOptionDesc}>Note grid for all scenes</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: COLORS.panelBg,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: UI.separator,
  },
  projectChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: UI.pill,
    backgroundColor: UI.chipBg,
  },
  projectName: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: -0.3,
  },
  bpmGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  bpmLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textLight,
    width: 32,
    textAlign: 'right',
  },
  bpmSlider: {
    flex: 1,
    height: 24,
  },
  exportBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: COLORS.shapes[1].fill,
    borderRadius: UI.pill,
  },
  exportBtnText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.shapes[1].main,
    letterSpacing: 0.3,
  },
  // Modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    width: 300,
    maxHeight: '70%',
    backgroundColor: COLORS.panelBg,
    borderRadius: 24,
    padding: 16,
    ...UI.cardShadow,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  saveRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  saveInput: {
    flex: 1,
    height: 38,
    borderRadius: UI.radiusSmall,
    backgroundColor: UI.chipBg,
    paddingHorizontal: 12,
    fontSize: 13,
    color: COLORS.text,
  },
  saveRowBtn: {
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: UI.pill,
    backgroundColor: COLORS.shapes[0].main,
    ...UI.softShadow,
  },
  saveRowBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
  newBtn: {
    paddingVertical: 10,
    borderRadius: UI.pill,
    backgroundColor: UI.chipBg,
    alignItems: 'center',
    marginBottom: 12,
  },
  newBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  projectList: {
    maxHeight: 250,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.textDim,
    textAlign: 'center',
    paddingVertical: 20,
  },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  projectInfo: {
    flex: 1,
  },
  projectRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },
  projectRowDate: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 2,
  },
  projectDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: COLORS.shapes[0].fill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectDeleteText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.shapes[0].main,
  },
  // Export modal
  exportModal: {
    width: 280,
    backgroundColor: COLORS.panelBg,
    borderRadius: 24,
    padding: 16,
    gap: 10,
    ...UI.cardShadow,
  },
  exportOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: UI.radius,
  },
  exportDisabled: {
    opacity: 0.4,
  },
  exportOptionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  exportOptionDesc: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 2,
  },
});
