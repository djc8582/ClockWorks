import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ScrollView, TextInput, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS } from '../constants.js';
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
    initState();
    updateCycleDuration();
    rescheduleAll();
    updateState(() => {});
    setProjectsOpen(false);
  }

  return (
    <View style={styles.header}>
      <Pressable onPress={openProjects}>
        <Text style={styles.projectName}>Clockworks</Text>
      </Pressable>

      <View style={styles.bpmGroup}>
        <Text style={styles.bpmLabel}>{bpm}</Text>
        <Slider
          style={styles.bpmSlider}
          minimumValue={10}
          maximumValue={1000}
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

            <Pressable style={styles.exportOption} onPress={() => { setExportOpen(false); exportMIDI(); }}>
              <Text style={styles.exportOptionTitle}>MIDI</Text>
              <Text style={styles.exportOptionDesc}>Standard MIDI file for any DAW</Text>
            </Pressable>

            <Pressable style={styles.exportOption} onPress={() => {
              setExportOpen(false);
              setSampleBanks(getSampleBank(), getDrumBank());
              exportAudio(4).catch(e => { if (__DEV__) console.warn('Audio export failed:', e); });
            }}>
              <Text style={styles.exportOptionTitle}>Audio (WAV)</Text>
              <Text style={styles.exportOptionDesc}>4 cycles per scene, normalized</Text>
            </Pressable>

            <Pressable style={styles.exportOption} onPress={() => { setExportOpen(false); exportSheet(); }}>
              <Text style={styles.exportOptionTitle}>Sheet Music (PDF)</Text>
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.panelBg,
    gap: 8,
  },
  projectName: {
    fontSize: 15,
    fontWeight: '700',
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
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textDim,
    width: 28,
    textAlign: 'right',
  },
  bpmSlider: {
    flex: 1,
    height: 24,
  },
  exportBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 12,
  },
  exportBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.text,
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
    borderRadius: 20,
    overflow: 'hidden',
    padding: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
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
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
    paddingHorizontal: 12,
    fontSize: 13,
    color: COLORS.text,
  },
  saveRowBtn: {
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: COLORS.shapes[0].main,
  },
  saveRowBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  newBtn: {
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    marginBottom: 12,
  },
  newBtnText: {
    fontSize: 13,
    fontWeight: '600',
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
    fontWeight: '600',
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
    backgroundColor: 'rgba(0,0,0,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  projectDeleteText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  // Export modal
  exportModal: {
    width: 280,
    backgroundColor: COLORS.panelBg,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  exportOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  exportDisabled: {
    opacity: 0.4,
  },
  exportOptionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  exportOptionDesc: {
    fontSize: 11,
    color: COLORS.textDim,
    marginTop: 2,
  },
});
