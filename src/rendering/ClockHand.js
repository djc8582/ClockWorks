import React from 'react';
import { Group, Line, Circle, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { COLORS, DIMENSIONS, TIMING } from '../constants.js';

const TRAIL_STEPS = 8;
const TRAIL_FRACTIONS = Array.from({ length: TRAIL_STEPS }, (_, i) => i / TRAIL_STEPS);
const TRAIL_COLORS = TRAIL_FRACTIONS.map(t => `rgba(0,0,0,${0.04 * (1 - t)})`);
const TRAIL_ANGLE = TIMING.clockTrailAngle;

// ClockHand: angle is a Reanimated shared value. centerX/centerY/handLength
// are bridged to shared values so useDerivedValue worklets never recreate.
function ClockHandInner({ angle, centerX, centerY, handLength }) {
  if (handLength <= 0) return null;

  const cx = useSharedValue(centerX);
  const cy = useSharedValue(centerY);
  const hl = useSharedValue(handLength);
  cx.value = centerX;
  cy.value = centerY;
  hl.value = handLength;

  const center = useDerivedValue(() => vec(cx.value, cy.value));
  const endPoint = useDerivedValue(() => {
    const a = angle.value;
    return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value);
  });

  // Each trail is its own derived value — stable hook count, no array extraction
  const tr0 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[0]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr1 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[1]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr2 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[2]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr3 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[3]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr4 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[4]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr5 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[5]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr6 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[6]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });
  const tr7 = useDerivedValue(() => { const a = angle.value - TRAIL_ANGLE * TRAIL_FRACTIONS[7]; return vec(cx.value + Math.cos(a) * hl.value, cy.value + Math.sin(a) * hl.value); });

  const trails = [tr0, tr1, tr2, tr3, tr4, tr5, tr6, tr7];

  return (
    <Group>
      {trails.map((ep, i) => (
        <Line key={i} p1={center} p2={ep} color={TRAIL_COLORS[i]} style="stroke" strokeWidth={1} />
      ))}
      <Line p1={center} p2={endPoint} color={COLORS.clockHandGlow} style="stroke" strokeWidth={DIMENSIONS.clockHandGlowWidth} strokeCap="round" />
      <Line p1={center} p2={endPoint} color={COLORS.clockHand} style="stroke" strokeWidth={DIMENSIONS.clockHandWidth} strokeCap="round" />
      <Circle cx={centerX} cy={centerY} r={4} color={COLORS.clockHand} />
    </Group>
  );
}

const ClockHand = React.memo(ClockHandInner);
export default ClockHand;
