import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, UI, MIN_SIDES, MAX_SIDES, MAX_SUBDIVISION, makeDefaultFx } from '../constants.js';
import { updateState, generateShapeId, panelBarIndex } from '../state.js';
import { rescheduleAll } from '../audio/audioEngine.js';
import { editLayerBar, removeLayer, addLayer, setLoopLength } from '../looper.js';
import { rebuildPlaybackOrder } from '../sequencer.js';
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

// loopLength = this layer's phrase length in bars (its own looping rule)
export default function PanelHeader({ shape, color, loopLength = 1, maxLoop = 8 }) {
  if (!shape) return null;

  const sub = shape.subdivision || 1;
  const shapeId = shape.id;

  function changeSides(delta) {
    const newSides = shape.sides + delta;
    if (newSides < MIN_SIDES || newSides > MAX_SIDES) return;

    // Pattern edit → lands on the edited bar only (looper.js)
    updateState(s => {
      editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
        sh.sides = newSides;
        if (delta > 0) {
          const sub = sh.subdivision || 1;
          const newVertex = { pitches: [PITCH.defaultPitch], velocity: PITCH.defaultVelocity, muted: false, subs: [] };
          for (let i = 1; i < sub; i++) {
            newVertex.subs.push(makeDefaultStep());
          }
          sh.vertices.push(newVertex);
        } else {
          sh.vertices.pop();
        }
      });
      s.ui.selectedNotes = [];
      if (s.ui.selectedNodeIndex >= newSides) s.ui.selectedNodeIndex = newSides - 1;
    });
    rescheduleAll();
  }

  function changeSubdivision(delta) {
    const oldSub = shape.subdivision || 1;
    const newSub = oldSub + delta;
    if (newSub < 1 || newSub > MAX_SUBDIVISION) return;

    updateState(s => {
      s.ui.selectedNotes = [];
      editLayerBar(s, panelBarIndex(s), shapeId, (sh) => {
        sh.subdivision = newSub;
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
    });
    rescheduleAll();
  }

  // Deleting removes the whole layer (every bar) — layers are instruments
  function deleteShape() {
    updateState(s => {
      const order = s.layerOrder || [];
      const idx = order.indexOf(shapeId);
      removeLayer(s, shapeId);
      if ((s.layerOrder || []).length === 0) {
        addLayer(s, {
          id: generateShapeId(), sides: 3, colorIndex: 0, timbre: "epiano", volume: 1.0, subdivision: 1, fx: makeDefaultFx(),
          vertices: [
            { pitches: [60], velocity: 100, muted: false, subs: [] },
            { pitches: [64], velocity: 85, muted: false, subs: [] },
            { pitches: [67], velocity: 90, muted: false, subs: [] },
          ],
        });
      }
      // Select the neighbouring layer (was: always the first one)
      const left = s.layerOrder;
      s.ui.panelShapeId = left[Math.max(0, Math.min(idx, left.length - 1))] || null;
      s.ui.selectedNodeIndex = 0;
      s.ui.selectedNotes = [];
      if (s.ui.fxPanel === shapeId) s.ui.fxPanel = null;
    });
    rescheduleAll();
  }

  function changeLoop(delta) {
    const n = loopLength + delta;
    if (n < 1 || n > maxLoop) return;
    updateState(s => { setLoopLength(s, shapeId, n); });
    rebuildPlaybackOrder(); // the song may have grown to fit the phrase
    rescheduleAll();
  }

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <View style={[styles.colorDot, { backgroundColor: color.main }]} />
        <Text style={styles.title} numberOfLines={1}>{getShapeName(shape.sides)}</Text>
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

        {/* Loop length — this layer's own phrase, tinted in its color */}
        <View style={[styles.stepper, { backgroundColor: color.fill }]}>
          <Pressable
            style={[styles.stepperBtnTight, loopLength <= 1 && styles.disabled]}
            onPress={() => changeLoop(-1)}
            disabled={loopLength <= 1}
            hitSlop={4}
          >
            <Text style={[styles.stepperBtnText, { color: color.main }]}>{'\u2212'}</Text>
          </Pressable>
          <Text style={[styles.stepperVal, { color: color.main }]}>
            <Text style={[styles.stepperLabel, { color: color.main }]}>{'\u21BB'}</Text>{loopLength}
          </Text>
          <Pressable
            style={[styles.stepperBtnTight, loopLength >= maxLoop && styles.disabled]}
            onPress={() => changeLoop(1)}
            disabled={loopLength >= maxLoop}
            hitSlop={4}
          >
            <Text style={[styles.stepperBtnText, { color: color.main }]}>+</Text>
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
    borderBottomColor: UI.separator,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
    marginRight: 6,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.text,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: UI.chipBg,
    borderRadius: UI.pill,
    overflow: 'hidden',
  },
  stepperBtn: {
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  stepperBtnTight: {
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  stepperBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
  },
  stepperVal: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
    minWidth: 24,
    textAlign: 'center',
  },
  stepperLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textDim,
  },
  disabled: {
    opacity: 0.3,
  },
  deleteBtn: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    backgroundColor: COLORS.shapes[0].fill,
    borderRadius: UI.pill,
  },
  deleteBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.shapes[0].main,
  },
});
