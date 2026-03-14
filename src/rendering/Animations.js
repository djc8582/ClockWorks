import React from 'react';
import { Group, Circle, Line, vec } from '@shopify/react-native-skia';

// Fire bloom animations — expanding ring around a vertex that just played
const FireAnimations = React.memo(function FireAnimations({ fires }) {
  if (!fires || fires.length === 0) return null;

  return (
    <Group>
      {fires.map((fire, i) => {
        if (fire.bloomRadius <= 0 || fire.bloomOpacity <= 0) return null;
        return (
          <Circle
            key={`fire-${i}`}
            cx={fire.x}
            cy={fire.y}
            r={fire.bloomRadius}
            color={fire.color}
            style="stroke"
            strokeWidth={2.5}
            opacity={fire.bloomOpacity}
          />
        );
      })}
    </Group>
  );
});

// Spoke animations — line flash from vertex to center
const SpokeAnimations = React.memo(function SpokeAnimations({ spokes }) {
  if (!spokes || spokes.length === 0) return null;

  return (
    <Group>
      {spokes.map((spoke, i) => (
        <Line
          key={`spoke-${i}`}
          p1={vec(spoke.x, spoke.y)}
          p2={vec(spoke.centerX, spoke.centerY)}
          color={spoke.color}
          style="stroke"
          strokeWidth={1.5}
          strokeCap="round"
          opacity={spoke.opacity}
        />
      ))}
    </Group>
  );
});

export { FireAnimations, SpokeAnimations };
