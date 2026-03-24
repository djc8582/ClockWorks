import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, TIMBRES } from '../constants.js';
import { updateState } from '../state.js';
import { useStore } from '../hooks/useStore.js';

const SHAPE_NAMES = {
  2: 'Line', 3: 'Tri', 4: 'Sq', 5: 'Pent',
  6: 'Hex', 7: 'Hept', 8: 'Oct', 9: 'Non',
  10: 'Dec', 11: 'Hend', 12: 'Dodec',
};

function getShapeName(sides) {
  return SHAPE_NAMES[sides] || `${sides}-gon`;
}

export default function Mixer() {
  const shapes = useStore(s => s.scenes[s.activeSceneIndex]?.shapes || []);

  function onVolumeChange(shapeId, value) {
    updateState(s => {
      const sh = s.scenes[s.activeSceneIndex].shapes.find(ss => ss.id === shapeId);
      if (sh) sh.volume = Math.round(value * 100) / 100;
    });
  }

  if (shapes.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>No shapes to mix</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mixer</Text>
      <View style={styles.channels}>
        {shapes.map((shape) => {
          const color = COLORS.shapes[shape.colorIndex % COLORS.shapes.length];
          const timbre = TIMBRES.find(t => t.id === shape.timbre);
          const vol = shape.volume != null ? shape.volume : 1;
          const pct = Math.round(vol * 100);

          return (
            <View key={shape.id} style={styles.channel}>
              {/* Color dot + name */}
              <View style={styles.channelHeader}>
                <View style={[styles.colorDot, { backgroundColor: color.main }]} />
                <Text style={styles.channelName}>{getShapeName(shape.sides)}</Text>
              </View>

              {/* Timbre label */}
              <Text style={styles.channelTimbre}>{timbre ? timbre.label : shape.timbre}</Text>

              {/* Volume slider */}
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1}
                step={0.01}
                value={vol}
                onValueChange={(v) => onVolumeChange(shape.id, v)}
                minimumTrackTintColor={color.main}
                maximumTrackTintColor="rgba(0,0,0,0.1)"
              />

              {/* Volume percentage */}
              <Text style={styles.volumeLabel}>{pct}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.panelBg,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 20,
    textAlign: 'center',
  },
  empty: {
    fontSize: 14,
    color: COLORS.textDim,
    textAlign: 'center',
    marginTop: 40,
  },
  channels: {
    gap: 20,
  },
  channel: {
    gap: 4,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  channelName: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  channelTimbre: {
    fontSize: 11,
    color: COLORS.textDim,
    marginLeft: 20,
  },
  slider: {
    height: 32,
    marginHorizontal: -4,
  },
  volumeLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textDim,
    textAlign: 'right',
  },
});
