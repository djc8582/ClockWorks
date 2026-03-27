import React, { useMemo } from 'react';
import { Group, Path, Circle, Line, Skia, vec } from '@shopify/react-native-skia';
import { COLORS, DIMENSIONS } from '../constants.js';
import { getVertexPositions, getStemEndpoint } from '../shapes.js';

function makePolygonPath(vertices) {
  const path = Skia.Path.Make();
  if (vertices.length === 0) return path;
  path.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i++) {
    path.lineTo(vertices[i].x, vertices[i].y);
  }
  path.close();
  return path;
}

const ShapeRenderer = React.memo(function ShapeRenderer({
  shape,
  radius,
  centerX,
  centerY,
  zoom,
  opacity,
  isPanelShape,
  selectedNodeIndex,
}) {
  const color = COLORS.shapes[shape.colorIndex % COLORS.shapes.length];
  // Clamp zoom factor for node sizing — never too big, scales down when zoomed out
  const nodeSizeScale = Math.min(1.4, Math.max(0.4, Math.sqrt(zoom || 1)));

  const vertices = useMemo(
    () => getVertexPositions(shape.sides, centerX, centerY, radius),
    [shape.sides, centerX, centerY, radius]
  );

  const polygonPath = useMemo(
    () => makePolygonPath(vertices),
    [vertices]
  );

  const stemData = useMemo(() => {
    return shape.vertices.map((v, i) => {
      const pos = vertices[i];
      if (!pos || v.muted) return null;
      const mainPitch = v.pitches ? v.pitches[0] : 60;
      const stemEnd = getStemEndpoint(pos.x, pos.y, centerX, centerY, mainPitch);
      const baseRadius = DIMENSIONS.vertexMinRadius +
        ((v.velocity || 85) / 127) * (DIMENSIONS.vertexMaxRadius - DIMENSIONS.vertexMinRadius);
      return {
        p1: vec(pos.x, pos.y),
        p2: vec(stemEnd.x, stemEnd.y),
        dotRadius: baseRadius * nodeSizeScale,
      };
    });
  }, [shape.vertices, vertices, centerX, centerY, nodeSizeScale]);

  if (vertices.length === 0) return null;

  const ringColor = isPanelShape ? color.main + '30' : color.main + '18';
  const strokeScale = nodeSizeScale;

  return (
    <Group opacity={opacity}>
      <Circle
        cx={centerX}
        cy={centerY}
        r={radius}
        color={ringColor}
        style="stroke"
        strokeWidth={1.5 * strokeScale}
      />

      <Path path={polygonPath} color={color.fill} style="fill" />
      <Path
        path={polygonPath}
        color={color.main}
        style="stroke"
        strokeWidth={DIMENSIONS.edgeWidth * strokeScale}
        strokeJoin="round"
        strokeCap="round"
      />

      {shape.vertices.map((v, i) => {
        const pos = vertices[i];
        if (!pos) return null;

        if (v.muted) {
          return (
            <Circle
              key={`m-${i}`}
              cx={pos.x}
              cy={pos.y}
              r={DIMENSIONS.mutedVertexRadius * nodeSizeScale}
              color={COLORS.muted}
              style="stroke"
              strokeWidth={2 * strokeScale}
            />
          );
        }

        const stem = stemData[i];
        if (!stem) return null;
        const isSelectedNode = isPanelShape && i === selectedNodeIndex;

        return (
          <Group key={`v-${i}`}>
            <Line
              p1={stem.p1}
              p2={stem.p2}
              color={color.dim}
              style="stroke"
              strokeWidth={DIMENSIONS.stemWidth * strokeScale}
              strokeCap="round"
            />

            {isPanelShape && (
              <Circle
                cx={pos.x}
                cy={pos.y}
                r={stem.dotRadius + (isSelectedNode ? 6 : 4) * nodeSizeScale}
                color={isSelectedNode ? color.main : color.glow}
                style="stroke"
                strokeWidth={(isSelectedNode ? 2.5 : 1.5) * strokeScale}
              />
            )}

            <Circle
              cx={pos.x}
              cy={pos.y}
              r={stem.dotRadius}
              color={color.main}
            />
          </Group>
        );
      })}
    </Group>
  );
});

export default ShapeRenderer;
