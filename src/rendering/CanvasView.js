import React, { useMemo, useState, useCallback } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Canvas, Group, Rect, RadialGradient, vec, Circle, Path as SkiaPath } from '@shopify/react-native-skia';
import { GestureDetector } from 'react-native-gesture-handler';
import ShapeRenderer from './ShapeRenderer.js';
import ClockHand from './ClockHand.js';
import GhostRing from './GhostRing.js';
import { COLORS, DIMENSIONS, MAX_SHAPES } from '../constants.js';
import { calculateRingRadii } from '../shapes.js';
import { useStore } from '../hooks/useStore.js';
import { useCanvasGestures, handlePlayPause } from '../gestures/canvasGestures.js';
import { useClockSync } from '../hooks/useClockSync.js';
import { getGhostRadius } from '../gestures/hitTesting.js';

const EMPTY_SHAPES = [];

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

  const shapes = useStore(s => s.scenes[s.activeSceneIndex]?.shapes || EMPTY_SHAPES);
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

          {/* Play/pause visual indicator */}
          <Group>
            {!audioStarted && (
              <Rect x={0} y={0} width={layout.width} height={layout.height} color="rgba(0,0,0,0.08)" />
            )}
            {!audioStarted && (
              <Circle
                cx={centerX}
                cy={centerY}
                r={36}
                color={COLORS.shapes[0].main}
              />
            )}
            {!audioStarted && (
              <SkiaPath
                path={playPath}
                color="white"
              />
            )}
            {audioStarted && !playing && (
              <SkiaPath
                path={playPath}
                color="rgba(0,0,0,0.15)"
              />
            )}
          </Group>
        </Canvas>
      </GestureDetector>

      {/* Native Pressable overlay for instant play/pause response */}
      <Pressable
        style={[
          canvasStyles.playBtn,
          { left: centerX - 35, top: centerY - 35 },
        ]}
        onPress={handlePlayPause}
      />
    </View>
  );
});

const GRADIENT_COLORS = [COLORS.bgGradientCenter, COLORS.bg];

const canvasStyles = StyleSheet.create({
  playBtn: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    zIndex: 10,
  },
});
