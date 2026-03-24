import React, { useMemo, useState, useCallback } from 'react';
import { View } from 'react-native';
import { Canvas, Group, Rect, RadialGradient, vec, Circle, Path as SkiaPath } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import ShapeRenderer from './ShapeRenderer.js';
import ClockHand from './ClockHand.js';
import GhostRing from './GhostRing.js';
import { COLORS, DIMENSIONS, MAX_SHAPES } from '../constants.js';
import { calculateRingRadii } from '../shapes.js';
import { useStore } from '../hooks/useStore.js';
import { useCanvasGestures } from '../gestures/canvasGestures.js';
import { useClockSync } from '../hooks/useClockSync.js';
import { getGhostRadius } from '../gestures/hitTesting.js';

export default React.memo(function CanvasView({ onLayout: onLayoutProp }) {
  const [layout, setLayout] = useState({ width: 300, height: 300 });
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

  const gesture = useCanvasGestures({
    centerX, centerY, maxRadius: zMaxR, minRadius: zMinR,
    width: layout.width, height: layout.height,
  });

  const handLength = radii.length > 0
    ? radii[radii.length - 1] + 40
    : zMaxR + 40;

  const showGhost = shapes.length < MAX_SHAPES && !addPanelOpen;
  const ghostR = showGhost ? getGhostRadius(shapes.length, radii, zMaxR) : 0;

  const gradientCenter = useMemo(() => vec(centerX, centerY), [centerX, centerY]);
  const gradientRadius = useMemo(
    () => Math.max(layout.width, layout.height) * 0.7,
    [layout.width, layout.height]
  );

  const playPath = useMemo(
    () => `M ${centerX - 8} ${centerY - 14} L ${centerX + 14} ${centerY} L ${centerX - 8} ${centerY + 14} Z`,
    [centerX, centerY]
  );
  const pausePath = useMemo(
    () => `M ${centerX - 9} ${centerY - 12} L ${centerX - 4} ${centerY - 12} L ${centerX - 4} ${centerY + 12} L ${centerX - 9} ${centerY + 12} Z M ${centerX + 4} ${centerY - 12} L ${centerX + 9} ${centerY - 12} L ${centerX + 9} ${centerY + 12} L ${centerX + 4} ${centerY + 12} Z`,
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

          {/* Unified play/pause button */}
          <Group>
            {!audioStarted && (
              <Rect x={0} y={0} width={layout.width} height={layout.height} color="rgba(0,0,0,0.15)" />
            )}
            <Circle
              cx={centerX}
              cy={centerY}
              r={playing ? 18 : 36}
              color={playing ? 'rgba(0,0,0,0.05)' : COLORS.shapes[0].main}
            />
            <SkiaPath
              path={playing ? pausePath : playPath}
              color={playing ? 'rgba(0,0,0,0.2)' : 'white'}
            />
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
});

const GRADIENT_COLORS = [COLORS.bgGradientCenter, COLORS.bg];
