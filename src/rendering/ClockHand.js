import React from 'react';
import { Group, Line, Circle, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { COLORS, DIMENSIONS, TIMING } from '../constants.js';

const TRAIL_STEPS = 8;
const TRAIL_FRACTIONS = Array.from({ length: TRAIL_STEPS }, (_, i) => i / TRAIL_STEPS);
const TRAIL_COLORS = TRAIL_FRACTIONS.map(t => `rgba(0,0,0,${0.04 * (1 - t)})`);

// ClockHand uses a SINGLE useDerivedValue that computes ALL positions.
// JS props (centerX, centerY, handLength) are bridged to shared values so
// the worklet is created once and never recreated — avoiding the native crash
// from Skia reading a disposed derived value during worklet recreation.
function ClockHandInner({ angle, centerX, centerY, handLength }) {
  if (handLength <= 0) return null;

  // Bridge JS props to shared values — stable references, no worklet recreation
  const cx = useSharedValue(centerX);
  const cy = useSharedValue(centerY);
  const hl = useSharedValue(handLength);
  cx.value = centerX;
  cy.value = centerY;
  hl.value = handLength;

  // Single derived value computes ALL positions — one worklet, never recreated
  const positions = useDerivedValue(() => {
    const a = angle.value;
    const x = cx.value;
    const y = cy.value;
    const len = hl.value;

    const endPt = vec(x + Math.cos(a) * len, y + Math.sin(a) * len);
    const centerPt = vec(x, y);

    const trails = [];
    for (let i = 0; i < TRAIL_STEPS; i++) {
      const ta = a - TIMING.clockTrailAngle * TRAIL_FRACTIONS[i];
      trails.push(vec(x + Math.cos(ta) * len, y + Math.sin(ta) * len));
    }

    return { centerPt, endPt, trails };
  });

  // Thin derived values that extract from the single positions object
  const center = useDerivedValue(() => positions.value.centerPt);
  const endPoint = useDerivedValue(() => positions.value.endPt);
  const t0 = useDerivedValue(() => positions.value.trails[0]);
  const t1 = useDerivedValue(() => positions.value.trails[1]);
  const t2 = useDerivedValue(() => positions.value.trails[2]);
  const t3 = useDerivedValue(() => positions.value.trails[3]);
  const t4 = useDerivedValue(() => positions.value.trails[4]);
  const t5 = useDerivedValue(() => positions.value.trails[5]);
  const t6 = useDerivedValue(() => positions.value.trails[6]);
  const t7 = useDerivedValue(() => positions.value.trails[7]);

  const trails = [t0, t1, t2, t3, t4, t5, t6, t7];

  return (
    <Group>
      {/* Trail */}
      {trails.map((ep, i) => (
        <Line
          key={i}
          p1={center}
          p2={ep}
          color={TRAIL_COLORS[i]}
          style="stroke"
          strokeWidth={1}
        />
      ))}

      {/* Glow */}
      <Line
        p1={center}
        p2={endPoint}
        color={COLORS.clockHandGlow}
        style="stroke"
        strokeWidth={DIMENSIONS.clockHandGlowWidth}
        strokeCap="round"
      />

      {/* Main hand */}
      <Line
        p1={center}
        p2={endPoint}
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
}

const ClockHand = React.memo(ClockHandInner);

export default ClockHand;
