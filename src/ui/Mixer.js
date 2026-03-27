import React, { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, TIMBRES } from '../constants.js';
import { updateState, safeActiveScene } from '../state.js';
import { rescheduleAll } from '../audio/audioEngine.js';
import { useStore } from '../hooks/useStore.js';

const EMPTY_SHAPES = [];

const SHAPE_NAMES = {
  2: 'Line', 3: 'Tri', 4: 'Sq', 5: 'Pent',
  6: 'Hex', 7: 'Hept', 8: 'Oct', 9: 'Non',
};

function getShapeName(sides) {
  return SHAPE_NAMES[sides] || `${sides}`;
}

export default function Mixer() {
  const shapes = useStore(s => s.scenes[s.activeSceneIndex]?.shapes || EMPTY_SHAPES);
  const rescheduleTimer = useRef(null);

  function onVolumeChange(shapeId, value) {
    updateState(s => {
      const scene = safeActiveScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shapeId);
      if (sh) sh.volume = Math.round(value * 100) / 100;
    });
    if (!rescheduleTimer.current) {
      rescheduleTimer.current = setTimeout(() => {
        rescheduleTimer.current = null;
        rescheduleAll();
      }, 50);
    }
  }

  if (shapes.length === 0) {
    return <Text style={styles.empty}>No shapes</Text>;
  }

  return (
    <View style={styles.channels}>
      {shapes.map((shape) => {
        const color = COLORS.shapes[shape.colorIndex % COLORS.shapes.length];
        const timbre = TIMBRES.find(t => t.id === shape.timbre);
        const vol = shape.volume != null ? shape.volume : 1;
        const pct = Math.round(vol * 100);

        return (
          <View key={shape.id} style={styles.channel}>
            {/* Vertical slider */}
            <View style={styles.sliderWrap}>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={1}
                step={0.01}
                value={vol}
                onValueChange={(v) => onVolumeChange(shape.id, v)}
                minimumTrackTintColor={color.main}
                maximumTrackTintColor="rgba(0,0,0,0.1)"
                vertical={true}
              />
            </View>
            <Text style={styles.pct}>{pct}%</Text>
            <View style={[styles.colorDot, { backgroundColor: color.main }]} />
            <Text style={styles.label} numberOfLines={1}>{getShapeName(shape.sides)}</Text>
            <Text style={styles.timbreLabel} numberOfLines={1}>{timbre ? timbre.label : ''}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    fontSize: 13,
    color: COLORS.textDim,
    textAlign: 'center',
    paddingVertical: 20,
  },
  channels: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  channel: {
    alignItems: 'center',
    width: 48,
    gap: 4,
  },
  sliderWrap: {
    height: 120,
    width: 40,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '-90deg' }],
  },
  slider: {
    width: 120,
    height: 40,
  },
  pct: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
  },
  timbreLabel: {
    fontSize: 8,
    color: COLORS.textDim,
  },
});
