// Hybrid timbre system: synthesized buffers load instantly, then real .wav
// samples hot-swap in from assets/samples/ for timbres that have them.

const ATTACK_SEC = 0.004;
const MAX_VOICES = 32;
const MAX_NOTES_PER_TICK = 12; // Limit JSI bridge traffic per scheduler tick
const REF_PITCHES = [48, 60, 72]; // C3, C4, C5
const REF_NAMES = ['c3', 'c4', 'c5'];

// Real sample assets — wav files decoded natively via decodeAudioDataSource.
const SAMPLE_ASSETS = {
  piano: {
    c3: require('../../assets/samples/piano_c3.wav'),
    c4: require('../../assets/samples/piano_c4.wav'),
    c5: require('../../assets/samples/piano_c5.wav'),
  },
  guitar: {
    c3: require('../../assets/samples/guitar_c3.wav'),
    c4: require('../../assets/samples/guitar_c4.wav'),
    c5: require('../../assets/samples/guitar_c5.wav'),
  },
};

let sampleBank = null;
const activeVoices = [];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── One-pole lowpass filter (in-place) ───────────────────────
function applyLowpass(data, cutoffHz, sr) {
  const rc = 1.0 / (2 * Math.PI * cutoffHz);
  const dt = 1.0 / sr;
  const alpha = dt / (rc + dt);
  let prev = data[0];
  for (let i = 1; i < data.length; i++) {
    prev = prev + alpha * (data[i] - prev);
    data[i] = prev;
  }
}

// Attack envelope multiplier
function attackEnv(i, sr, sec) {
  const n = Math.ceil(sr * sec);
  return i < n ? i / n : 1;
}

// ── Sample bank ──────────────────────────────────────────────
const PEAK_TARGETS = {
  epiano: 0.75, piano: 0.75, keys: 0.75, organ: 0.70,
  marimba: 0.75, vibes: 0.72, pluck: 0.70, guitar: 0.72,
  strings: 0.65, bass: 0.80, subbass: 0.85,
  kick: 0.90, snare: 0.80, hihat: 0.65, clap: 0.75,
};

const ALL_TIMBRES = [
  'epiano', 'piano', 'keys', 'organ', 'marimba', 'vibes',
  'pluck', 'guitar', 'strings', 'bass', 'subbass',
  'kick', 'snare', 'hihat', 'clap',
];

function initSampleBank(ctx) {
  const sr = ctx.sampleRate || 44100;
  sampleBank = {};
  // Phase 1: synthesized buffers (instant, synchronous)
  for (const id of ALL_TIMBRES) {
    sampleBank[id] = {};
    for (const midi of REF_PITCHES) {
      try {
        const freq = midiToFreq(midi);
        const raw = renderTimbre(id, freq, sr);
        normalize(raw, PEAK_TARGETS[id] || 0.75);
        const buf = ctx.createBuffer(1, raw.length, sr);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < raw.length; i++) ch[i] = raw[i];
        sampleBank[id][midi] = buf;
      } catch (e) {}
    }
  }
  // Phase 2: load real samples immediately, in parallel (m4a files are tiny)
  loadRealSamples(ctx).catch(() => {});
}

async function loadRealSamples(ctx) {
  let Asset;
  try { Asset = require('expo-asset').Asset; } catch (e) { return; }

  // Load all samples in parallel for fastest startup
  const jobs = [];
  for (const [timbreId, assets] of Object.entries(SAMPLE_ASSETS)) {
    for (let i = 0; i < REF_PITCHES.length; i++) {
      const refName = REF_NAMES[i];
      const midi = REF_PITCHES[i];
      if (!assets[refName]) continue;
      jobs.push((async () => {
        try {
          const [asset] = await Asset.loadAsync(assets[refName]);
          const uri = asset.localUri || asset.uri;
          let buf;
          if (ctx.decodeAudioDataSource) {
            buf = await ctx.decodeAudioDataSource(uri);
          } else {
            const resp = await fetch(uri);
            const ab = await resp.arrayBuffer();
            buf = await ctx.decodeAudioData(ab);
          }
          if (buf && sampleBank[timbreId]) sampleBank[timbreId][midi] = buf;
        } catch (e) {}
      })());
    }
  }
  await Promise.all(jobs);
}

