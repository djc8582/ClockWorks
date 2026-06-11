// Hybrid timbre system: real WAV samples for melodic + drums,
// synth buffers as fallback for keys/organ/marimba/vibes/pluck.
// 6 octaves of samples (C1–C6) for minimal pitch-shifting artifacts.

const ATTACK_SEC = 0.004;
// 48 voices: large enough that at capped tempo voices expire naturally
// instead of being evicted mid-life — eviction is a native stop/disconnect
// on a PLAYING node, the riskiest operation on react-native-audio-api 0.6.5
const MAX_VOICES = 48;
const REF_PITCHES = [24, 36, 48, 60, 72, 84]; // C1, C2, C3, C4, C5, C6
const REF_NAMES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];

// WAV sample assets — 5 melodic timbres × 6 octaves (guitar missing C6)
const SAMPLE_ASSETS = {
  epiano: {
    c1: require('../../assets/samples/epiano_c1.wav'),
    c2: require('../../assets/samples/epiano_c2.wav'),
    c3: require('../../assets/samples/epiano_c3.wav'),
    c4: require('../../assets/samples/epiano_c4.wav'),
    c5: require('../../assets/samples/epiano_c5.wav'),
    c6: require('../../assets/samples/epiano_c6.wav'),
  },
  piano: {
    c1: require('../../assets/samples/piano_c1.wav'),
    c2: require('../../assets/samples/piano_c2.wav'),
    c3: require('../../assets/samples/piano_c3.wav'),
    c4: require('../../assets/samples/piano_c4.wav'),
    c5: require('../../assets/samples/piano_c5.wav'),
    c6: require('../../assets/samples/piano_c6.wav'),
  },
  guitar: {
    c1: require('../../assets/samples/guitar_c1.wav'),
    c2: require('../../assets/samples/guitar_c2.wav'),
    c3: require('../../assets/samples/guitar_c3.wav'),
    c4: require('../../assets/samples/guitar_c4.wav'),
    c5: require('../../assets/samples/guitar_c5.wav'),
  },
  nylon: {
    c1: require('../../assets/samples/nylon_c1.wav'),
    c2: require('../../assets/samples/nylon_c2.wav'),
    c3: require('../../assets/samples/nylon_c3.wav'),
    c4: require('../../assets/samples/nylon_c4.wav'),
    c5: require('../../assets/samples/nylon_c5.wav'),
    c6: require('../../assets/samples/nylon_c6.wav'),
  },
  synth: {
    c1: require('../../assets/samples/synth_c1.wav'),
    c2: require('../../assets/samples/synth_c2.wav'),
    c3: require('../../assets/samples/synth_c3.wav'),
    c4: require('../../assets/samples/synth_c4.wav'),
    c5: require('../../assets/samples/synth_c5.wav'),
    c6: require('../../assets/samples/synth_c6.wav'),
  },
};

const DRUM_KIT_ASSETS = {
  drumkit1: {
    kick:  require('../../assets/samples/drums/kit1_kick.wav'),
    snare: require('../../assets/samples/drums/kit1_snare.wav'),
    hihat: require('../../assets/samples/drums/kit1_hihat.wav'),
    perc:  require('../../assets/samples/drums/kit1_perc.wav'),
  },
  drumkit2: {
    kick:  require('../../assets/samples/drums/kit2_kick.wav'),
    snare: require('../../assets/samples/drums/kit2_snare.wav'),
    hihat: require('../../assets/samples/drums/kit2_hihat.wav'),
    perc:  require('../../assets/samples/drums/kit2_perc.wav'),
  },
  drumkit3: {
    kick:  require('../../assets/samples/drums/kit3_kick.wav'),
    snare: require('../../assets/samples/drums/kit3_snare.wav'),
    hihat: require('../../assets/samples/drums/kit3_hihat.wav'),
    perc:  require('../../assets/samples/drums/kit3_perc.wav'),
  },
};

// Timbres that use synthesized buffers (no WAV files — instant fallback)
const SYNTH_TIMBRES = ['keys', 'organ', 'marimba', 'vibes', 'pluck'];
const PEAK_TARGETS = { keys: 0.75, organ: 0.70, marimba: 0.75, vibes: 0.72, pluck: 0.70 };

