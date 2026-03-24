import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, StatusBar, Pressable, Text, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
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
import Mixer from './src/ui/Mixer.js';

// Initialize state on module load
initState();
initSequencer();

// ── Animation pool constants ─────────────────────────────────
// Use a fixed-size pool with recycling instead of unbounded array growth.
const MAX_FIRE_ANIMATIONS = 20;
const MAX_SPOKE_ANIMATIONS = 20;

const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_FRACTION = 0.75;
const DEFAULT_PANEL_FRACTION = 0.45;

function AppContent() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  // Animation state for fire/spoke (simplified — driven by note callbacks)
  const [fireAnimations, setFireAnimations] = useState([]);
  const [spokeAnimations, setSpokeAnimations] = useState([]);
  const [canvasLayout, setCanvasLayout] = useState({ width: 300, height: 300 });
  const [panelHeight, setPanelHeight] = useState(Math.round(screenHeight * DEFAULT_PANEL_FRACTION));
  const panelDragStart = useRef(0);

  // Track pending timeouts for cleanup on unmount
  const pendingTimers = useRef(new Set());
  const animIdCounter = useRef(0);

  // Drag handle for resizing bottom panel
  const panelDrag = useMemo(() =>
    Gesture.Pan()
      .runOnJS(true)
      .onStart(() => {
        panelDragStart.current = panelHeight;
      })
      .onUpdate((e) => {
        const maxH = Math.round(screenHeight * MAX_PANEL_FRACTION);
        const newH = Math.round(panelDragStart.current - e.translationY);
        setPanelHeight(Math.max(MIN_PANEL_HEIGHT, Math.min(maxH, newH)));
      }),
    [panelHeight, screenHeight]
  );

  // Canvas layout info for fire animation positioning
  const onCanvasLayout = useCallback((layout) => {
    setCanvasLayout(layout);
  }, []);

  // Clean up all pending timers on unmount
  useEffect(() => {
    const timers = pendingTimers.current;
    return () => {
      for (const t of timers) {
        clearTimeout(t);
      }
      timers.clear();
    };
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
      // Use incrementing counter instead of Date.now() + Math.random()
      const id = ++animIdCounter.current;

      // Add fire animation — hard cap with simple truncation (no slice copies)
      setFireAnimations(prev => {
        const next = prev.length >= MAX_FIRE_ANIMATIONS
          ? prev.slice(-(MAX_FIRE_ANIMATIONS - 5))
          : prev;
        return [...next, {
          id,
          shapeId: shape.id,
          vertexIndex,
          x: pos.x,
          y: pos.y,
          color: color.main,
          bloomRadius: 0,
          bloomOpacity: 0.6,
          scale: 1.5,
        }];
      });

      // Add spoke animation — hard cap
      setSpokeAnimations(prev => {
        const next = prev.length >= MAX_SPOKE_ANIMATIONS
          ? prev.slice(-(MAX_SPOKE_ANIMATIONS - 5))
          : prev;
        return [...next, {
          id,
          x: pos.x,
          y: pos.y,
          centerX,
          centerY,
          color: color.dim,
          opacity: 0.4,
        }];
      });

      // Remove after animation duration — track timer for cleanup
      const timer = setTimeout(() => {
        pendingTimers.current.delete(timer);
        setFireAnimations(prev => prev.filter(f => f.id !== id));
        setSpokeAnimations(prev => prev.filter(s => s.id !== id));
      }, TIMING.fireAnimationDuration);

      pendingTimers.current.add(timer);
    });
  }, [canvasLayout]);

  // Get panel shape info — use panelSceneIndex so auto-advance doesn't
  // switch what the user is editing
  const panelShapeId = useStore(s => s.ui.panelShapeId);
  const panelSceneIndex = useStore(s => s.ui.panelSceneIndex);
  const panelShapes = useStore(s => {
    const idx = Math.min(s.ui.panelSceneIndex, s.scenes.length - 1);
    return s.scenes[idx]?.shapes || [];
  });
  const mixerOpen = useStore(s => s.ui.mixerOpen);
  const addPanelOpen = useStore(s => s.ui.addPanelOpen);
  const addPanelSides = useStore(s => s.ui.addPanelSides);

  const panelShape = useMemo(() =>
    panelShapeId ? panelShapes.find(s => s.id === panelShapeId) : (panelShapes[0] || null),
    [panelShapeId, panelShapes]
  );

  const panelColor = panelShape
    ? COLORS.shapes[panelShape.colorIndex % COLORS.shapes.length]
    : COLORS.shapes[0];

  // Ensure panel always has a shape selected
  useEffect(() => {
    if (!panelShapeId && panelShapes.length > 0) {
      updateState(s => {
        s.ui.panelShapeId = panelShapes[0].id;
        s.ui.selectedNodeIndex = 0;
      });
    }
  }, [panelShapeId, panelShapes]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />

      {/* Top bar: BPM + mixer toggle */}
      <TopBar />

      {/* Mixer — shown/hidden without unmounting */}
      {mixerOpen && <Mixer />}

      {/* Normal view — hidden when mixer is open, stays mounted */}
      <View style={mixerOpen ? styles.hidden : { flex: 1 }}>
        {/* Canvas area */}
        <CanvasView
          fireAnimations={fireAnimations}
          spokeAnimations={spokeAnimations}
          onLayout={onCanvasLayout}
        />

        {/* Scene strip */}
        <SceneStrip />

        {/* Bottom panel: piano roll — resizable via drag handle */}
        <View style={[styles.bottomPanel, { height: panelHeight, paddingBottom: insets.bottom }]}>
          {/* Drag handle */}
          <GestureDetector gesture={panelDrag}>
            <View style={styles.dragHandle}>
              <View style={styles.dragBar} />
            </View>
          </GestureDetector>
          <PanelHeader shape={panelShape} color={panelColor} />
          <TimbreRow shape={panelShape} color={panelColor} />
          <PianoRoll shape={panelShape} color={panelColor} />
        </View>
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
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  bottomPanel: {
    backgroundColor: COLORS.panelBg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  dragHandle: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  dragBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
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
