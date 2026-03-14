import React from 'react';
import { Group, Line, Circle, vec } from '@shopify/react-native-skia';
import { COLORS, DIMENSIONS, TIMING } from '../constants.js';

const ClockHand = React.memo(function ClockHand({ angle, centerX, centerY, handLength }) {
  if (handLength <= 0) return null;

  const endX = centerX + Math.cos(angle) * handLength;
  const endY = centerY + Math.sin(angle) * handLength;

  // Build trail lines
  const trailSteps = 15;
  const trailLines = [];
  for (let i = 0; i < trailSteps; i++) {
    const t = i / trailSteps;
    const a = angle - TIMING.clockTrailAngle * t;
    const ex = centerX + Math.cos(a) * handLength;
    const ey = centerY + Math.sin(a) * handLength;
    const alpha = 0.04 * (1 - t);
    trailLines.push(
      <Line
        key={`trail-${i}`}
        p1={vec(centerX, centerY)}
        p2={vec(ex, ey)}
        color={`rgba(0,0,0,${alpha})`}
        style="stroke"
        strokeWidth={1}
      />
    );
  }

  return (
    <Group>
      {/* Trail */}
      {trailLines}

      {/* Glow */}
      <Line
        p1={vec(centerX, centerY)}
        p2={vec(endX, endY)}
        color={COLORS.clockHandGlow}
        style="stroke"
        strokeWidth={DIMENSIONS.clockHandGlowWidth}
        strokeCap="round"
      />

      {/* Main hand */}
      <Line
        p1={vec(centerX, centerY)}
        p2={vec(endX, endY)}
        color={COLORS.clockHand}
        style="stroke"
        strokeWidth={DIMENSIONS.clockHandWidth}
        strokeCap="round"
      />

      {/* Center dot */}
      <Circle
        cx={centerX}
        cy={centerY}
        r={4}
        color={COLORS.clockHand}
      />
    </Group>
  );
});

export default ClockHand;