// Granular timbres — rendered at init by a real grain engine: clouds of
// short Hann-windowed grains sprayed across a source sample, with random
// position, length, amplitude and per-grain pitch (octave shimmer etc.),
// overlap-added into a new buffer. Playback is ONE BufferSource per note —
// authentic granular texture with zero runtime scheduling risk.
const GRANULAR_DEFS = {
  cloud:   { src: 'epiano', grains: 90,  lenMin: 0.06, lenMax: 0.16, pitches: [1],        spray: 1.0,  dur: 2.4, env: 'pad'  },
  shimmer: { src: 'synth',  grains: 110, lenMin: 0.05, lenMax: 0.12, pitches: [1, 2],     spray: 1.0,  dur: 2.6, env: 'pad'  },
  stutter: { src: 'pluck',  grains: 48,  lenMin: 0.03, lenMax: 0.06, pitches: [1, 0.5],   spray: 0.25, dur: 1.2, env: 'perc' },
};

function renderGranular(def, srcData, sr) {
  const len = Math.ceil(def.dur * sr);
  const out = new Float32Array(len);
  for (let gIdx = 0; gIdx < def.grains; gIdx++) {
    const gLen = Math.floor((def.lenMin + Math.random() * (def.lenMax - def.lenMin)) * sr);
    const outStart = Math.floor(Math.random() * Math.max(1, len - gLen));
    const srcSpan = Math.max(1, Math.floor(srcData.length * def.spray) - gLen * 2);
    const srcStart = Math.floor(Math.random() * srcSpan);
    const pitch = def.pitches[Math.floor(Math.random() * def.pitches.length)];
    const amp = 0.25 + Math.random() * 0.55;
    for (let i = 0; i < gLen; i++) {
      const srcPos = srcStart + i * pitch;
      const si = Math.floor(srcPos);
      if (si + 1 >= srcData.length || outStart + i >= len) break;
      const frac = srcPos - si;
      const s = srcData[si] * (1 - frac) + srcData[si + 1] * frac;
      // Hann window — no clicks at grain edges
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / gLen));
      out[outStart + i] += s * w * amp;
    }
  }
  // Note envelope over the whole cloud
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    let env;
    if (def.env === 'perc') {
      env = Math.exp(-t / (def.dur * 0.3)) * attackEnv(i, sr, 0.005);
    } else {
      const release = Math.min(1, (def.dur - t) / 0.5);
      env = attackEnv(i, sr, 0.06) * Math.exp(-t / (def.dur * 0.9)) * Math.max(0, release);
    }
    out[i] *= env;
  }
  normalize(out, 0.72);
  return out;
}

