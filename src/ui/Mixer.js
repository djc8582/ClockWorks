import React, { useRef, useEffect } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, UI, TIMBRES, makeDefaultFx } from '../constants.js';
import { updateState } from '../state.js';
import { editLayerAll } from '../looper.js';
import { rescheduleAll, setShapeFx } from '../audio/audioEngine.js';
import { useStore } from '../hooks/useStore.js';

const EMPTY_SHAPES = [];

const SHAPE_NAMES = {
  2: 'Line', 3: 'Tri', 4: 'Square', 5: 'Penta',
  6: 'Hexa', 7: 'Hepta', 8: 'Octa', 9: 'Nona',
};

function getShapeName(sides) {
  return SHAPE_NAMES[sides] || `${sides}-gon`;
}

// The mixer lives in its own Modal. iOS cannot present a second sibling
// modal while it's up — the FX modal mounts an INVISIBLE window that
// swallows every touch. Dismiss the mixer first, then open the rack
// after its dismiss animation has finished.
function openFxPanel(target) {
  updateState(s => { s.ui.mixerOpen = false; });
  setTimeout(() => {
    // Remember the rack came from the mixer so Done returns there
    updateState(s => { s.ui.fxPanel = target; s.ui.fxReturnToMixer = true; });
  }, 300);
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

export default function Mixer() {
  const shapes = useStore(s => s.scenes[s.activeSceneIndex]?.shapes || EMPTY_SHAPES);
  const rescheduleTimer = useRef(null);

  useEffect(() => () => clearTimeout(rescheduleTimer.current), []);

  function onVolumeChange(shapeId, value) {
    // Volume is layer-wide: every bar of the layer (was: only the bar
    // playing at that moment, so the fader "reverted" on the next bar)
    const vol = Math.round(value * 100) / 100;
    updateState(s => {
      editLayerAll(s, shapeId, (sh) => { sh.volume = vol; });
    });
    if (!rescheduleTimer.current) {
      rescheduleTimer.current = setTimeout(() => {
        rescheduleTimer.current = null;
        rescheduleAll();
      }, 50);
    }
  }

  return (
    <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
      {shapes.length === 0 && <Text style={styles.empty}>No shapes</Text>}

      {shapes.map((shape) => {
        const color = COLORS.shapes[shape.colorIndex % COLORS.shapes.length];
        const timbre = TIMBRES.find(t => t.id === shape.timbre);
        const fx = { ...makeDefaultFx(), ...(shape.fx || {}) };
        const vol = shape.volume != null ? shape.volume : 1;
        const activeFx = [
          Math.abs(fx.eqLow) > 0.04 || Math.abs(fx.eqMid) > 0.04 || Math.abs(fx.eqHigh) > 0.04 ? 'EQ' : null,
          fx.cutoff < 0.99 || fx.res > 0.05 || fx.filterType !== 'lowpass' ? 'FLT' : null,
          fx.drive >= 0.15 ? 'DRV' : null,
          fx.echoSend > 0.01 ? 'ECH' : null,
          fx.verbSend > 0.01 ? 'VRB' : null,
        ].filter(Boolean);

        return (
          <View key={shape.id} style={[styles.channel, { backgroundColor: color.fill }]}>
            {/* Whole header is the FX tap target — much easier than the chip */}
            <Pressable style={styles.channelHeader} onPress={() => openFxPanel(shape.id)} hitSlop={4}>
              <View style={[styles.colorDot, { backgroundColor: color.main }]} />
              <Text style={styles.channelName}>{getShapeName(shape.sides)}</Text>
              <Text style={styles.channelTimbre}>{timbre ? timbre.label : ''}</Text>
              <View style={[styles.fxChip, { backgroundColor: color.main }]}>
                <Text style={styles.fxChipText}>
                  {activeFx.length > 0 ? activeFx.join('·') : 'FX ›'}
                </Text>
              </View>
            </Pressable>
            <Fader label="Vol" value={vol} color={color.main}
              onChange={(v) => onVolumeChange(shape.id, v)} />
            <Fader label="Pan" value={fx.pan} min={-1} max={1} color={color.main}
              format={(v) => v < -0.05 ? 'L' + Math.round(-v * 100) : v > 0.05 ? 'R' + Math.round(v * 100) : 'C'}
              onChange={(v) => setShapeFx(shape.id, { pan: Math.round(v * 100) / 100 })} />
          </View>
        );
      })}

      {/* Master */}
      <Pressable style={styles.master} onPress={() => openFxPanel('master')}>
        <Text style={styles.masterTitle}>Master</Text>
        <Text style={styles.masterHint}>eq · echo · reverb · output</Text>
        <Text style={styles.masterChevron}>{'›'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
  },
  empty: {
    fontSize: 13,
    color: COLORS.textDim,
    textAlign: 'center',
    paddingVertical: 20,
  },
  channel: {
    borderRadius: UI.radius,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  channelName: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.text,
  },
  channelTimbre: {
    fontSize: 10,
    color: COLORS.textLight,
  },
  fxChip: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: UI.pill,
    ...UI.softShadow,
  },
  fxChipText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.4,
  },
  faderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 26,
  },
  faderLabel: {
    width: 36,
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textLight,
  },
  faderSlider: {
    flex: 1,
    height: 26,
  },
  faderValue: {
    width: 40,
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textDim,
    textAlign: 'right',
  },
  master: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: UI.radius,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
    marginBottom: 4,
  },
  masterTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.text,
  },
  masterHint: {
    fontSize: 10,
    color: COLORS.textDim,
    flex: 1,
  },
  masterChevron: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textLight,
  },
});
