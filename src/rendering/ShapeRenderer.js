import React from 'react';
import { Group, Path, Circle, Line, Skia, vec } from '@shopify/react-native-skia';
import { COLORS, DIMENSIONS, PITCH } from '../constants.js';
import { getVertexPositions, getStemEndpoint } from '../shapes.js';

// Builds a Skia path for a closed polygon
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
  scale,
  opacity,
  isPanelShape,
  selectedNodeIndex,
  fireAnimations,
}) {
  const color = COLORS.shapes[shape.colorIndex % COLORS.shapes.length];
  const vertices = getVertexPositions(shape.sides, centerX, centerY, radius * scale);

  if (vertices.length === 0) return null;

  const polygonPath = makePolygonPath(vertices);

  // Ring stroke paint
  const ringColor = isPanelShape
    ? color.main + '33'
    : color.main + '15';
  const ringWidth = isPanelShape ? 2 : 1;

  // Prepare fire scale per vertex
  const fireScales = {};
  if (fireAnimations) {
    for (const fa of fireAnimations) {
      if (fa.shapeId === shape.id) {
        fireScales[fa.vertexIndex] = fa.scale || 1;
      }
    }
  }

  return (
    <Group opacity={opacity}>
      {/* Ring circle (guide) */}
      <Circle
        cx={centerX}
        cy={centerY}
        r={radius * scale}
        color={ringColor}
        style="stroke"
        strokeWidth={ringWidth}
      />

      {/* Polygon fill */}
      <Path
        path={polygonPath}
        color={color.fill}
        style="fill"
      />

      {/* Polygon stroke */}
      <Path
        path={polygonPath}
        color={color.main}
        style="stroke"
        strokeWidth={DIMENSIONS.edgeWidth}
        strokeJoin="round"
        strokeCap="round"
      />

      {/* Stems + vertex dots */}
      {shape.vertices.map((v, i) => {
        const pos = vertices[i];
        if (!pos) return null;

        if (v.muted) {
          return (
            <Circle
              key={`muted-${i}`}
              cx={pos.x}
              cy={pos.y}
              r={DIMENSIONS.mutedVertexRadius}
              color={COLORS.muted}
              style="stroke"
              strokeWidth={2}
            />
          );
        }

        const mainPitch = v.pitches ? v.pitches[0] : 60;
        const stemEnd = getStemEndpoint(pos.x, pos.y, centerX, centerY, mainPitch);
        const dotRadius = DIMENSIONS.vertexMinRadius +
          (v.velocity / 127) * (DIMENSIONS.vertexMaxRadius - DIMENSIONS.vertexMinRadius);
        const fScale = fireScales[i] || 1;
        const finalDotR = dotRadius * fScale;

        const isSelectedNode = isPanelShape && i === selectedNodeIndex;

        return (
          <Group key={`vertex-${i}`}>
            {/* Stem line */}
            <Line
              p1={vec(pos.x, pos.y)}
              p2={vec(stemEnd.x, stemEnd.y)}
              color={color.dim}
              style="stroke"
              strokeWidth={DIMENSIONS.stemWidth}
              strokeCap="round"
            />

            {/* Fire glow */}
            {fScale > 1.05 && (
              <Circle
                cx={pos.x}
                cy={pos.y}
                r={finalDotR * 1.5}
                color={color.glow}
              />
            )}

            {/* Selection ring */}
            {isPanelShape && (
              <Circle
                cx={pos.x}
                cy={pos.y}
                r={finalDotR + (isSelectedNode ? 8 : 5)}
                color={isSelectedNode ? color.main : color.glow}
                style="stroke"
                strokeWidth={isSelectedNode ? 2.5 : 1.5}
              />
            )}

            {/* Main vertex dot */}
            <Circle
              cx={pos.x}
              cy={pos.y}
              r={finalDotR}
              color={color.main}
            />

            {/* White highlight */}
            <Circle
              cx={pos.x - finalDotR * 0.2}
              cy={pos.y - finalDotR * 0.25}
              r={finalDotR * 0.35}
              color="rgba(255,255,255,0.5)"
            />
          </Group>
        );
      })}
    </Group>
  );
});

export default ShapeRenderer;