async function renderGranularBanks(ctx) {
  const sr = ctx.sampleRate || 44100;
  for (const [id, def] of Object.entries(GRANULAR_DEFS)) {
    if (!sampleBank[id]) sampleBank[id] = {};
    for (const midi of REF_PITCHES) {
      try {
        const srcBuf = sampleBank[def.src] && sampleBank[def.src][midi];
        if (!srcBuf) continue;
        const raw = renderGranular(def, srcBuf.getChannelData(0), sr);
        const buf = ctx.createBuffer(1, raw.length, sr);
        const ch = buf.getChannelData(0);
        for (let j = 0; j < raw.length; j++) ch[j] = raw[j];
        sampleBank[id][midi] = buf;
      } catch (e) {
        if (__DEV__) console.warn(`[timbres] Granular failed ${id}/${midi}:`, e?.message || e);
      }
      // Yield between refs so the loading screen stays smooth
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

let sampleBank = null;
let drumBank = {};
const activeVoices = [];
let assetsPreloaded = false;

// ── Drive (distortion) ───────────────────────────────────────
// 0.6.5 has no WaveShaperNode, so drive is TRUE waveshaping applied to
// the buffer itself: tanh saturation, peak-compensated, quantized to two
// hot levels and lazily cached per (buffer, level). Playback stays a
// plain BufferSource — zero extra runtime risk.
const driveCache = new Map(); // 'key:step' → AudioBuffer
const DRIVE_PREGAIN = [0, 4, 12];
const DRIVE_CACHE_MAX = 24;

function getDriveStep(drive) {
  const d = Number(drive) || 0;
  if (d < 0.15) return 0;
  if (d < 0.6) return 1;
  return 2;
}

function distortBuffer(buffer, step) {
  const src = buffer.getChannelData(0);
  const out = audioCtxRef.createBuffer(1, src.length, buffer.sampleRate || audioCtxRef.sampleRate);
  const dst = out.getChannelData(0);
  const pre = DRIVE_PREGAIN[step];
  let peakIn = 0;
  for (let i = 0; i < src.length; i++) { const a = Math.abs(src[i]); if (a > peakIn) peakIn = a; }
  let peakOut = 0;
  for (let i = 0; i < src.length; i++) {
    const y = Math.tanh(src[i] * pre);
    dst[i] = y;
    const a = Math.abs(y);
    if (a > peakOut) peakOut = a;
  }
  // Gain-compensate so drive changes character, not loudness
  if (peakOut > 0 && peakIn > 0) {
    const g = peakIn / peakOut;
    for (let i = 0; i < dst.length; i++) dst[i] *= g;
  }
  return out;
}

function getDrivenBuffer(cacheKey, buffer, driveStep) {
  if (!driveStep || !audioCtxRef || !buffer) return buffer;
  const key = cacheKey + ':' + driveStep;
  let b = driveCache.get(key);
  if (!b) {
    try {
      if (driveCache.size >= DRIVE_CACHE_MAX) {
        const oldest = driveCache.keys().next().value;
        driveCache.delete(oldest);
      }
      b = distortBuffer(buffer, driveStep);
      driveCache.set(key, b);
    } catch (e) {
      return buffer;
    }
  }
  return b;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Audio DSP helpers ────────────────────────────────────────
function applyLowpass(data, cutoffHz, sr) {
  const rc = 1.0 / (2 * Math.PI * cutoffHz);
  const dt = 1.0 / sr;
  const alpha = dt / (rc + dt);
  let prev = data[0] || 0;
  for (let i = 1; i < data.length; i++) {
    prev = prev + alpha * (data[i] - prev);
    data[i] = prev;
  }
}

function attackEnv(i, sr, sec) {
  const n = Math.ceil(sr * sec);
  return i < n ? i / n : 1;
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

// ── Synthesized timbres ──────────────────────────────────────
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
    const click = Math.sin(2 * Math.PI * freq * 6 * t) * 0.03 * Math.exp(-t / 0.008);
    data[i] = (h1 + h2 + h3 + h4 + sub + click) * env * attackEnv(i, sr, 0.006);
  }
  applyLowpass(data, Math.min(5000, 2000 + 3000 * fs), sr);
  return data;
}

function renderMarimba(freq, sr) {
  const dur = 1.2;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 300 / freq);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fundDecay = 0.9 + 0.6 * fs;
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.55 * Math.exp(-t / fundDecay);
    const sub = Math.sin(2 * Math.PI * freq * 0.5 * t) * 0.15 * fs * Math.exp(-t / 1.2);
    const click = Math.sin(2 * Math.PI * freq * 4.0 * t) * 0.10 * Math.exp(-t / 0.010) * (0.4 + 0.6 * fs);
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.06 * fs * Math.exp(-t / 0.4);
    data[i] = (fund + sub + click + h3) * attackEnv(i, sr, 0.002);
  }
  applyLowpass(data, Math.min(5000, 2000 + 3000 * fs), sr);
  return data;
}

function renderVibes(freq, sr) {
  const dur = 2.0;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 400 / freq);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const trem = 1 + 0.15 * Math.sin(2 * Math.PI * 5.5 * t);
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.50 * Math.exp(-t / 2.2);
    const h2 = Math.sin(2 * Math.PI * freq * 4 * t) * 0.12 * fs * Math.exp(-t / 0.8);
    const h3 = Math.sin(2 * Math.PI * freq * 10 * t) * 0.04 * fs * Math.exp(-t / 0.3);
    const mallet = Math.sin(2 * Math.PI * freq * 3 * t) * 0.08 * Math.exp(-t / 0.015);
    data[i] = (fund + h2 + h3 + mallet) * trem * attackEnv(i, sr, 0.001);
  }
  applyLowpass(data, Math.min(7000, 2500 + 4000 * fs), sr);
  return data;
}

