import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, StyleSheet, StatusBar, Pressable, Text, useWindowDimensions, Animated, Easing } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { initState, updateState, clearListeners } from './src/state.js';
import { initSequencer } from './src/sequencer.js';
import { useStore } from './src/hooks/useStore.js';
import { COLORS } from './src/constants.js';
import { addNewShape } from './src/gestures/canvasGestures.js';
import { preloadAssets } from './src/audio/timbres.js';

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

// ── Loading screen ──────────────────────────────────────────
// Mirrors the app's actual canvas aesthetic — concentric colored rings
// with a gentle clockhand-like sweep animation.
const LOAD_COLORS = ['#E84855', '#3185FC', '#FFBE0B', '#8338EC', '#06D6A0'];

function LoadingScreen({ onReady }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Smooth clockhand sweep
    Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true })
    ).start();
    // Fade in
    Animated.timing(fade, { toValue: 1, duration: 600, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();

    preloadAssets().then(() => {
      setTimeout(onReady, 300);
    });
  }, []);

  const rotation = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View style={[loadStyles.container, { opacity: fade }]}>
      <StatusBar barStyle="dark-content" />
      <View style={loadStyles.canvas}>
        {/* Concentric rings like the actual app */}
        {[90, 68, 46].map((r, i) => (
          <View
            key={i}
            style={[loadStyles.ring, {
              width: r * 2, height: r * 2, borderRadius: r,
              borderColor: LOAD_COLORS[i] + '30',
            }]}
          />
        ))}

        {/* Small colored dots on each ring (like vertices) */}
        {[90, 68, 46].map((r, i) => {
          const sides = [3, 4, 5][i];
          return Array.from({ length: sides }, (_, j) => {
            const angle = (j / sides) * 360 - 90;
            const rad = (angle * Math.PI) / 180;
            return (
              <View
                key={`d-${i}-${j}`}
                style={[loadStyles.dot, {
                  backgroundColor: LOAD_COLORS[i],
                  left: 100 + r * Math.cos(rad) - 5,
                  top: 100 + r * Math.sin(rad) - 5,
                }]}
              />
            );
          });
        })}

        {/* Animated sweep hand */}
        <Animated.View
          style={[loadStyles.handWrap, { transform: [{ rotate: rotation }] }]}
        >
          <View style={loadStyles.hand} />
        </Animated.View>

        {/* Center dot */}
        <View style={loadStyles.centerDot} />
      </View>

      <Text style={loadStyles.title}>Clockworks</Text>
      <View style={loadStyles.dotsRow}>
        {LOAD_COLORS.map((c, i) => (
          <View key={i} style={[loadStyles.loadDot, { backgroundColor: c }]} />
        ))}
      </View>
    </Animated.View>
  );
}

const loadStyles = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: '#F5F5F7',
    justifyContent: 'center', alignItems: 'center',
  },
  canvas: {
    width: 200, height: 200,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 32,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  dot: {
    position: 'absolute',
    width: 10, height: 10, borderRadius: 5,
  },
  handWrap: {
    position: 'absolute',
    width: 200, height: 200,
    justifyContent: 'center', alignItems: 'center',
  },
  hand: {
    position: 'absolute',
    top: 12,
    width: 2, height: 88,
    backgroundColor: '#333',
    borderRadius: 1,
    alignSelf: 'center',
  },
  centerDot: {
    position: 'absolute',
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#333',
  },
  title: {
    fontSize: 24, fontWeight: '700', color: '#333',
    letterSpacing: -0.5, marginBottom: 12,
  },
  dotsRow: {
    flexDirection: 'row', gap: 8,
  },
  loadDot: {
    width: 6, height: 6, borderRadius: 3, opacity: 0.5,
  },
});

const DEFAULT_PANEL_FRACTION = 0.45;

function AppContent() {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();

  const [canvasLayout, setCanvasLayout] = useState({ width: 300, height: 300 });
  const panelHeight = Math.round(screenHeight * DEFAULT_PANEL_FRACTION);

  const onCanvasLayout = useCallback((layout) => {
    setCanvasLayout(layout);
  }, []);

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
        <CanvasView onLayout={onCanvasLayout} />

        {/* Scene strip */}
        <SceneStrip />

        {/* Bottom panel: piano roll */}
        <View style={[styles.bottomPanel, { height: panelHeight, paddingBottom: insets.bottom }]}>
          {/* Drag handle */}
          <View style={styles.dragHandle}>
            <View style={styles.dragBar} />
          </View>
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

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  handleRecover = () => {
    // Fix #8: Clear orphaned listeners before reinitializing state
    clearListeners();
    initState();
    this.setState({ error: null });
  };
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40, backgroundColor: '#fff' }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#E84855', marginBottom: 12 }}>Crash caught</Text>
          <Text style={{ fontSize: 13, color: '#333', marginBottom: 8 }}>{String(this.state.error)}</Text>
          <Pressable
            style={{ marginTop: 20, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 20, backgroundColor: '#E84855' }}
            onPress={this.handleRecover}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: '#fff' }}>Restart</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    return (
      <SafeAreaProvider>
        <LoadingScreen onReady={() => setLoaded(true)} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ErrorBoundary>
          <AppContent />
        </ErrorBoundary>
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