function normalize(data, peak) {
  let max = 0;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(data[i]);
    if (a > max) max = a;
  }
  if (max > 0) {
    const scale = peak / max;
    for (let i = 0; i < data.length; i++) data[i] *= scale;
  }
}

function renderTimbre(id, freq, sr) {
  switch (id) {
    case 'epiano':  return renderEPiano(freq, sr);
    case 'piano':   return renderPiano(freq, sr);
    case 'keys':    return renderKeys(freq, sr);
    case 'organ':   return renderOrgan(freq, sr);
    case 'marimba': return renderMarimba(freq, sr);
    case 'vibes':   return renderVibes(freq, sr);
    case 'pluck':   return renderPluck(freq, sr);
    case 'guitar':  return renderGuitar(freq, sr);
    case 'strings': return renderStrings(freq, sr);
    case 'bass':    return renderBass(freq, sr);
    case 'subbass': return renderSubBass(freq, sr);
    case 'kick':    return renderKick(freq, sr);
    case 'snare':   return renderSnare(freq, sr);
    case 'hihat':   return renderHihat(freq, sr);
    case 'clap':    return renderClap(freq, sr);
    default:        return renderEPiano(freq, sr);
  }
}

// ── Electric Piano: Rhodes/Wurlitzer-style ───────────────────
// Warm fundamental + tine attack + subtle chorus from slight detuning.
// Longer sustain, round low end, no harshness.
function renderEPiano(freq, sr) {
  const dur = 2.0;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 400 / freq);

  for (let i = 0; i < len; i++) {
    const t = i / sr;

    // Warm fundamental with long sustain
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.50 * Math.exp(-t / 2.5);

    // Slight detune for chorus warmth (+1.5 cents)
    const chorus = Math.sin(2 * Math.PI * freq * 1.0009 * t) * 0.15 * Math.exp(-t / 2.2);

    // Tine: 2nd harmonic with moderate attack and medium decay
    const tine = Math.sin(2 * Math.PI * freq * 2 * t) * 0.22 * (0.3 + 0.7 * fs)
      * Math.exp(-t / (0.8 + 0.6 * fs));

    // Bark: 3rd harmonic, fast decay — gives the EP its character
    const bark = Math.sin(2 * Math.PI * freq * 3 * t) * 0.10 * fs
      * Math.exp(-t / 0.15);

    // Soft 4th harmonic shimmer
    const shimmer = Math.sin(2 * Math.PI * freq * 4 * t) * 0.04 * fs * fs
      * Math.exp(-t / 0.10);

    data[i] = (fund + chorus + tine + bark + shimmer) * attackEnv(i, sr, 0.003);
  }
  applyLowpass(data, Math.min(6000, 2500 + 3500 * fs), sr);
  return data;
}

// ── Keys: clean acoustic piano-style ─────────────────────────
// Rich harmonic content with natural rolloff, slight inharmonicity
// for realism, warm sustain.
function renderKeys(freq, sr) {
  const dur = 1.8;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 500 / freq);

  // Piano string inharmonicity factor (higher partials go slightly sharp)
  const B = 0.0004;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const envDecay = 1.0 + 0.8 * fs;
    const env = Math.exp(-t / envDecay);

    let s = 0;
    // 6 partials with natural rolloff and slight inharmonicity
    const harmonics = [
      { n: 1, amp: 0.50, decay: 1.0 },
      { n: 2, amp: 0.25, decay: 0.7 },
      { n: 3, amp: 0.12, decay: 0.45 },
      { n: 4, amp: 0.06, decay: 0.30 },
      { n: 5, amp: 0.03, decay: 0.20 },
      { n: 6, amp: 0.015, decay: 0.12 },
    ];

    for (const h of harmonics) {
      const hFreq = freq * h.n * Math.sqrt(1 + B * h.n * h.n);
      if (hFreq > sr * 0.4) continue;
      const hAmp = h.amp * (h.n <= 2 ? 1 : fs);
      const hEnv = Math.exp(-t / (h.decay * (0.4 + 0.6 * fs)));
      s += Math.sin(2 * Math.PI * hFreq * t) * hAmp * hEnv;
    }

    // Subtle hammer noise on attack
    const hammer = Math.sin(2 * Math.PI * freq * 7.1 * t) * 0.03 * Math.exp(-t / 0.008);

    data[i] = (s + hammer) * env * attackEnv(i, sr, 0.002);
  }
  applyLowpass(data, Math.min(8000, 3000 + 5000 * fs), sr);
  return data;
}