function renderKeys(freq, sr) {
  const dur = 1.8;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 500 / freq);
  const B = 0.0004;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const envDecay = 1.0 + 0.8 * fs;
    const env = Math.exp(-t / envDecay);
    let s = 0;
    const harmonics = [
      { n: 1, amp: 0.50, decay: 1.0 }, { n: 2, amp: 0.25, decay: 0.7 },
      { n: 3, amp: 0.12, decay: 0.45 }, { n: 4, amp: 0.06, decay: 0.30 },
      { n: 5, amp: 0.03, decay: 0.20 }, { n: 6, amp: 0.015, decay: 0.12 },
    ];
    for (const h of harmonics) {
      const hFreq = freq * h.n * Math.sqrt(1 + B * h.n * h.n);
      if (hFreq > sr * 0.4) continue;
      s += Math.sin(2 * Math.PI * hFreq * t) * (h.amp * (h.n <= 2 ? 1 : fs)) * Math.exp(-t / (h.decay * (0.4 + 0.6 * fs)));
    }
    const hammer = Math.sin(2 * Math.PI * freq * 7.1 * t) * 0.03 * Math.exp(-t / 0.008);
    data[i] = (s + hammer) * env * attackEnv(i, sr, 0.002);
  }
  applyLowpass(data, Math.min(8000, 3000 + 5000 * fs), sr);
  return data;
}

function renderPluck(freq, sr) {
  const dur = 1.2;
  const len = Math.ceil(sr * dur);
  const data = new Float32Array(len);
  const fs = Math.min(1.0, 500 / freq);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const fund = Math.sin(2 * Math.PI * freq * t) * 0.50 * Math.exp(-t / 1.2);
    const h2 = Math.sin(2 * Math.PI * freq * 2 * t) * 0.20 * Math.exp(-t / 0.7);
    const h3 = Math.sin(2 * Math.PI * freq * 3 * t) * 0.10 * fs * Math.exp(-t / 0.35);
    const h4 = Math.sin(2 * Math.PI * freq * 4 * t) * 0.04 * fs * Math.exp(-t / 0.20);
    const h5 = Math.sin(2 * Math.PI * freq * 5 * t) * 0.02 * fs * fs * Math.exp(-t / 0.12);
    const transient = Math.sin(2 * Math.PI * freq * 6 * t) * 0.05 * Math.exp(-t / 0.006);
    data[i] = (fund + h2 + h3 + h4 + h5 + transient) * attackEnv(i, sr, 0.001);
  }
  applyLowpass(data, Math.min(6000, 2000 + freq * 3), sr);
  return data;
}

function renderTimbre(id, freq, sr) {
  switch (id) {
    case 'keys':    return renderKeys(freq, sr);
    case 'organ':   return renderOrgan(freq, sr);
    case 'marimba': return renderMarimba(freq, sr);
    case 'vibes':   return renderVibes(freq, sr);
    case 'pluck':   return renderPluck(freq, sr);
    default:        return renderKeys(freq, sr);
  }
}

// ── Asset preloading ─────────────────────────────────────────
let preloadPromise = null;
function preloadAssets() {
  if (preloadPromise) return preloadPromise;
  let Asset;
  try { Asset = require('expo-asset').Asset; } catch (e) { return Promise.resolve(); }
  const allModules = [];
  for (const assets of Object.values(SAMPLE_ASSETS)) {
    for (const mod of Object.values(assets)) allModules.push(mod);
  }
  for (const slots of Object.values(DRUM_KIT_ASSETS)) {
    for (const mod of Object.values(slots)) allModules.push(mod);
  }
  preloadPromise = Asset.loadAsync(allModules).catch(() => {});
  return preloadPromise;
}

// ── Sample bank ──────────────────────────────────────────────
// Fix #1: Synth buffer generation is now async — broken into batches of 6
// with event loop yields between each batch to prevent JS thread blocking.
let synthsReady = false;

// Returns a promise that resolves when all samples are loaded and ready to play.
function initSampleBank(ctx) {
  audioCtxRef = ctx;
  sampleBank = {};

  for (const id of SYNTH_TIMBRES) sampleBank[id] = {};
  for (const id of Object.keys(SAMPLE_ASSETS)) sampleBank[id] = {};
  for (const id of Object.keys(GRANULAR_DEFS)) sampleBank[id] = {};
  drumBank = {};

  // Synth generation and WAV decoding in parallel; granular timbres render
  // last — their grain engines feed on the decoded/rendered source buffers
  return Promise.all([
    renderSynthBuffersAsync(ctx).then(() => { synthsReady = true; }).catch(() => {}),
    decodeSamples(ctx).catch(() => {}),
  ]).then(() => renderGranularBanks(ctx).catch(() => {}));
}

