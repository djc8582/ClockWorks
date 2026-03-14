import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, TIMBRES } from '../constants.js';
import { updateState } from '../state.js';
import { swapTimbre, rescheduleAll } from '../audio/audioEngine.js';

export default function TimbreRow({ shape, color }) {
  if (!shape) return null;

  function onTimbrePress(timbreId) {
    const shapeId = shape.id;
    updateState(s => {
      const sh = s.scenes[s.activeSceneIndex].shapes.find(ss => ss.id === shapeId);
      if (sh) sh.timbre = timbreId;
    });
    swapTimbre({ ...shape, timbre: timbreId });
    rescheduleAll();
  }

  return (
    <View style={styles.container}>
      <View style={styles.timbres}>
        {TIMBRES.map(t => {
          const active = t.id === shape.timbre;
          return (
            <Pressable
              key={t.id}
              style={[
                styles.timbreBtn,
                active && { backgroundColor: color.main },
              ]}
              onPress={() => onTimbrePress(t.id)}
            >
              <Text style={[
                styles.timbreBtnText,
                active && { color: '#fff' },
              ]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  timbres: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  timbreBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  timbreBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: COLORS.text,
  },
});
