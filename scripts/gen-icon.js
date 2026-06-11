// Generates app icons from the loading-screen design:
// concentric rings + colored polygon-vertex dots + clock hand.
// Pure Node (zlib for PNG) — run: node scripts/gen-icon.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ── PNG encoder ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // filter 0 (None) prefix per scanline
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Canvas with analytic-AA shape compositing ────────────────
function hexToRGB(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function makeCanvas(size) {
  return { size, px: Buffer.alloc(size * size * 4) }; // starts fully transparent
}

function blendPixel(c, x, y, r, g, b, a) {
  if (a <= 0 || x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const da = c.px[i + 3] / 255;
  const outA = a + da * (1 - a);
  if (outA <= 0) return;
  c.px[i]     = Math.round((r * a + c.px[i]     * da * (1 - a)) / outA);
  c.px[i + 1] = Math.round((g * a + c.px[i + 1] * da * (1 - a)) / outA);
  c.px[i + 2] = Math.round((b * a + c.px[i + 2] * da * (1 - a)) / outA);
  c.px[i + 3] = Math.round(outA * 255);
}

// Paint a shape via signed-distance coverage inside a bbox
function paintSDF(c, bbox, sdf, color, alpha) {
  const [r, g, b] = hexToRGB(color);
  const x0 = Math.max(0, Math.floor(bbox[0])), y0 = Math.max(0, Math.floor(bbox[1]));
  const x1 = Math.min(c.size - 1, Math.ceil(bbox[2])), y1 = Math.min(c.size - 1, Math.ceil(bbox[3]));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = sdf(x + 0.5, y + 0.5); // signed distance: <=0 inside
      const cov = Math.max(0, Math.min(1, 0.5 - d));
      if (cov > 0) blendPixel(c, x, y, r, g, b, cov * alpha);
    }
  }
}

function fillBackground(c, cx, cy, innerHex, outerHex, gradRadius) {
  const [ir, ig, ib] = hexToRGB(innerHex);
  const [or_, og, ob] = hexToRGB(outerHex);
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      const t = Math.min(1, Math.hypot(x - cx, y - cy) / gradRadius);
      const i = (y * c.size + x) * 4;
      c.px[i] = Math.round(ir + (or_ - ir) * t);
      c.px[i + 1] = Math.round(ig + (og - ig) * t);
      c.px[i + 2] = Math.round(ib + (ob - ib) * t);
      c.px[i + 3] = 255;
    }
  }
}

function ringSDF(cx, cy, radius, strokeW) {
  return (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - radius) - strokeW / 2;
}
function circleSDF(cx, cy, radius) {
  return (x, y) => Math.hypot(x - cx, y - cy) - radius;
}
function capsuleSDF(x0, y0, x1, y1, halfW) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  return (x, y) => {
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
    return Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)) - halfW;
  };
}

// ── The Clockworks mark (matches LoadingScreen in App.js) ────
const PALETTE = ['#E84855', '#3185FC', '#FFBE0B', '#8338EC', '#06D6A0'];
const HAND_COLOR = '#333333';

function drawMark(c, cx, cy, scale) {
  // Ring radii/sides mirror the loading screen ([90, 68, 46] / [3, 4, 5])
  const rings = [
    { r: 380 * scale, sides: 3, color: PALETTE[0] },
    { r: 290 * scale, sides: 4, color: PALETTE[1] },
    { r: 200 * scale, sides: 5, color: PALETTE[2] },
  ];
  const ringW = 9 * scale;
  const dotR = 27 * scale;

  // Rings (light, ~19% alpha like the loading screen's color+'30')
  for (const ring of rings) {
    paintSDF(c,
      [cx - ring.r - ringW, cy - ring.r - ringW, cx + ring.r + ringW, cy + ring.r + ringW],
      ringSDF(cx, cy, ring.r, ringW), ring.color, 0.19);
  }

  // Clock hand — pointing toward 1 o'clock for a lively, "ticking" feel
  const angle = (-60 * Math.PI) / 180;
  const handLen = 320 * scale;
  const handW = 16 * scale;
  const hx = cx + Math.cos(angle) * handLen;
  const hy = cy + Math.sin(angle) * handLen;
  paintSDF(c,
    [Math.min(cx, hx) - handW, Math.min(cy, hy) - handW, Math.max(cx, hx) + handW, Math.max(cy, hy) + handW],
    capsuleSDF(cx, cy, hx, hy, handW / 2), HAND_COLOR, 1);

  // Vertex dots on each ring (polygon vertices, first at 12 o'clock)
  for (const ring of rings) {
    for (let j = 0; j < ring.sides; j++) {
      const a = (j / ring.sides) * Math.PI * 2 - Math.PI / 2;
      const dx = cx + ring.r * Math.cos(a);
      const dy = cy + ring.r * Math.sin(a);
      paintSDF(c, [dx - dotR - 2, dy - dotR - 2, dx + dotR + 2, dy + dotR + 2],
        circleSDF(dx, dy, dotR), ring.color, 1);
    }
  }

  // Center dot
  const centerR = 24 * scale;
  paintSDF(c, [cx - centerR - 2, cy - centerR - 2, cx + centerR + 2, cy + centerR + 2],
    circleSDF(cx, cy, centerR), HAND_COLOR, 1);
}

const SIZE = 1024;
const outDir = path.join(__dirname, '..', 'assets');

// App icon — opaque, app-background gradient, full-size mark
{
  const c = makeCanvas(SIZE);
  fillBackground(c, SIZE / 2, SIZE / 2, '#FFFFFF', '#F5F5F7', SIZE * 0.7);
  drawMark(c, SIZE / 2, SIZE / 2, 1.0);
  fs.writeFileSync(path.join(outDir, 'icon.png'), encodePNG(SIZE, SIZE, c.px));
  console.log('wrote assets/icon.png');
}

// Android adaptive icon foreground — transparent, mark scaled into the
// safe zone (inner ~66% circle of the canvas)
{
  const c = makeCanvas(SIZE);
  drawMark(c, SIZE / 2, SIZE / 2, 0.72);
  fs.writeFileSync(path.join(outDir, 'adaptive-icon.png'), encodePNG(SIZE, SIZE, c.px));
  console.log('wrote assets/adaptive-icon.png');
}