// ── Pluck: clean harp/kalimba ────────────────────────────────
// Fewer harmonics, gentle attack, warm lowpass, musical decay.
function renderPluck(freq, sr) {
  const dur = 1.2;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 500 / freq);

  for (let i = 0; i < len; i++) {
    const t = i / sr;

    // Strong, warm fundamental
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.50 * Math.exp(-t / 1.2);

    // 2nd harmonic — gives body
    const h2 = Math.sin(2 * Math.PI * freq * 2 * t) * 0.20 * Math.exp(-t / 0.7);

    // 3rd harmonic — gentle brightness, decays fast
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.10 * fs * Math.exp(-t / 0.35);

    // 4th harmonic — subtle sparkle
    const h4 = Math.sin(2 * Math.PI * freq * 4 * t) * 0.04 * fs * Math.exp(-t / 0.20);

    // 5th harmonic — just a touch
    const h5 = Math.sin(2 * Math.PI * freq * 5 * t) * 0.02 * fs * fs * Math.exp(-t / 0.12);

    // Soft pluck transient
    const transient = Math.sin(2 * Math.PI * freq * 6 * t) * 0.05 * Math.exp(-t / 0.006);

    data[i] = (fund + h2 + h3 + h4 + h5 + transient) * attackEnv(i, sr, 0.001);
  }
  applyLowpass(data, Math.min(6000, 2000 + freq * 3), sr);
  return data;
}

// ── Marimba: woody resonance, natural mallet ─────────────────
function renderMarimba(freq, sr) {
  const dur = 1.2;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 300 / freq);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fundDecay = 0.9 + 0.6 * fs;
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.55 * Math.exp(-t / fundDecay);

    // Sub-octave resonance for warmth
    const sub = Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.15 * fs * Math.exp(-t / 1.2);

    // Mallet contact: short inharmonic burst
    const clickEnv = Math.exp(-t / 0.010);
    const click = Math.sin(2 * Math.PI * freq * 4.0 * t) * 0.10 * clickEnv * (0.4 + 0.6 * fs);

    // 3rd partial for body
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.06 * fs * Math.exp(-t / 0.4);

    data[i] = (fund + sub + click + h3) * attackEnv(i, sr, 0.002);
  }
  applyLowpass(data, Math.min(5000, 2000 + 3000 * fs), sr);
  return data;
}

// ── Bass: warm, full, audible at all pitches ─────────────────
function renderBass(freq, sr) {
  const dur = 1.5;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const f = freq > 200 ? freq * 0.5 : freq;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 1.4);
    const h1 = Math.sin(2 * Math.PI * f * t) * 0.55;
    const h2 = Math.sin(2 * Math.PI * f * 2 * t) * 0.18 * Math.exp(-t / 0.9);
    const h3 = Math.sin(2 * Math.PI * f * 3 * t) * 0.10 * Math.exp(-t / 0.6);
    // Body presence at original freq
    const body = Math.sin(2 * Math.PI * freq * t) * 0.10 * Math.exp(-t / 0.5);
    data[i] = (h1 + h2 + h3 + body) * env * attackEnv(i, sr, 0.005);
  }
  applyLowpass(data, Math.min(3000, 1500 + f * 3), sr);
  return data;
}

// ── Sub Bass: deep but audible on all speakers ───────────────
function renderSubBass(freq, sr) {
  const dur = 1.5;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  let drop;
  if (freq > 300) drop = 0.25;
  else if (freq > 150) drop = 0.5;
  else drop = 1.0;
  const f = freq * drop;

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 1.8);
    const fund = Math.sin(2 * Math.PI * f * t) * 0.65;
    const oct = Math.sin(2 * Math.PI * f * 2 * t) * 0.15 * Math.exp(-t / 1.4);
    // Presence partial at original freq for speaker audibility
    const presence = Math.sin(2 * Math.PI * freq * t) * 0.06 * Math.exp(-t / 0.6);
    data[i] = (fund + oct + presence) * env * attackEnv(i, sr, 0.008);
  }
  return data;
}

