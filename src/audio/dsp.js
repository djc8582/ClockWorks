// Shared DSP math — single source of truth for three consumers:
//  1. the live audio graph (band frequencies / Q / gain conventions)
//  2. the Skia effect visualizers (frequency-response curves)
//  3. the offline WAV bounce (exact biquad processing, matching live)
// Coefficients follow the RBJ Audio EQ Cookbook (same as Web Audio).

export const EQ_BANDS = {
  low:  { type: 'lowshelf',  freq: 120,  label: 'Low'  },
  mid:  { type: 'peaking',   freq: 1200, label: 'Mid', Q: 0.9 },
  high: { type: 'highshelf', freq: 6000, label: 'High' },
};
export const EQ_RANGE_DB = 12; // eq params are -1..1 → ±12dB

export function biquadCoeffs(type, freq, Q, gainDb, sampleRate = 44100) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const A = Math.pow(10, (gainDb || 0) / 40);
  const q = Math.max(0.0001, Q || 0.707);
  const alpha = sinw / (2 * q);
  let b0, b1, b2, a0, a1, a2;

  switch (type) {
    case 'lowpass':
      b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cosw; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cosw; b2 = 1 - alpha * A;
      a0 = 1 + alpha / A; a1 = -2 * cosw; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) - (A - 1) * cosw + s);
      b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
      b2 = A * ((A + 1) - (A - 1) * cosw - s);
      a0 = (A + 1) + (A - 1) * cosw + s;
      a1 = -2 * ((A - 1) + (A + 1) * cosw);
      a2 = (A + 1) + (A - 1) * cosw - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * ((A + 1) + (A - 1) * cosw + s);
      b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
      b2 = A * ((A + 1) + (A - 1) * cosw - s);
      a0 = (A + 1) - (A - 1) * cosw + s;
      a1 = 2 * ((A - 1) - (A + 1) * cosw);
      a2 = (A + 1) - (A - 1) * cosw - s;
      break;
    }
    default:
      return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// |H(e^jw)| at a frequency, for response curves
export function magnitudeAt(coeffs, freq, sampleRate = 44100) {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cw = Math.cos(w), sw = Math.sin(w);
  const c2w = Math.cos(2 * w), s2w = Math.sin(2 * w);
  const numRe = coeffs.b0 + coeffs.b1 * cw + coeffs.b2 * c2w;
  const numIm = -(coeffs.b1 * sw + coeffs.b2 * s2w);
  const denRe = 1 + coeffs.a1 * cw + coeffs.a2 * c2w;
  const denIm = -(coeffs.a1 * sw + coeffs.a2 * s2w);
  const den = denRe * denRe + denIm * denIm;
  if (den === 0) return 0;
  return Math.sqrt((numRe * numRe + numIm * numIm) / den);
}

// Sample a response curve over N log-spaced frequencies → array of |H| (dB)
export function responseCurveDb(stages, n = 64, lo = 30, hi = 18000, sampleRate = 44100) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const f = lo * Math.pow(hi / lo, i / (n - 1));
    let mag = 1;
    for (const c of stages) mag *= magnitudeAt(c, f, sampleRate);
    out[i] = 20 * Math.log10(Math.max(1e-6, mag));
  }
  return out;
}

// Offline biquad processing (Direct Form I, in place) — used by the WAV
// bounce so exports match the live graph exactly
export function processBiquad(data, coeffs) {
  const { b0, b1, b2, a1, a2 } = coeffs;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    data[i] = y;
  }
}

// Normalized cutoff (0..1) → Hz, log scale — shared by engine + viz + export
export function cutoffToHz(c, lo = 80, hi = 18000) {
  const x = Math.max(0, Math.min(1, Number(c) ?? 1));
  return lo * Math.pow(hi / lo, x);
}

export function resToQ(r) {
  const x = Math.max(0, Math.min(1, Number(r) || 0));
  return 0.707 + x * 7.3;
}

export function eqGainDb(v) {
  return Math.max(-1, Math.min(1, Number(v) || 0)) * EQ_RANGE_DB;
}
