import React from 'react';
import { Group, Circle, Path, DashPathEffect, Skia, Text, useFont } from '@shopify/react-native-skia';
import { COLORS, DIMENSIONS } from '../constants.js';

const GhostRing = React.memo(function GhostRing({ radius, centerX, centerY, hover }) {
  if (radius <= 0) return null;

  const ringColor = hover ? COLORS.ghostRingHover : COLORS.ghostRing;

  // Plus icon position (top of ring)
  const iconX = centerX;
  const iconY = centerY - radius;
  const iconR = 16;
  const iconBg = hover ? COLORS.buttonHover : COLORS.buttonBg;
  const iconBorder = hover ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)';

  // Build dashed circle path
  const dashPath = Skia.Path.Make();
  dashPath.addCircle(centerX, centerY, radius);

  return (
    <Group>
      {/* Dashed ring */}
      <Path
        path={dashPath}
        color={ringColor}
        style="stroke"
        strokeWidth={DIMENSIONS.ghostRingWidth}
      >
        <DashPathEffect intervals={[8, 6]} />
      </Path>

      {/* Plus button background */}
      <Circle
        cx={iconX}
        cy={iconY}
        r={iconR}
        color={iconBg}
      />
      <Circle
        cx={iconX}
        cy={iconY}
        r={iconR}
        color={iconBorder}
        style="stroke"
        strokeWidth={1.5}
      />
    </Group>
  );
});

export default GhostRing;