// ── Grand Piano: rich, full, natural decay ───────────────────
function renderPiano(freq, sr) {
  const dur = 2.5;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 500 / freq);
  const B = 0.0003;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    const partials = [
      [1, 0.55, 2.0], [2, 0.28, 1.2], [3, 0.14, 0.7],
      [4, 0.07, 0.45], [5, 0.04, 0.3], [6, 0.02, 0.2],
      [7, 0.01, 0.14], [8, 0.005, 0.1],
    ];
    for (const [n, amp, dec] of partials) {
      const hf = freq * n * Math.sqrt(1 + B * n * n);
      if (hf > sr * 0.4) continue;
      s += Math.sin(2 * Math.PI * hf * t) * amp * (n <= 3 ? 1 : fs) * Math.exp(-t / (dec * (0.5 + 0.5 * fs)));
    }
    const hammer = Math.sin(2 * Math.PI * freq * 8.5 * t) * 0.04 * Math.exp(-t / 0.005);
    data[i] = (s + hammer) * Math.exp(-t / (2.2 + fs)) * attackEnv(i, sr, 0.002);
  }
  applyLowpass(data, Math.min(10000, 3500 + 6000 * fs), sr);
  return data;
}

// ── Organ: sustained additive harmonics ──────────────────────
function renderOrgan(freq, sr) {
  const dur = 2.0;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 400 / freq);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 3.0);
    const h1 = Math.sin(2 * Math.PI * freq * t) * 0.40;
    const h2 = Math.sin(2 * Math.PI * freq * 2 * t) * 0.25;
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.15 * fs;
    const h4 = Math.sin(2 * Math.PI * freq * 4 * t) * 0.08 * fs;
    const sub = Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.12;
    // Slight key click
    const click = Math.sin(2 * Math.PI * freq * 6 * t) * 0.03 * Math.exp(-t / 0.008);
    data[i] = (h1 + h2 + h3 + h4 + sub + click) * env * attackEnv(i, sr, 0.006);
  }
  applyLowpass(data, Math.min(5000, 2000 + 3000 * fs), sr);
  return data;
}

// ── Vibraphone: metallic sine with tremolo ───────────────────
function renderVibes(freq, sr) {
  const dur = 2.0;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 400 / freq);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const trem = 1 + 0.15 * Math.sin(2 * Math.PI * 5.5 * t); // motor tremolo
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.50 * Math.exp(-t / 2.2);
    const h2 = Math.sin(2 * Math.PI * freq * 4 * t) * 0.12 * fs * Math.exp(-t / 0.8);
    const h3 = Math.sin(2 * Math.PI * freq * 10 * t) * 0.04 * fs * Math.exp(-t / 0.3);
    const mallet = Math.sin(2 * Math.PI * freq * 3 * t) * 0.08 * Math.exp(-t / 0.015);
    data[i] = (fund + h2 + h3 + mallet) * trem * attackEnv(i, sr, 0.001);
  }
  applyLowpass(data, Math.min(7000, 2500 + 4000 * fs), sr);
  return data;
}

// ── Guitar: nylon acoustic, warm pluck ───────────────────────
function renderGuitar(freq, sr) {
  const dur = 1.8;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 400 / freq);
  const B = 0.0002;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let s = 0;
    const partials = [
      [1, 0.45, 1.5], [2, 0.30, 0.9], [3, 0.18, 0.5],
      [4, 0.10, 0.3], [5, 0.06, 0.2], [6, 0.03, 0.12],
    ];
    for (const [n, amp, dec] of partials) {
      const hf = freq * n * Math.sqrt(1 + B * n * n);
      if (hf > sr * 0.4) continue;
      s += Math.sin(2 * Math.PI * hf * t) * amp * (n <= 2 ? 1 : fs) * Math.exp(-t / (dec * (0.4 + 0.6 * fs)));
    }
    // Finger noise
    const noise = Math.sin(2 * Math.PI * freq * 7.3 * t + t * 300) * 0.06 * Math.exp(-t / 0.004);
    data[i] = (s + noise) * attackEnv(i, sr, 0.001);
  }
  applyLowpass(data, Math.min(6000, 2000 + 4000 * fs), sr);
  return data;
}

