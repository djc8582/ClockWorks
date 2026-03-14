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

function getGhostRadius(shapeCount, radii, maxR) {
  if (shapeCount === 0) return maxR * 0.5;
  const outermost = radii[radii.length - 1];
  const gap = shapeCount > 1
    ? (radii[radii.length - 1] - radii[radii.length - 2])
    : outermost * 0.4;
  return Math.min(outermost + gap * 0.7, maxR * 1.15);
}

export default function CanvasView({
  fireAnimations,
  spokeAnimations,
  onLayout: onLayoutProp,
}) {
  const [layout, setLayout] = useState({ width: 300, height: 300 });
  const clockAngle = useClockSync();

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
    if (onLayoutProp) onLayoutProp({ width, height });
  }, [onLayoutProp]);

  const centerX = layout.width / 2;
  const centerY = layout.height / 2;
  const maxRadius = Math.min(centerX, centerY) * DIMENSIONS.maxRadiusFraction;
  const minRadius = maxRadius * DIMENSIONS.minRadiusFraction;

  const shapes = useStore(s => s.scenes[s.activeSceneIndex].shapes);
  const canvasZoom = useStore(s => s.ui.canvasZoom || 1.0);
  const panelShapeId = useStore(s => s.ui.panelShapeId);
  const selectedNodeIndex = useStore(s => s.ui.selectedNodeIndex);
  const audioStarted = useStore(s => s.ui.audioStarted);
  const addPanelOpen = useStore(s => s.ui.addPanelOpen);

  const zMaxR = maxRadius * canvasZoom;
  const zMinR = minRadius * canvasZoom;
  const radii = useMemo(() =>
    calculateRingRadii(shapes.length, zMaxR, zMinR),
    [shapes.length, zMaxR, zMinR]
  );

  const gesture = useCanvasGestures({
    centerX, centerY, maxRadius: zMaxR, minRadius: zMinR,
    width: layout.width, height: layout.height,
  });

  // Clock hand length
  const handLength = radii.length > 0
    ? radii[radii.length - 1] + 30
    : zMaxR + 30;

  // Ghost ring
  const showGhost = shapes.length < MAX_SHAPES && !addPanelOpen;
  const ghostR = showGhost ? getGhostRadius(shapes.length, radii, zMaxR) : 0;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={{ flex: 1 }}>
          {/* Background gradient */}
          <Rect x={0} y={0} width={layout.width} height={layout.height}>
            <RadialGradient
              c={vec(centerX, centerY)}
              r={Math.max(layout.width, layout.height) * 0.7}
              colors={[COLORS.bgGradientCenter, COLORS.bg]}
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
                fireAnimations={fireAnimations}
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

          {/* Clock hand */}
          {audioStarted && (
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

          {/* Tap to start overlay */}
          {!audioStarted && (
            <Group>
              <Rect x={0} y={0} width={layout.width} height={layout.height} color="rgba(0,0,0,0.25)" />
              <Circle cx={centerX} cy={centerY} r={72} color={COLORS.shapes[0].main} />
              <Circle cx={centerX} cy={centerY} r={68} color="rgba(255,255,255,0.15)" />
              <SkiaPath
                path={`M ${centerX - 18} ${centerY - 28} L ${centerX + 30} ${centerY} L ${centerX - 18} ${centerY + 28} Z`}
                color="white"
              />
            </Group>
          )}
        </Canvas>
      </GestureDetector>
    </View>
  );
}
