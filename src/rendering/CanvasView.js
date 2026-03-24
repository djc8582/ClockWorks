import React, { useMemo, useState, useCallback } from 'react';
import { View } from 'react-native';
import { Canvas, Group, Rect, RadialGradient, vec, Circle, Path as SkiaPath } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import ShapeRenderer from './ShapeRenderer.js';
import ClockHand from './ClockHand.js';
import GhostRing from './GhostRing.js';
import { FireAnimations, SpokeAnimations } from './Animations.js';
import { COLORS, DIMENSIONS, MAX_SHAPES } from '../constants.js';
import { calculateRingRadii } from '../shapes.js';
import { useStore } from '../hooks/useStore.js';
import { useCanvasGestures } from '../gestures/canvasGestures.js';
import { useClockSync } from '../hooks/useClockSync.js';
import { getGhostRadius } from '../gestures/hitTesting.js';

export default function CanvasView({
  fireAnimations,
  spokeAnimations,
  onLayout: onLayoutProp,
}) {
  const [layout, setLayout] = useState({ width: 300, height: 300 });
  // clockAngle is now a Reanimated shared value — does NOT trigger React re-renders
  const clockAngle = useClockSync();

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
    if (onLayoutProp) onLayoutProp({ width, height });
  }, [onLayoutProp]);

  const { centerX, centerY, maxRadius, minRadius } = useMemo(() => {
    const cx = layout.width / 2;
    const cy = layout.height / 2;
    const maxR = Math.min(cx, cy) * DIMENSIONS.maxRadiusFraction;
    return { centerX: cx, centerY: cy, maxRadius: maxR, minRadius: maxR * DIMENSIONS.minRadiusFraction };
  }, [layout.width, layout.height]);

  const shapes = useStore(s => s.scenes[s.activeSceneIndex]?.shapes || []);
  const canvasZoom = useStore(s => s.ui.canvasZoom || 1.0);
  const panelShapeId = useStore(s => s.ui.panelShapeId);
  const selectedNodeIndex = useStore(s => s.ui.selectedNodeIndex);
  const audioStarted = useStore(s => s.ui.audioStarted);
  const playing = useStore(s => s.ui.playing);
  const addPanelOpen = useStore(s => s.ui.addPanelOpen);

  const zMaxR = maxRadius * canvasZoom;
  const zMinR = minRadius * canvasZoom;
  const radii = useMemo(() =>
    calculateRingRadii(shapes.length, zMaxR, zMinR),
    [shapes.length, zMaxR, zMinR]
  );

  // Pre-index fireAnimations by shapeId to avoid O(n) scan per ShapeRenderer
  const firesByShape = useMemo(() => {
    const map = {};
    if (fireAnimations) {
      for (const fa of fireAnimations) {
        if (!map[fa.shapeId]) map[fa.shapeId] = [];
        map[fa.shapeId].push(fa);
      }
    }
    return map;
  }, [fireAnimations]);

  const gesture = useCanvasGestures({
    centerX, centerY, maxRadius: zMaxR, minRadius: zMinR,
    width: layout.width, height: layout.height,
  });

  // Clock hand length — extend past outermost ring
  const handLength = radii.length > 0
    ? radii[radii.length - 1] + 40
    : zMaxR + 40;

  // Ghost ring
  const showGhost = shapes.length < MAX_SHAPES && !addPanelOpen;
  const ghostR = showGhost ? getGhostRadius(shapes.length, radii, zMaxR) : 0;

  // Memoize gradient center vec to avoid re-creating every render
  const gradientCenter = useMemo(() => vec(centerX, centerY), [centerX, centerY]);
  const gradientRadius = useMemo(
    () => Math.max(layout.width, layout.height) * 0.7,
    [layout.width, layout.height]
  );

  // Play/pause icon paths — small centered icons
  const playPath = useMemo(
    () => `M ${centerX - 6} ${centerY - 10} L ${centerX + 10} ${centerY} L ${centerX - 6} ${centerY + 10} Z`,
    [centerX, centerY]
  );
  const pausePath = useMemo(
    () => `M ${centerX - 7} ${centerY - 9} L ${centerX - 3} ${centerY - 9} L ${centerX - 3} ${centerY + 9} L ${centerX - 7} ${centerY + 9} Z M ${centerX + 3} ${centerY - 9} L ${centerX + 7} ${centerY - 9} L ${centerX + 7} ${centerY + 9} L ${centerX + 3} ${centerY + 9} Z`,
    [centerX, centerY]
  );

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={{ flex: 1 }}>
          {/* Background gradient */}
          <Rect x={0} y={0} width={layout.width} height={layout.height}>
            <RadialGradient
              c={gradientCenter}
              r={gradientRadius}
              colors={GRADIENT_COLORS}
            />
          </Rect>

          {/* Shapes back to front */}
          {shapes.map((shape, i) => {
            const radius = radii[i];
            if (!radius) return null;

            const isPanelShape = panelShapeId === shape.id;
            let opacity = 1;
            if (panelShapeId && !isPanelShape) opacity = 0.35;

            return (
              <ShapeRenderer
                key={shape.id}
                shape={shape}
                radius={radius}
                centerX={centerX}
                centerY={centerY}
                scale={1}
                opacity={opacity}
                isPanelShape={isPanelShape}
                selectedNodeIndex={selectedNodeIndex}
                fireAnimations={firesByShape[shape.id]}
              />
            );
          })}

          {/* Ghost ring */}
          {showGhost && (
            <GhostRing
              radius={ghostR}
              centerX={centerX}
              centerY={centerY}
              hover={false}
            />
          )}

          {/* Clock hand — angle is a shared value, zero React re-renders */}
          {audioStarted && playing && (
            <ClockHand
              angle={clockAngle}
              centerX={centerX}
              centerY={centerY}
              handLength={handLength}
            />
          )}

          {/* Fire + spoke animations */}
          <FireAnimations fires={fireAnimations} />
          <SpokeAnimations spokes={spokeAnimations} />

          {/* Center play/pause button — always visible */}
          {!audioStarted ? (
            <Group>
              <Rect x={0} y={0} width={layout.width} height={layout.height} color="rgba(0,0,0,0.18)" />
              <Circle cx={centerX} cy={centerY} r={36} color={COLORS.shapes[0].main} />
              <SkiaPath path={playPath} color="white" />
            </Group>
          ) : (
            <Group>
              <Circle cx={centerX} cy={centerY} r={20} color={playing ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.12)'} />
              <SkiaPath path={playing ? pausePath : playPath} color={playing ? 'rgba(0,0,0,0.25)' : COLORS.text} />
            </Group>
          )}
        </Canvas>
      </GestureDetector>
    </View>
  );
}

// Static gradient colors array — never changes, so define outside component
const GRADIENT_COLORS = [COLORS.bgGradientCenter, COLORS.bg];
