import { useMemo, useCallback } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import { getState, getShapes, updateState, generateShapeId } from '../state.js';
import { calculateRingRadii } from '../shapes.js';
import { hitTest, hitTestGhostRing, getNextSideCount, getNextColorIndex } from './hitTesting.js';
import { initAudio, pauseAudio, resumeAudio, rescheduleAll } from '../audio/audioEngine.js';
import { DIMENSIONS, MAX_SHAPES, PITCH, TIMBRES, DRUM_TIMBRES } from '../constants.js';
import { distanceBetween } from '../shapes.js';

const CENTER_TAP_RADIUS = 30;

// All gesture logic runs on JS thread via runOnJS
function handleTap(x, y, centerX, centerY, maxRadius, minRadius) {
  const state = getState();

  // First tap — start audio
  if (!state.ui.audioStarted) {
    initAudio();
    updateState(s => { s.ui.audioStarted = true; s.ui.playing = true; });
    return;
  }

  // Add panel open — handle it
  if (state.ui.addPanelOpen) {
    updateState(s => { s.ui.addPanelOpen = false; });
    return;
  }

  // Tap center = play/pause toggle
  const distFromCenter = distanceBetween(x, y, centerX, centerY);
  if (distFromCenter < CENTER_TAP_RADIUS) {
    if (state.ui.playing) {
      pauseAudio();
      updateState(s => { s.ui.playing = false; });
    } else {
      resumeAudio();
      updateState(s => { s.ui.playing = true; });
    }
    return;
  }

  const shapes = getShapes();
  const radii = calculateRingRadii(shapes.length, maxRadius, minRadius);

  // Hit test vertices
  const hit = hitTest(x, y, shapes, radii, centerX, centerY);
  if (hit) {
    updateState(s => {
      s.ui.panelShapeId = hit.shape.id;
      s.ui.panelSceneIndex = s.activeSceneIndex;
      s.ui.selectedNodeIndex = hit.vertexIndex;
      s.ui.selectedNotes = [];
    });
    return;
  }

  // Ghost ring
  if (hitTestGhostRing(x, y, shapes.length, radii, maxRadius, centerX, centerY)) {
    updateState(s => {
      s.ui.addPanelOpen = true;
      s.ui.addPanelSides = getNextSideCount(shapes);
    });
    return;
  }
}

function handlePinchStart() {
  return getState().ui.canvasZoom || 1.0;
}

function handlePinchUpdate(scale, startZoom) {
  updateState(s => {
    s.ui.canvasZoom = Math.max(
      DIMENSIONS.canvasZoomMin,
      Math.min(DIMENSIONS.canvasZoomMax, startZoom * scale)
    );
  });
}

export function useCanvasGestures({ centerX, centerY, maxRadius, minRadius, width, height }) {
  const onTapEnd = useCallback((e) => {
    handleTap(e.x, e.y, centerX, centerY, maxRadius, minRadius);
  }, [centerX, centerY, maxRadius, minRadius]);

  const tap = useMemo(() =>
    Gesture.Tap()
      .runOnJS(true)
      .onEnd(onTapEnd),
    [onTapEnd]
  );

  const pinch = useMemo(() => {
    let startZoom = 1;
    return Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        startZoom = getState().ui.canvasZoom || 1.0;
      })
      .onUpdate((e) => {
        handlePinchUpdate(e.scale, startZoom);
      });
  }, []);

  const composed = useMemo(() =>
    Gesture.Race(pinch, tap),
    [tap, pinch]
  );

  return composed;
}

// Adds a new shape — called from AddPanel confirm
export function addNewShape(sides) {
  const shapes = getShapes();
  if (shapes.length >= MAX_SHAPES) return;

  const newColor = getNextColorIndex(shapes);

  const lastTimbre = shapes.length > 0 ? shapes[shapes.length - 1].timbre : 'epiano';
  const melodicTimbres = TIMBRES.map(t => t.id).filter(t => !DRUM_TIMBRES.has(t));
  const availableTimbres = melodicTimbres.filter(t => t !== lastTimbre);
  const newTimbre = availableTimbres[0] || 'epiano';

  const newId = generateShapeId();
  const vertices = [];
  for (let i = 0; i < sides; i++) {
    vertices.push({ pitches: [PITCH.defaultPitch], velocity: PITCH.defaultVelocity, muted: false, subs: [] });
  }

  updateState(s => {
    s.scenes[s.activeSceneIndex].shapes.push({
      id: newId, sides, colorIndex: newColor, timbre: newTimbre, volume: 1.0, subdivision: 1, vertices,
    });
    s.ui.panelShapeId = newId;
    s.ui.panelSceneIndex = s.activeSceneIndex;
    s.ui.selectedNodeIndex = 0;
    s.ui.selectedNotes = [];
  });

  rescheduleAll();
}
