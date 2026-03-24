import { DIMENSIONS, MAX_SHAPES, COLORS, TIMBRES, PITCH } from '../constants.js';
import { getVertexPositions, nearestVertex, calculateRingRadii, distanceBetween, distanceFromCenter } from '../shapes.js';

// Returns { type, shapeIndex, vertexIndex, shape } or null
function hitTest(x, y, shapes, radii, centerX, centerY) {
  // Check vertices (front to back = highest index first)
  for (let si = shapes.length - 1; si >= 0; si--) {
    const shape = shapes[si];
    const radius = radii[si];
    const positions = getVertexPositions(shape.sides, centerX, centerY, radius);
    const vi = nearestVertex(x, y, positions, DIMENSIONS.hitRadius);
    if (vi !== -1) {
      return { type: 'vertex', shapeIndex: si, vertexIndex: vi, shape };
    }
  }
  return null;
}

function hitTestGhostRing(x, y, shapeCount, radii, maxR, centerX, centerY) {
  if (shapeCount >= MAX_SHAPES) return false;
  const ghostR = getGhostRadius(shapeCount, radii, maxR);
  const dist = distanceFromCenter(x, y, centerX, centerY);
  return Math.abs(dist - ghostR) < DIMENSIONS.hitRadius + 8;
}

function getGhostRadius(shapeCount, radii, maxR) {
  if (shapeCount === 0) return maxR * 0.5;
  const outermost = radii[radii.length - 1];
  const gap = shapeCount > 1
    ? (radii[radii.length - 1] - radii[radii.length - 2])
    : outermost * 0.4;
  return Math.min(outermost + gap * 1.2, maxR * 1.35);
}

function getNextSideCount(shapes) {
  const usedSides = shapes.map(s => s.sides);
  for (const s of [4, 5, 6, 7, 3, 8, 9, 2]) {
    if (!usedSides.includes(s)) return s;
  }
  return 4;
}

function getNextColorIndex(shapes) {
  const used = shapes.map(s => s.colorIndex);
  for (let i = 0; i < COLORS.shapes.length; i++) {
    if (!used.includes(i)) return i;
  }
  return shapes.length % COLORS.shapes.length;
}

export { hitTest, hitTestGhostRing, getGhostRadius, getNextSideCount, getNextColorIndex };