async function renderSynthBuffersAsync(ctx) {
  const sr = ctx.sampleRate || 44100;
  const jobs = [];
  for (const id of SYNTH_TIMBRES) {
    for (const midi of REF_PITCHES) {
      jobs.push({ id, midi });
    }
  }
  // Process in batches of 6, yielding between each batch
  const BATCH = 6;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    for (const { id, midi } of batch) {
      try {
        const freq = midiToFreq(midi);
        const raw = renderTimbre(id, freq, sr);
        normalize(raw, PEAK_TARGETS[id] || 0.75);
        const buf = ctx.createBuffer(1, raw.length, sr);
        const ch = buf.getChannelData(0);
        for (let j = 0; j < raw.length; j++) ch[j] = raw[j];
        sampleBank[id][midi] = buf;
      } catch (e) {
        console.warn(`[timbres] Synth failed ${id}/${midi}:`, e?.message || e);
      }
    }
    // Yield to event loop so gestures/rendering aren't blocked
    if (i + BATCH < jobs.length) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

async function decodeAsset(ctx, assetModule) {
  let Asset;
  try { Asset = require('expo-asset').Asset; } catch (e) { return null; }
  const [asset] = await Asset.loadAsync(assetModule);
  const uri = asset.localUri || asset.uri;
  if (ctx.decodeAudioDataSource) {
    return await ctx.decodeAudioDataSource(uri);
  }
  const resp = await fetch(uri);
  const ab = await resp.arrayBuffer();
  return await ctx.decodeAudioData(ab);
}

async function decodeSamples(ctx) {
  const jobs = [];
  for (const [timbreId, assets] of Object.entries(SAMPLE_ASSETS)) {
    for (let i = 0; i < REF_PITCHES.length; i++) {
      const refName = REF_NAMES[i];
      const midi = REF_PITCHES[i];
      if (!assets[refName]) continue;
      jobs.push((async () => {
        try {
          const buf = await decodeAsset(ctx, assets[refName]);
          if (buf && sampleBank[timbreId]) sampleBank[timbreId][midi] = buf;
        } catch (e) {
          console.warn(`[timbres] Failed ${timbreId}/${refName}:`, e?.message || e);
        }
      })());
    }
  }
  for (const [kitId, slots] of Object.entries(DRUM_KIT_ASSETS)) {
    for (const [slotName, assetModule] of Object.entries(slots)) {
      jobs.push((async () => {
        try {
          const buf = await decodeAsset(ctx, assetModule);
          if (buf) {
            if (!drumBank[kitId]) drumBank[kitId] = {};
            drumBank[kitId][slotName] = buf;
          }
        } catch (e) {
          console.warn(`[timbres] Failed ${kitId}/${slotName}:`, e?.message || e);
        }
      })());
    }
  }
  await Promise.all(jobs);
}

// ── Voice management (crash-safe) ────────────────────────────
// No setTimeout for voice cleanup — react-native-audio-api 0.6.5 crashes
// when disconnect() is called on a node that was already freed by the native
// audio thread (SIGSEGV in AudioNodeManager::addPendingNodeConnection).
// All disconnect calls are immediate and guarded by a killed flag.
let audioCtxRef = null;

function trackVoice(entry) {
  activeVoices.push(entry);
  while (activeVoices.length > MAX_VOICES) {
    killVoice(activeVoices.shift());
  }
}

function killVoice(entry) {
  if (!entry || entry.killed) return;
  entry.killed = true;
  try { if (entry.src) entry.src.stop(); } catch (e) {}
  try { if (entry.src) entry.src.disconnect(); } catch (e) {}
  try { if (entry.gain) entry.gain.disconnect(); } catch (e) {}
  entry.src = null;
  entry.gain = null;
}

function pruneVoices(now) {
  let i = 0;
  while (i < activeVoices.length) {
    if (now > activeVoices[i].endTime) {
      killVoice(activeVoices[i]);
      activeVoices.splice(i, 1);
    } else {
      i++;
    }
  }
}

function fadeOutAllVoices(ctx) {
  // Mark all voices as expired so pruneVoices kills them on next tick.
  // This avoids both the pop from immediate disconnect AND the native crash from setTimeout.
  const now = ctx ? ctx.currentTime : 0;
  for (const v of activeVoices) {
    v.endTime = now; // Will be cleaned up by pruneVoices on next triggerTimbre call
  }
}

// ── Sample lookup ────────────────────────────────────────────
function findSample(timbreId, midi) {
  const bank = sampleBank && sampleBank[timbreId];
  if (!bank) return null;
  // Nearest reference pitch that actually HAS a decoded buffer — some
  // timbres lack octaves (guitar has no C6) and individual decodes can
  // fail; picking a missing ref would silence the whole pitch range.
  let bestRef = -1;
  let bestDist = Infinity;
  for (let i = 0; i < REF_PITCHES.length; i++) {
    if (!bank[REF_PITCHES[i]]) continue;
    const d = Math.abs(midi - REF_PITCHES[i]);
    if (d < bestDist) { bestDist = d; bestRef = REF_PITCHES[i]; }
  }
  if (bestRef < 0) return null;
  return { buffer: bank[bestRef], rate: midiToFreq(midi) / midiToFreq(bestRef), ref: bestRef };
}

// ── Public API ───────────────────────────────────────────────
function createTimbre(ctx, timbreId) {
  return { timbreId, dispose() {} };
}

const DRUM_SLOT_ORDER = ['kick', 'snare', 'hihat', 'perc'];

function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration, startTime, vertexIndex, drive = 0) {
  if (!ctx || !masterGain || !synth || !stepData) return;
  const driveStep = getDriveStep(drive);
  if (!isFinite(velocity) || velocity <= 0) return;
  if (!isFinite(duration) || duration <= 0) return;
  const now = ctx.currentTime;
  const t = Math.max(startTime || now, now);
  if (!isFinite(t)) return;
  pruneVoices(now);

  // Drum kit — pitches encode slots (0=kick, 1=snare, 2=hihat, 3=perc)
  const isDrum = synth.timbreId.startsWith('drumkit');
  if (isDrum) {
    const kit = drumBank[synth.timbreId];
    if (!kit) return;
    const slots = stepData.pitches || [vertexIndex % DRUM_SLOT_ORDER.length];
    for (const slotIdx of slots) {
      // Round + wrap: legacy project files can carry fractional/negative
      // pitches into drum shapes — map them to a slot instead of skipping
      const n = DRUM_SLOT_ORDER.length;
      const slotName = DRUM_SLOT_ORDER[((Math.round(slotIdx) % n) + n) % n];
      const buffer = kit[slotName];
      if (!buffer) continue;
      try {
        const src = ctx.createBufferSource();
        src.buffer = getDrivenBuffer(synth.timbreId + ':' + slotName, buffer, driveStep);
        src.playbackRate.value = 1;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.linearRampToValueAtTime(velocity, t + 0.002);
        const durSec = Math.min(duration, buffer.duration);
        if (durSec < buffer.duration * 0.8) {
          gain.gain.setValueAtTime(velocity, t + durSec);
          gain.gain.linearRampToValueAtTime(0, t + durSec + 0.04);
        }
        src.connect(gain);
        gain.connect(masterGain);
        src.start(t);
        const endTime = t + Math.min(durSec + 0.1, buffer.duration) + 0.05;
        trackVoice({ src, gain, endTime, killed: false });
      } catch (e) {}
    }
    return;
  }

  // Melodic playback (synth buffers or WAV samples)
  if (!sampleBank) return;
  const pitches = stepData.pitches || [60];
  const maxChordNotes = Math.min(pitches.length, 3);

  for (let pi = 0; pi < maxChordNotes; pi++) {
    const sample = findSample(synth.timbreId, pitches[pi]);
    if (!sample) continue;
    try {
      const src = ctx.createBufferSource();
      src.buffer = getDrivenBuffer(synth.timbreId + ':' + sample.ref, sample.buffer, driveStep);
      src.playbackRate.value = sample.rate;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(velocity, t + ATTACK_SEC);
      const sampleDur = sample.buffer.duration / sample.rate;
      if (duration < sampleDur * 0.8) {
        gain.gain.setValueAtTime(velocity, t + duration);
        gain.gain.linearRampToValueAtTime(0, t + duration + 0.06);
      }
      src.connect(gain);
      gain.connect(masterGain);
      src.start(t);
      const endTime = t + Math.min(duration + 0.15, sampleDur) + 0.05;
      trackVoice({ src, gain, endTime, killed: false });
    } catch (e) {}
  }
}

function getSampleBank() { return sampleBank; }
function getDrumBank() { return drumBank; }
function getActiveVoiceCount() { return activeVoices.length; }
function getMaxVoices() { return MAX_VOICES; }

export { createTimbre, triggerTimbre, initSampleBank, fadeOutAllVoices, preloadAssets, getSampleBank, getDrumBank, getActiveVoiceCount, getMaxVoices };
