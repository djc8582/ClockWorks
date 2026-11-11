// Openable FX racks v2 — every effect leads with an interactive Skia
// visualizer (GarageBand-style: edit by dragging the response itself),
// with precise sliders underneath. Driven by global ui.fxPanel state
// ('master' | shapeId | null) so any surface can open it.
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Slider from './SmoothSlider.js';
import { COLORS, UI, FILTER_TYPES, makeDefaultFx, makeDefaultMasterFx } from '../constants.js';
import { useStore } from '../hooks/useStore.js';
import { updateState } from '../state.js';
import { setShapeFx, setMasterFx } from '../audio/audioEngine.js';
import { cutoffToHz } from '../audio/dsp.js';
import { FilterViz, EqViz, DriveViz, EchoViz, ReverbViz, FxDragContext } from './FxViz.js';

function hzLabel(norm) {
  const hz = cutoffToHz(norm);
  return hz >= 1000 ? (hz / 1000).toFixed(1) + 'k' : Math.round(hz) + '';
}

function Fader({ label, value, min = 0, max = 1, color, onChange, format }) {
  return (
    <View style={styles.faderRow}>
      <Text style={styles.faderLabel}>{label}</Text>
      <Slider
        style={styles.faderSlider}
        minimumValue={min}
        maximumValue={max}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={color}
        maximumTrackTintColor="rgba(0,0,0,0.1)"
      />
      <Text style={styles.faderValue}>{format ? format(value) : Math.round(value * 100)}</Text>
    </View>
  );
}

