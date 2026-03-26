import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, MIN_SIDES, MAX_SIDES, MAX_SUBDIVISION } from '../constants.js';
import { getState, updateState, generateShapeId, safeActiveScene } from '../state.js';
import { rescheduleAll } from '../audio/audioEngine.js';
import { PITCH } from '../constants.js';

const SHAPE_NAMES = {
  2: 'Line', 3: 'Triangle', 4: 'Square', 5: 'Pentagon',
  6: 'Hexagon', 7: 'Heptagon', 8: 'Octagon', 9: 'Nonagon',
  10: 'Decagon', 11: 'Hendecagon', 12: 'Dodecagon',
};

function getShapeName(sides) {
  return SHAPE_NAMES[sides] || `${sides}-gon`;
}

function makeDefaultStep() {
  return { pitches: [], velocity: PITCH.defaultVelocity, muted: true };
}

export default function PanelHeader({ shape, color }) {
  if (!shape) return null;

  const sub = shape.subdivision || 1;
  const shapeId = shape.id;

  function changeSides(delta) {
    const newSides = shape.sides + delta;
    if (newSides < MIN_SIDES || newSides > MAX_SIDES) return;

    // Fix #3: bounds-check activeSceneIndex
    updateState(s => {
      const scene = safeActiveScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shapeId);
      if (!sh) return;
      sh.sides = newSides;
      s.ui.selectedNotes = [];
      if (delta > 0) {
        const sub = sh.subdivision || 1;
        const newVertex = { pitches: [PITCH.defaultPitch], velocity: PITCH.defaultVelocity, muted: false, subs: [] };
        for (let i = 1; i < sub; i++) {
          newVertex.subs.push(makeDefaultStep());
        }
        sh.vertices.push(newVertex);
      } else {
        sh.vertices.pop();
        if (s.ui.selectedNodeIndex >= newSides) s.ui.selectedNodeIndex = newSides - 1;
      }
    });
    rescheduleAll();
  }

  function changeSubdivision(delta) {
    const oldSub = shape.subdivision || 1;
    const newSub = oldSub + delta;
    if (newSub < 1 || newSub > MAX_SUBDIVISION) return;

    // Fix #3: bounds-check activeSceneIndex
    updateState(s => {
      const scene = safeActiveScene(s);
      if (!scene) return;
      const sh = scene.shapes.find(ss => ss.id === shapeId);
      if (!sh) return;
      sh.subdivision = newSub;
      s.ui.selectedNotes = [];
      for (const v of sh.vertices) {
        if (!v.subs) v.subs = [];
        while (v.subs.length < newSub - 1) {
          v.subs.push(makeDefaultStep());
        }
        while (v.subs.length > newSub - 1) {
          v.subs.pop();
        }
      }
    });
    rescheduleAll();
  }

  function deleteShape() {
    // Fix #3: bounds-check activeSceneIndex
    updateState(s => {
      const sc = safeActiveScene(s);
      if (!sc) return;
      sc.shapes = sc.shapes.filter(sh => sh.id !== shapeId);
      if (sc.shapes.length === 0) {
        const newId = generateShapeId();
        sc.shapes.push({
          id: newId, sides: 3, colorIndex: 0, timbre: "epiano", volume: 1.0, subdivision: 1,
          vertices: [
            { pitches: [60], velocity: 100, muted: false, subs: [] },
            { pitches: [64], velocity: 85, muted: false, subs: [] },
            { pitches: [67], velocity: 90, muted: false, subs: [] },
          ],
        });
      }
      s.ui.panelShapeId = sc.shapes[0]?.id || null;
    });
    rescheduleAll();
  }

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={[styles.colorDot, { backgroundColor: color.main }]} />
        <Text style={styles.title}>{getShapeName(shape.sides)}</Text>
      </View>

      <View style={styles.controls}>
        {/* Sides stepper */}
        <View style={styles.stepper}>
          <Pressable
            style={[styles.stepperBtn, shape.sides <= MIN_SIDES && styles.disabled]}
            onPress={() => changeSides(-1)}
            disabled={shape.sides <= MIN_SIDES}
          >
            <Text style={styles.stepperBtnText}>{'\u2212'}</Text>
          </Pressable>
          <Text style={styles.stepperVal}>{shape.sides}</Text>
          <Pressable
            style={[styles.stepperBtn, shape.sides >= MAX_SIDES && styles.disabled]}
            onPress={() => changeSides(1)}
            disabled={shape.sides >= MAX_SIDES}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </Pressable>
        </View>

        {/* Subdivision stepper */}
        <View style={styles.stepper}>
          <Pressable
            style={[styles.stepperBtn, sub <= 1 && styles.disabled]}
            onPress={() => changeSubdivision(-1)}
            disabled={sub <= 1}
          >
            <Text style={styles.stepperBtnText}>{'\u2212'}</Text>
          </Pressable>
          <Text style={styles.stepperVal}>
            <Text style={styles.stepperLabel}>{'\u00F7'}</Text>{sub}
          </Text>
          <Pressable
            style={[styles.stepperBtn, sub >= MAX_SUBDIVISION && styles.disabled]}
            onPress={() => changeSubdivision(1)}
            disabled={sub >= MAX_SUBDIVISION}
          >
            <Text style={styles.stepperBtnText}>+</Text>
          </Pressable>
        </View>

        {/* Delete */}
        <Pressable style={styles.deleteBtn} onPress={deleteShape}>
          <Text style={styles.deleteBtnText}>{'\u00D7'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  stepperBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  stepperBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  stepperVal: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    minWidth: 24,
    textAlign: 'center',
  },
  stepperLabel: {
    fontSize: 11,
    color: COLORS.textDim,
  },
  disabled: {
    opacity: 0.3,
  },
  deleteBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: 'rgba(0,0,0,0.04)',
    borderRadius: 8,
  },
  deleteBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.textDim,
  },
});