// ── Strings: soft ensemble pad ───────────────────────────────
function renderStrings(freq, sr) {
  const dur = 2.5;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 400 / freq);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 3.5);
    // 3 slightly detuned voices for ensemble
    const v1 = Math.sin(2 * Math.PI * freq * 0.998 * t) * 0.30;
    const v2 = Math.sin(2 * Math.PI * freq * t) * 0.35;
    const v3 = Math.sin(2 * Math.PI * freq * 1.002 * t) * 0.30;
    const h2 = Math.sin(2 * Math.PI * freq * 2 * t) * 0.12 * fs * Math.exp(-t / 2.0);
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.05 * fs * Math.exp(-t / 1.2);
    data[i] = (v1 + v2 + v3 + h2 + h3) * env * attackEnv(i, sr, 0.04);
  }
  applyLowpass(data, Math.min(5000, 1800 + 3000 * fs), sr);
  return data;
}

// ── Kick drum: pitch-sweeping sine + body ────────────────────
function renderKick(freq, sr) {
  const dur = 0.5;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Pitch sweeps from ~150Hz down to ~45Hz
    const pitch = 45 + 105 * Math.exp(-t / 0.025);
    const body = Math.sin(2 * Math.PI * pitch * t) * 0.80 * Math.exp(-t / 0.15);
    // Sub thump
    const sub = Math.sin(2 * Math.PI * 42 * t) * 0.35 * Math.exp(-t / 0.25);
    // Click transient
    const click = Math.sin(2 * Math.PI * 1200 * t) * 0.20 * Math.exp(-t / 0.003);
    data[i] = (body + sub + click) * attackEnv(i, sr, 0.0005);
  }
  applyLowpass(data, 4000, sr);
  return data;
}

// ── Snare: body tone + noise rattle ──────────────────────────
function renderSnare(freq, sr) {
  const dur = 0.35;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  // Seeded PRNG for deterministic noise
  let seed = 12345;
  function noise() { seed = (seed * 16807 + 0) % 2147483647; return (seed / 2147483647) * 2 - 1; }
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Body tone ~200Hz
    const body = Math.sin(2 * Math.PI * 185 * t) * 0.35 * Math.exp(-t / 0.06);
    // Snare rattle (filtered noise)
    const rattle = noise() * 0.45 * Math.exp(-t / 0.12);
    // High snap
    const snap = noise() * 0.20 * Math.exp(-t / 0.02);
    data[i] = (body + rattle + snap) * attackEnv(i, sr, 0.0003);
  }
  applyLowpass(data, 8000, sr);
  return data;
}

// ── Hi-hat: filtered noise, tight ────────────────────────────
function renderHihat(freq, sr) {
  const dur = 0.15;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  let seed = 67890;
  function noise() { seed = (seed * 16807 + 0) % 2147483647; return (seed / 2147483647) * 2 - 1; }
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Metallic partials
    const m1 = Math.sin(2 * Math.PI * 3500 * t) * 0.15 * Math.exp(-t / 0.04);
    const m2 = Math.sin(2 * Math.PI * 5200 * t) * 0.10 * Math.exp(-t / 0.03);
    // Noise burst
    const n = noise() * 0.55 * Math.exp(-t / 0.045);
    data[i] = (m1 + m2 + n) * attackEnv(i, sr, 0.0002);
  }
  // Highpass effect: run lowpass then subtract (crude but effective)
  const lp = new Float32Array(data);
  applyLowpass(lp, 3000, sr);
  for (let i = 0; i < len; i++) data[i] = data[i] - lp[i] * 0.7;
  return data;
}

// ── Clap: layered noise bursts ───────────────────────────────
function renderClap(freq, sr) {
  const dur = 0.3;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  let seed = 54321;
  function noise() { seed = (seed * 16807 + 0) % 2147483647; return (seed / 2147483647) * 2 - 1; }
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // 3 micro-bursts to simulate multiple hands
    const b1 = (t > 0.000 && t < 0.012) ? noise() * 0.35 : 0;
    const b2 = (t > 0.018 && t < 0.030) ? noise() * 0.40 : 0;
    const b3 = (t > 0.035 && t < 0.050) ? noise() * 0.45 : 0;
    // Main body
    const body = noise() * 0.50 * Math.exp(-Math.max(0, t - 0.04) / 0.10);
    const bodyGate = t > 0.035 ? 1 : 0;
    data[i] = (b1 + b2 + b3 + body * bodyGate) * attackEnv(i, sr, 0.0002);
  }
  applyLowpass(data, 7000, sr);
  return data;
}

