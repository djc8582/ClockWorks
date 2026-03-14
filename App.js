import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, StyleSheet, StatusBar, Pressable, Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { initState, getState, getShapes, updateState } from './src/state.js';
import { initSequencer } from './src/sequencer.js';
import { setNoteCallback } from './src/audio/audioEngine.js';
import { useStore } from './src/hooks/useStore.js';
import { COLORS } from './src/constants.js';
import { calculateRingRadii, getVertexPositions } from './src/shapes.js';
import { DIMENSIONS, TIMING } from './src/constants.js';
import { addNewShape } from './src/gestures/canvasGestures.js';

import CanvasView from './src/rendering/CanvasView.js';
import TopBar from './src/ui/TopBar.js';
import SceneStrip from './src/ui/SceneStrip.js';
import PanelHeader from './src/ui/PanelHeader.js';
import TimbreRow from './src/ui/TimbreRow.js';
import PianoRoll from './src/ui/PianoRoll.js';

// Initialize state on module load
initState();
initSequencer();

function AppContent() {
  const insets = useSafeAreaInsets();

  // Animation state for fire/spoke (simplified — driven by note callbacks)
  const [fireAnimations, setFireAnimations] = useState([]);
  const [spokeAnimations, setSpokeAnimations] = useState([]);
  const [canvasLayout, setCanvasLayout] = useState({ width: 300, height: 300 });

  // Canvas layout info for fire animation positioning
  const onCanvasLayout = useCallback((layout) => {
    setCanvasLayout(layout);
  }, []);

  // Note trigger callback — creates fire/spoke animations
  useEffect(() => {
    setNoteCallback((shape, vertexIndex) => {
      const centerX = canvasLayout.width / 2;
      const centerY = canvasLayout.height / 2;
      const maxR = Math.min(centerX, centerY) * DIMENSIONS.maxRadiusFraction;
      const minR = maxR * DIMENSIONS.minRadiusFraction;
      const zoom = getState().ui.canvasZoom || 1.0;
      const shapes = getShapes();
      const radii = calculateRingRadii(shapes.length, maxR * zoom, minR * zoom);
      const si = shapes.findIndex(s => s.id === shape.id);
      if (si === -1) return;
      const positions = getVertexPositions(shape.sides, centerX, centerY, radii[si]);
      const pos = positions[vertexIndex];
      if (!pos) return;

      const color = COLORS.shapes[shape.colorIndex % COLORS.shapes.length];
      const id = Date.now() + Math.random();

      // Add fire animation
      setFireAnimations(prev => [...prev, {
        id,
        shapeId: shape.id,
        vertexIndex,
        x: pos.x,
        y: pos.y,
        color: color.main,
        bloomRadius: 0,
        bloomOpacity: 0.6,
        scale: 1.5,
      }]);

      // Add spoke animation
      setSpokeAnimations(prev => [...prev, {
        id,
        x: pos.x,
        y: pos.y,
        centerX,
        centerY,
        color: color.dim,
        opacity: 0.4,
      }]);

      // Remove after animation duration
      setTimeout(() => {
        setFireAnimations(prev => prev.filter(f => f.id !== id));
        setSpokeAnimations(prev => prev.filter(s => s.id !== id));
      }, TIMING.fireAnimationDuration);
    });
  }, [canvasLayout]);

  // Get panel shape info
  const panelShapeId = useStore(s => s.ui.panelShapeId);
  const shapes = useStore(s => s.scenes[s.activeSceneIndex].shapes);
  const addPanelOpen = useStore(s => s.ui.addPanelOpen);
  const addPanelSides = useStore(s => s.ui.addPanelSides);

  const panelShape = useMemo(() =>
    panelShapeId ? shapes.find(s => s.id === panelShapeId) : (shapes[0] || null),
    [panelShapeId, shapes]
  );

  const panelColor = panelShape
    ? COLORS.shapes[panelShape.colorIndex % COLORS.shapes.length]
    : COLORS.shapes[0];

  // Ensure panel always has a shape selected
  useEffect(() => {
    if (!panelShapeId && shapes.length > 0) {
      updateState(s => {
        s.ui.panelShapeId = shapes[0].id;
        s.ui.selectedNodeIndex = 0;
      });
    }
  }, [panelShapeId, shapes]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* Top bar: BPM + scale */}
      <TopBar />

      {/* Canvas area */}
      <CanvasView
        fireAnimations={fireAnimations}
        spokeAnimations={spokeAnimations}
        onLayout={onCanvasLayout}
      />

      {/* Scene strip */}
      <SceneStrip />

      {/* Bottom panel: piano roll */}
      <View style={[styles.bottomPanel, { paddingBottom: insets.bottom }]}>
        <PanelHeader shape={panelShape} color={panelColor} />
        <TimbreRow shape={panelShape} color={panelColor} />
        <PianoRoll shape={panelShape} color={panelColor} />
      </View>

      {/* Add shape panel overlay */}
      {addPanelOpen && (
        <AddShapeOverlay sides={addPanelSides} />
      )}
    </View>
  );
}

function AddShapeOverlay({ sides }) {
  return (
    <View style={styles.addOverlay}>
      <Pressable
        style={styles.addOverlayBackdrop}
        onPress={() => updateState(s => { s.ui.addPanelOpen = false; })}
      />
      <View style={styles.addPanel}>
        <Text style={styles.addPanelTitle}>Add Shape</Text>
        <Text style={styles.addPanelSides}>{sides} sides</Text>
        <View style={styles.addPanelControls}>
          <Pressable
            style={styles.addPanelBtn}
            onPress={() => updateState(s => {
              s.ui.addPanelSides = Math.max(2, s.ui.addPanelSides - 1);
            })}
          >
            <Text style={styles.addPanelBtnText}>{'\u2212'}</Text>
          </Pressable>
          <Pressable
            style={styles.addPanelBtn}
            onPress={() => updateState(s => {
              s.ui.addPanelSides = Math.min(24, s.ui.addPanelSides + 1);
            })}
          >
            <Text style={styles.addPanelBtnText}>+</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.addConfirmBtn}
          onPress={() => {
            addNewShape(sides);
            updateState(s => { s.ui.addPanelOpen = false; });
          }}
        >
          <Text style={styles.addConfirmText}>Add</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <AppContent />
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  bottomPanel: {
    height: '45%',
    backgroundColor: COLORS.panelBg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  addOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  addPanel: {
    width: 220,
    backgroundColor: COLORS.panelBg,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  addPanelTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },
  addPanelSides: {
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.text,
  },
  addPanelControls: {
    flexDirection: 'row',
    gap: 24,
  },
  addPanelBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addPanelBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  addConfirmBtn: {
    paddingHorizontal: 40,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.shapes[0].main,
  },
  addConfirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
