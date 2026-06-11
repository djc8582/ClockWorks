// Openable FX rack — every effect is a tappable card that expands into
// its full editor. Used for both per-track effects (shapeId) and the
// master bus (shapeId == null). All changes apply live via ramps.
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, UI, FILTER_TYPES, makeDefaultFx, makeDefaultMasterFx } from '../constants.js';
import { useStore } from '../hooks/useStore.js';
import { setShapeFx, setMasterFx } from '../audio/audioEngine.js';

function hzLabel(t, lo = 80, hi = 18000) {
  const hz = lo * Math.pow(hi / lo, Math.max(0, Math.min(1, t)));
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
    <View style={[styles.card, expanded && { backgroundColor: color + '14' }]}>
      <Pressable style={styles.cardHeader} onPress={onToggle}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={[styles.cardSummary, { color }]}>{summary}</Text>
        <Text style={styles.cardChevron}>{expanded ? '−' : '+'}</Text>
      </Pressable>
      {expanded && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

// shapeId: track rack; shapeId == null: master rack
export default function EffectsPanel({ visible, onClose, shapeId, color }) {
  const [open, setOpen] = useState('filter');
  const accent = color ? color.main : COLORS.text;

  // Select RAW stable references only — getSnapshot must not allocate, or
  // useSyncExternalStore sees a new object every call and loops forever.
  // Defaults are merged during render instead.
  const rawFx = useStore(s => {
    if (!shapeId) return null;
    for (const scene of s.scenes) {
      const sh = (scene.shapes || []).find(x => x.id === shapeId);
      if (sh) return sh.fx;
    }
    return null;
  });
  const rawEffects = useStore(s => s.effects);
  const fx = shapeId ? { ...makeDefaultFx(), ...(rawFx || {}) } : null;
  const master = { ...makeDefaultMasterFx(), ...(rawEffects || {}) };

  const toggle = (key) => setOpen(open === key ? null : key);
  const isMaster = !shapeId;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.panel} onStartShouldSetResponder={() => true}>
          <Text style={styles.title}>{isMaster ? 'Master Effects' : 'Track Effects'}</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

            {!isMaster && fx && (
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
                  <Fader label="Amount" value={fx.drive} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { drive: Math.round(v * 100) / 100 })} />
                  <Text style={styles.hint}>tanh saturation — warm above 15%, hot above 60%</Text>
                </EffectCard>

                <EffectCard
                  title="Echo" color={accent}
                  summary={fx.echoSend < 0.01 ? 'off' : `send ${Math.round(fx.echoSend * 100)} · ${Math.round(master.delayTime * 1000)}ms`}
                  expanded={open === 'echo'} onToggle={() => toggle('echo')}
                >
                  <Fader label="Send" value={fx.echoSend} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { echoSend: Math.round(v * 100) / 100 })} />
                  <Text style={styles.hint}>shared bus (ping-pong)</Text>
                  <Fader label="Time" value={master.delayTime} min={0.05} max={0.7} color={accent}
                    format={(v) => Math.round(v * 1000) + 'ms'}
                    onChange={(v) => setMasterFx({ delayTime: Math.round(v * 100) / 100 })} />
                  <Fader label="Fdbk" value={master.delayFeedback} max={0.85} color={accent}
                    onChange={(v) => setMasterFx({ delayFeedback: Math.round(v * 100) / 100 })} />
                  <Fader label="Level" value={master.delayWet} color={accent}
                    onChange={(v) => setMasterFx({ delayWet: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Reverb" color={accent}
                  summary={fx.verbSend < 0.01 ? 'off' : `send ${Math.round(fx.verbSend * 100)}`}
                  expanded={open === 'verb'} onToggle={() => toggle('verb')}
                >
                  <Fader label="Send" value={fx.verbSend} color={accent}
                    onChange={(v) => setShapeFx(shapeId, { verbSend: Math.round(v * 100) / 100 })} />
                  <Text style={styles.hint}>shared bus (diffuse plate)</Text>
                  <Fader label="Level" value={master.reverbWet} color={accent}
                    onChange={(v) => setMasterFx({ reverbWet: Math.round(v * 100) / 100 })} />
                </EffectCard>
              </>
            )}

            {isMaster && (
              <>
                <EffectCard
                  title="Tone" color={accent}
                  summary={hzLabel(master.tone, 300, 20000) + 'Hz'}
                  expanded={open === 'filter'} onToggle={() => toggle('filter')}
                >
                  <Fader label="Cutoff" value={master.tone} color={accent} format={(v) => hzLabel(v, 300, 20000) + 'Hz'}
                    onChange={(v) => setMasterFx({ tone: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Echo" color={COLORS.shapes[1].main}
                  summary={`${Math.round(master.delayTime * 1000)}ms · fdbk ${Math.round(master.delayFeedback * 100)} · ${Math.round(master.delayWet * 100)}`}
                  expanded={open === 'echo'} onToggle={() => toggle('echo')}
                >
                  <Fader label="Time" value={master.delayTime} min={0.05} max={0.7} color={COLORS.shapes[1].main}
                    format={(v) => Math.round(v * 1000) + 'ms'}
                    onChange={(v) => setMasterFx({ delayTime: Math.round(v * 100) / 100 })} />
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
                  <Fader label="Level" value={master.reverbWet} color={COLORS.shapes[3].main}
                    onChange={(v) => setMasterFx({ reverbWet: Math.round(v * 100) / 100 })} />
                </EffectCard>

                <EffectCard
                  title="Volume" color={accent}
                  summary={Math.round(master.volume * 100) + ''}
                  expanded={open === 'vol'} onToggle={() => toggle('vol')}
                >
                  <Fader label="Master" value={master.volume} color={accent}
                    onChange={(v) => setMasterFx({ volume: Math.round(v * 100) / 100 })} />
                </EffectCard>
              </>
            )}
          </ScrollView>
          <Pressable style={[styles.doneBtn, { backgroundColor: accent }]} onPress={onClose}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </Pressable>
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
    maxHeight: '78%',
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
    width: 70,
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
    marginBottom: 6,
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
  hint: {
    fontSize: 9,
    color: COLORS.textDim,
    marginBottom: 4,
    marginLeft: 44,
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