// ── Voice management ─────────────────────────────────────────
function trackVoice(entry) {
  activeVoices.push(entry);
  while (activeVoices.length > MAX_VOICES) {
    const old = activeVoices.shift();
    killVoice(old);
  }
}

function killVoice(entry) {
  // Immediate disconnect — no setValueAtTime calls that could accumulate
  // and trigger the iOS silent-drop bug under heavy voice stealing
  try { if (entry.src) entry.src.stop(); } catch (e) {}
  try { if (entry.src) entry.src.disconnect(); } catch (e) {}
  try { if (entry.gain) entry.gain.disconnect(); } catch (e) {}
}

function pruneVoices(now) {
  let i = 0;
  while (i < activeVoices.length) {
    if (now > activeVoices[i].endTime) {
      activeVoices.splice(i, 1);
    } else {
      i++;
    }
  }
}

// Fade out all active voices (for scene transitions)
function fadeOutAllVoices(ctx) {
  const now = ctx.currentTime;
  // Snapshot voices to clean up — don't clear the global array,
  // because new voices may be added for the new scene during the timeout.
  const toFade = activeVoices.splice(0, activeVoices.length);
  for (const v of toFade) {
    try {
      if (v.gain) {
        // Gentle ramp down over 40ms — no hard jump that would click.
        // setValueAtTime at a future time overrides any in-progress ramp
        // without needing cancelScheduledValues (which crashes 0.6.5).
        const fadeStart = now + 0.005;
        v.gain.gain.setValueAtTime(0, fadeStart + 0.04);
      }
      if (v.src) { try { v.src.stop(now + 0.06); } catch (e) {} }
    } catch (e) {}
  }
  setTimeout(() => {
    for (const v of toFade) {
      try { if (v.src) v.src.disconnect(); } catch (e) {}
      try { if (v.gain) v.gain.disconnect(); } catch (e) {}
    }
  }, 120);
}

// ── Sample lookup ────────────────────────────────────────────
function findSample(timbreId, midi) {
  const bank = sampleBank && sampleBank[timbreId];
  if (!bank) return null;
  let bestRef = REF_PITCHES[0];
  let bestDist = Math.abs(midi - bestRef);
  for (let i = 1; i < REF_PITCHES.length; i++) {
    const d = Math.abs(midi - REF_PITCHES[i]);
    if (d < bestDist) { bestDist = d; bestRef = REF_PITCHES[i]; }
  }
  const buffer = bank[bestRef];
  if (!buffer) return null;
  return { buffer, rate: midiToFreq(midi) / midiToFreq(bestRef) };
}

// ── Public API ───────────────────────────────────────────────
function createTimbre(ctx, timbreId) {
  return { timbreId, dispose() {} };
}

function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration, startTime) {
  if (!ctx || !masterGain || !synth || !stepData || !sampleBank) return;
  const now = ctx.currentTime;
  // Clamp start time to currentTime — future scheduling may crash native audio
  const t = Math.max(startTime || now, now);
  pruneVoices(now);

  const pitches = stepData.pitches || [60];
  const durSec = duration;
  const maxChordNotes = Math.min(pitches.length, 3);

  for (let pi = 0; pi < maxChordNotes; pi++) {
    const pitch = pitches[pi];
    const sample = findSample(synth.timbreId, pitch);
    if (!sample) continue;
    try {
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.playbackRate.value = sample.rate;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(velocity, t + ATTACK_SEC);

      const sampleDur = sample.buffer.duration / sample.rate;
      if (durSec < sampleDur * 0.8) {
        const fadeStart = t + durSec;
        gain.gain.setValueAtTime(velocity, fadeStart);
        // linearRamp instead of exponentialRamp — avoids denormalized floats
        // that can tank native audio thread performance
        gain.gain.linearRampToValueAtTime(0, fadeStart + 0.06);
      }

      src.connect(gain);
      gain.connect(masterGain);
      src.start(t);

      const endTime = t + Math.min(durSec + 0.15, sampleDur) + 0.05;
      trackVoice({ src, gain, endTime });

      const cleanupMs = (endTime - now + 0.1) * 1000;
      setTimeout(() => {
        try { src.disconnect(); } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      }, Math.max(50, cleanupMs));
    } catch (e) {}
  }
}

export { createTimbre, triggerTimbre, initSampleBank };
