import { PITCH, DIMENSIONS } from './constants.js';

function getVertexPositions(sides, centerX, centerY, radius) {
  const positions = [];
  for (let i = 0; i < sides; i++) {
    const angle = getVertexAngle(i, sides);
    positions.push({
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      angle,
    });
  }
  return positions;
}

function getVertexAngle(vertexIndex, totalVertices) {
  return (vertexIndex / totalVertices) * Math.PI * 2 - Math.PI / 2;
}

function getStemEndpoint(vertexX, vertexY, centerX, centerY, pitch) {
  const pitchRange = PITCH.max - PITCH.min;
  const normalized = (pitch - PITCH.min) / pitchRange;
  const stemFraction = DIMENSIONS.stemMaxFraction - normalized * (DIMENSIONS.stemMaxFraction - DIMENSIONS.stemMinFraction);

  const dx = centerX - vertexX;
  const dy = centerY - vertexY;

  return {
    x: vertexX + dx * stemFraction,
    y: vertexY + dy * stemFraction,
  };
}

function pointInPolygon(px, py, vertices) {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceBetween(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestVertex(px, py, vertices, hitRadius) {
  let closest = -1;
  let minDist = hitRadius;
  for (let i = 0; i < vertices.length; i++) {
    const d = distanceBetween(px, py, vertices[i].x, vertices[i].y);
    if (d < minDist) {
      minDist = d;
      closest = i;
    }
  }
  return closest;
}

function nearestStem(px, py, vertices, stemEndpoints, hitRadius) {
  let closest = -1;
  let minDist = hitRadius;
  for (let i = 0; i < stemEndpoints.length; i++) {
    if (!stemEndpoints[i]) continue;
    const d = distanceBetween(px, py, stemEndpoints[i].x, stemEndpoints[i].y);
    if (d < minDist) {
      minDist = d;
      closest = i;
    }
  }
  return closest;
}

function calculateRingRadii(shapeCount, maxRadius, minRadius) {
  if (shapeCount === 0) return [];
  if (shapeCount === 1) return [maxRadius * 0.75];

  const radii = [];
  for (let i = 0; i < shapeCount; i++) {
    const t = i / (shapeCount - 1);
    radii.push(minRadius + t * (maxRadius - minRadius));
  }
  return radii;
}

function distanceFromCenter(px, py, centerX, centerY) {
  return distanceBetween(px, py, centerX, centerY);
}

export {
  getVertexPositions,
  getVertexAngle,
  getStemEndpoint,
  pointInPolygon,
  nearestVertex,
  nearestStem,
  calculateRingRadii,
  distanceBetween,
  distanceFromCenter,
};