function EffectCard({ title, summary, color, expanded, onToggle, children }) {
  return (
    <View style={[styles.card, expanded && { backgroundColor: color + '12' }]}>
      <Pressable style={styles.cardHeader} onPress={onToggle}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={[styles.cardSummary, { color }]}>{summary}</Text>
        <Text style={styles.cardChevron}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      {expanded && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

const SYNC_OPTIONS = [
  { label: 'Free', v: null },
  { label: '1/16', v: 0.25 },
  { label: '1/8', v: 0.5 },
  { label: '1/8·', v: 0.75 },
  { label: '1/4', v: 1 },
];

function effectiveDelaySeconds(master, bpm) {
  if (master.delaySync) return Math.max(0.05, Math.min(1.2, (60 / (bpm || 120)) * master.delaySync));
  return Math.max(0.05, Math.min(0.7, master.delayTime));
}

function SyncPills({ value, color, onSelect }) {
  return (
    <View style={styles.typeRow}>
      {SYNC_OPTIONS.map(o => (
        <Pressable
          key={o.label}
          style={[styles.typeBtn, value === o.v && { backgroundColor: color }]}
          onPress={() => onSelect(o.v)}
        >
          <Text style={[styles.typeText, value === o.v && { color: '#fff' }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function eqSummary(v) {
  const fmt = (x, name) => Math.abs(x) < 0.04 ? null : `${name}${x > 0 ? '+' : ''}${Math.round(x * 12)}`;
  const parts = [fmt(v.eqLow, 'L'), fmt(v.eqMid, 'M'), fmt(v.eqHigh, 'H')].filter(Boolean);
  return parts.length ? parts.join(' ') : 'flat';
}

export default function EffectsPanel() {
  const [open, setOpen] = useState('eq');
  // A finger on an FX graph freezes the panel's scroll so the drag edits the graph
  const [graphDrag, setGraphDrag] = useState(false);
  const fxPanel = useStore(s => s.ui.fxPanel || null);
  const bpm = useStore(s => s.bpm);

  // Fresh rack target → start at EQ, not whatever the last shape had open
  useEffect(() => { if (fxPanel) setOpen('eq'); }, [fxPanel]);

  // RAW stable refs only — allocating in a selector loops useSyncExternalStore
  const shape = useStore(s => {
    if (!fxPanel || fxPanel === 'master') return null;
    for (const scene of s.scenes) {
      const sh = (scene.shapes || []).find(x => x.id === fxPanel);
      if (sh) return sh;
    }
    return null;
  });
  const rawEffects = useStore(s => s.effects);

  const isMaster = fxPanel === 'master';
  const visible = fxPanel !== null && (isMaster || !!shape);
  const fx = shape ? { ...makeDefaultFx(), ...(shape.fx || {}) } : makeDefaultFx();
  const master = { ...makeDefaultMasterFx(), ...(rawEffects || {}) };
  const color = shape ? COLORS.shapes[shape.colorIndex % COLORS.shapes.length] : null;
  const accent = color ? color.main : COLORS.text;
  const shapeId = shape ? shape.id : null;

  const returnToMixer = useStore(s => !!s.ui.fxReturnToMixer);
  const onClose = () => {
    updateState(s => { s.ui.fxPanel = null; s.ui.fxReturnToMixer = false; });
    if (returnToMixer) {
      // Reopen the mixer after this modal's dismiss animation
      setTimeout(() => updateState(s => { s.ui.mixerOpen = true; }), 300);
    }
  };
  const toggle = (key) => setOpen(open === key ? null : key);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Modals are separate native windows — gesture handlers inside them
          need their OWN root view, or touches break for the whole screen */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.panel} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>{isMaster ? 'Master Effects' : 'Track Effects'}</Text>
          <FxDragContext.Provider value={setGraphDrag}>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} scrollEnabled={!graphDrag}>

            {/* EQ — both track and master */}
            <EffectCard
              title="EQ" color={accent}
              summary={eqSummary(isMaster ? master : fx)}
              expanded={open === 'eq'} onToggle={() => toggle('eq')}
            >
              <EqViz
                values={isMaster ? master : fx}
                color={accent}
                onChange={(patch) => isMaster ? setMasterFx(patch) : setShapeFx(shapeId, patch)}
              />
            </EffectCard>

            {!isMaster && (
              <>
                <EffectCard
                  title="Filter" color={accent}
                  summary={`${(fx.filterType || 'lowpass').replace('pass', '')} · ${hzLabel(fx.cutoff)}Hz${fx.res > 0.05 ? ' · res' : ''}`}
                  expanded={open === 'filter'} onToggle={() => toggle('filter')}
                >
                  <View style={styles.typeRow}>
                    {FILTER_TYPES.map(t => (
                      <Pressable
                        key={t}
                        style={[styles.typeBtn, fx.filterType === t && { backgroundColor: accent }]}
                        onPress={() => setShapeFx(shapeId, { filterType: t })}
                      >
                        <Text style={[styles.typeText, fx.filterType === t && { color: '#fff' }]}>
                          {t === 'lowpass' ? 'LP' : t === 'highpass' ? 'HP' : 'BP'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <FilterViz fx={fx} color={accent}
                    onChange={(patch) => setShapeFx(shapeId, patch)} />
                  <Fader label="Cutoff" value={fx.cutoff} color={accent} format={(v) => hzLabel(v) + 'Hz'}
                    onChange={(v) => setShapeFx(shapeId, { cutoff: Math.round(v * 100) / 100 })} />
                  <Fader label="Res" value={fx.res} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { res: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Drive" color={accent}
                  summary={fx.drive < 0.15 ? 'off' : fx.drive < 0.6 ? 'warm' : 'hot'}
                  expanded={open === 'drive'} onToggle={() => toggle('drive')}
                >
                  <DriveViz drive={fx.drive} color={accent} />
                  <Fader label="Amount" value={fx.drive} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { drive: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Echo" color={accent}
                  summary={fx.echoSend < 0.01 ? 'off'
                    : `send ${Math.round(fx.echoSend * 100)} · ${master.delaySync ? (SYNC_OPTIONS.find(o => o.v === master.delaySync)?.label || 'sync') : Math.round(master.delayTime * 1000) + 'ms'}`}
                  expanded={open === 'echo'} onToggle={() => toggle('echo')}
                >
                  <SyncPills value={master.delaySync ?? null} color={accent}
                    onSelect={(v) => setMasterFx({ delaySync: v })} />
                  <EchoViz send={fx.echoSend} time={effectiveDelaySeconds(master, bpm)} feedback={master.delayFeedback}
                    color={accent}
                    onChange={(patch) => setMasterFx({ ...patch, delaySync: null })} />
                  <Fader label="Send" value={fx.echoSend} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { echoSend: Math.round(v * 100) / 100 })} />
                  <Fader label="Level" value={master.delayWet} color={accent}
                    onChange={(v) => setMasterFx({ delayWet: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Reverb" color={accent}
                  summary={fx.verbSend < 0.01 ? 'off' : `send ${Math.round(fx.verbSend * 100)}`}
                  expanded={open === 'verb'} onToggle={() => toggle('verb')}
                >
                  <ReverbViz send={fx.verbSend} color={accent} />
                  <Fader label="Send" value={fx.verbSend} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { verbSend: Math.round(v * 100) / 100 })} />
                  <Fader label="Level" value={master.reverbWet} color={accent}
                    onChange={(v) => setMasterFx({ reverbWet: Math.round(v * 100) / 100 })} />
                </EffectCard>
              </>
            )}

            {isMaster && (
              <>
                <EffectCard
                  title="Echo" color={COLORS.shapes[1].main}
                  summary={`${master.delaySync ? (SYNC_OPTIONS.find(o => o.v === master.delaySync)?.label || 'sync') + ' · ' + Math.round(effectiveDelaySeconds(master, bpm) * 1000) + 'ms' : Math.round(master.delayTime * 1000) + 'ms'} · fdbk ${Math.round(master.delayFeedback * 100)}`}
                  expanded={open === 'echo'} onToggle={() => toggle('echo')}
                >
                  <SyncPills value={master.delaySync ?? null} color={COLORS.shapes[1].main}
                    onSelect={(v) => setMasterFx({ delaySync: v })} />
                  <EchoViz send={0.8} time={effectiveDelaySeconds(master, bpm)} feedback={master.delayFeedback}
                    color={COLORS.shapes[1].main}
                    onChange={(patch) => setMasterFx({ ...patch, delaySync: null })} />
                  {!master.delaySync && (
                    <Fader label="Time" value={master.delayTime} min={0.05} max={0.7} color={COLORS.shapes[1].main}
                      format={(v) => Math.round(v * 1000) + 'ms'}
                      onChange={(v) => setMasterFx({ delayTime: Math.round(v * 100) / 100 })} />
                  )}
                  <Fader label="Fdbk" value={master.delayFeedback} max={0.85} color={COLORS.shapes[1].main}
                    onChange={(v) => setMasterFx({ delayFeedback: Math.round(v * 100) / 100 })} />
                  <Fader label="Level" value={master.delayWet} color={COLORS.shapes[1].main}
                    onChange={(v) => setMasterFx({ delayWet: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Reverb" color={COLORS.shapes[3].main}
                  summary={`level ${Math.round(master.reverbWet * 100)}`}
                  expanded={open === 'verb'} onToggle={() => toggle('verb')}
                >
                  <ReverbViz send={0.8} color={COLORS.shapes[3].main} />
                  <Fader label="Level" value={master.reverbWet} color={COLORS.shapes[3].main}
                    onChange={(v) => setMasterFx({ reverbWet: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Output" color={accent}
                  summary={`vol ${Math.round(master.volume * 100)} · tone ${Math.round(master.tone * 100)}`}
                  expanded={open === 'out'} onToggle={() => toggle('out')}
                >
                  <Fader label="Volume" value={master.volume} color={accent}
                    onChange={(v) => setMasterFx({ volume: Math.round(v * 100) / 100 })} />
                  <Fader label="Tone" value={master.tone} color={accent}
                    onChange={(v) => setMasterFx({ tone: Math.round(v * 100) / 100 })} />
                </EffectCard>
              </>
            )}
          </ScrollView>
          </FxDragContext.Provider>
          <Pressable style={[styles.doneBtn, { backgroundColor: accent }]} onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  panel: {
    width: 310,
    maxHeight: '82%',
    backgroundColor: COLORS.panelBg,
    borderRadius: 24,
    padding: 14,
    ...UI.cardShadow,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  scroll: {
    flexGrow: 0,
  },
  card: {
    borderRadius: UI.radius,
    backgroundColor: 'rgba(0,0,0,0.035)',
    marginBottom: 8,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    width: 60,
  },
  cardSummary: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  cardChevron: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textDim,
  },
  cardBody: {
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  typeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: UI.pill,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  typeText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.text,
  },
  faderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
  },
  faderLabel: {
    width: 44,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  faderSlider: {
    flex: 1,
    height: 28,
  },
  faderValue: {
    width: 44,
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textDim,
    textAlign: 'right',
  },
  doneBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: UI.pill,
    alignItems: 'center',
    ...UI.softShadow,
  },
  doneText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#fff',
  },
});
