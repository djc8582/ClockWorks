// Offline audio renderer — mixes samples into a WAV file in pure JS.
// No AudioContext needed — reads directly from decoded sample buffers.
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getState } from '../state.js';
import { songScenes } from '../looper.js';
import { TIMING, makeDefaultFx, makeDefaultMasterFx } from '../constants.js';
import { biquadCoeffs, processBiquad, cutoffToHz, resToQ, eqGainDb, EQ_BANDS } from '../audio/dsp.js';
import { AUDIO } from '../constants.js';

// WAV file encoder
function encodeWAV(samples, sampleRate, numChannels) {
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // Convert float samples to 16-bit PCM
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return buffer;
}

// Convert ArrayBuffer to base64
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i], b2 = bytes[i + 1] || 0, b3 = bytes[i + 2] || 0;
    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < bytes.length ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < bytes.length ? chars[b3 & 63] : '=';
  }
  return result;
}

// Get sample buffer data — works with the loaded sampleBank
let sampleBankRef = null;
let drumBankRef = null;

export function setSampleBanks(samples, drums) {
  sampleBankRef = samples;
  drumBankRef = drums;
}

const DRUM_SLOTS = ['kick', 'snare', 'hihat', 'perc'];
const REF_PITCHES = [24, 36, 48, 60, 72, 84];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function findSampleData(timbreId, midi) {
  const bank = sampleBankRef && sampleBankRef[timbreId];
  if (!bank) return null;
  // Nearest reference pitch that actually has a buffer (guitar has no C6;
  // decode failures leave gaps) — mirrors findSample in audio/timbres.js
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

// Mix a single sample into the output buffer at a given time.
// The effective rate accounts for both pitch shifting AND sample rate conversion.
function mixSample(output, outputRate, buffer, pitchRate, startSample, velocity, duration, dataOverride) {
  const channelData = dataOverride || buffer.getChannelData(0);
  const bufferRate = buffer.sampleRate || outputRate;

  // Effective resampling ratio: pitch shift * sample rate conversion
  const effectiveRate = pitchRate * (bufferRate / outputRate);

  const maxOutputSamples = Math.floor(duration * outputRate);
  const maxFromSource = Math.floor(channelData.length / effectiveRate);
  const numSamples = Math.min(maxOutputSamples, maxFromSource);

  const fadeInLen = Math.floor(outputRate * 0.004);
  const fadeOutLen = Math.floor(outputRate * 0.06);
  const fadeOutStart = numSamples - fadeOutLen;

  for (let i = 0; i < numSamples; i++) {
    // Linear interpolation for better pitch accuracy
    const srcPos = i * effectiveRate;
    const srcIdx = Math.floor(srcPos);
    if (srcIdx + 1 >= channelData.length) break;
    const frac = srcPos - srcIdx;
    const rawSample = channelData[srcIdx] * (1 - frac) + channelData[srcIdx + 1] * frac;

    const outIdx = startSample + i;
    if (outIdx >= output.length) break;

    let sample = rawSample * velocity;

    // Fade in/out
    if (i < fadeInLen) sample *= i / fadeInLen;
    if (i > fadeOutStart && fadeOutLen > 0) sample *= (numSamples - i) / fadeOutLen;

    output[outIdx] += sample;
  }
}

// Simple one-pole lowpass (matches the in-app BiquadFilter character
// closely enough for a bounce)
function lowpassInPlace(data, cutoffHz, sr) {
  const rc = 1.0 / (2 * Math.PI * cutoffHz);
  const dt = 1.0 / sr;
  const alpha = dt / (rc + dt);
  let prev = 0;
  for (let i = 0; i < data.length; i++) {
    prev = prev + alpha * (data[i] - prev);
    data[i] = prev;
  }
}

function toneToHz(t, lo = 300, hi = 18000) {
  const x = Math.max(0, Math.min(1, Number(t) ?? 1));
  return lo * Math.pow(hi / lo, x);
}

// Apply a shape's EQ + filter — EXACT RBJ biquads (same math as the live
// graph), so the bounce matches what you hear, resonance included
function applyShapeEqAndFilter(data, fx, sr) {
  if (Math.abs(fx.eqLow) > 0.01) processBiquad(data, biquadCoeffs('lowshelf', EQ_BANDS.low.freq, 0.707, eqGainDb(fx.eqLow), sr));
  if (Math.abs(fx.eqMid) > 0.01) processBiquad(data, biquadCoeffs('peaking', EQ_BANDS.mid.freq, EQ_BANDS.mid.Q, eqGainDb(fx.eqMid), sr));
  if (Math.abs(fx.eqHigh) > 0.01) processBiquad(data, biquadCoeffs('highshelf', EQ_BANDS.high.freq, 0.707, eqGainDb(fx.eqHigh), sr));

  const cutoffNorm = fx.cutoff !== undefined ? fx.cutoff : (fx.tone !== undefined ? fx.tone : 1);
  const type = fx.filterType || 'lowpass';
  if (type !== 'lowpass' || cutoffNorm < 0.99 || fx.res > 0.02) {
    processBiquad(data, biquadCoeffs(type, cutoffToHz(cutoffNorm), resToQ(fx.res), 0, sr));
  }
}

const VERB_TAPS = [0.029, 0.061, 0.097, 0.141];

// Per-buffer drive (matches live: tanh on the SOURCE buffer pre-mix —
// tanh(sum) at chords sounds different from sum(tanh), so order matters)
const exportDriveCache = new Map();
function drivenData(cacheKey, channelData, drive) {
  const step = drive < 0.15 ? 0 : drive < 0.6 ? 1 : 2;
  if (step === 0) return channelData;
  const key = cacheKey + ':' + step;
  let out = exportDriveCache.get(key);
  if (!out) {
    const pre = step === 1 ? 4 : 12;
    out = new Float32Array(channelData.length);
    let peakIn = 0, peakOut = 0;
    for (let i = 0; i < channelData.length; i++) { const a = Math.abs(channelData[i]); if (a > peakIn) peakIn = a; }
    for (let i = 0; i < channelData.length; i++) {
      const y = Math.tanh(channelData[i] * pre);
      out[i] = y;
      const a = Math.abs(y);
      if (a > peakOut) peakOut = a;
    }
    if (peakOut > 0 && peakIn > 0) {
      const g = peakIn / peakOut;
      for (let i = 0; i < out.length; i++) out[i] *= g;
    }
    if (exportDriveCache.size > 24) exportDriveCache.delete(exportDriveCache.keys().next().value);
    exportDriveCache.set(key, out);
  }
  return out;
}

// Equal-power pan gains for the echo bus panners at ±0.7 (matches
// StereoPanner math exactly — the old 0.92/0.38 were eyeballed)
const ECHO_PAN = 0.7;
const ECHO_G_NEAR = Math.cos(((-ECHO_PAN) + 1) * Math.PI / 4); // ≈0.972
const ECHO_G_FAR = Math.sin(((-ECHO_PAN) + 1) * Math.PI / 4);  // ≈0.233

// Mix the whole project into STEREO Float32Arrays with the full effects
// chain (per-shape volume/tone/pan, ping-pong echo, diffuse reverb,
// master tone/volume) — pure DSP, validated directly by the self-tests.
export function renderAudioMix(state, numCycles = 4) {
  if (!sampleBankRef) throw new Error('Samples not loaded');

  const sampleRate = 44100;
  const bpm = state.bpm || 120;
  const cycleDuration = (60 / bpm) * TIMING.defaultCycleBeats;
  // The song's bars in play order (bars past the song end only hold loop
  // repeats for the bar-strip preview and are not part of the song)
  const scenes = songScenes(state);
  if (scenes.length === 0) return null;
  const master = { ...makeDefaultMasterFx(), ...(state.effects || {}) };
  const effDelay = master.delaySync
    ? Math.max(0.05, Math.min(1.2, (60 / bpm) * master.delaySync))
    : Math.min(0.7, master.delayTime);
  const TAIL_SEC = 1.5 + (master.delayWet > 0.01 ? 3 * effDelay : 0);
  const totalDuration = cycleDuration * numCycles * scenes.length + TAIL_SEC;
  const totalSamples = Math.ceil(totalDuration * sampleRate);

  const outL = new Float32Array(totalSamples);
  const outR = new Float32Array(totalSamples);
  const echoL = new Float32Array(totalSamples);
  const echoR = new Float32Array(totalSamples);
  const verb = new Float32Array(totalSamples);
  const shapeBus = new Float32Array(totalSamples); // reused per shape

  // Collect every shape instance (per scene) so each gets its own strip pass
  const shapeRuns = [];
  let timeOffset = 0;
  for (const scene of scenes) {
    for (const shape of scene.shapes) {
      shapeRuns.push({ shape, timeOffset });
    }
    timeOffset += numCycles * cycleDuration;
  }

  for (const { shape, timeOffset: t0 } of shapeRuns) {
    shapeBus.fill(0);
    const sides = shape.sides || 3;
    const interval = cycleDuration / sides;
    // Same event thinning as the live engine — the bounce must not contain
    // notes the live engine would drop at extreme tempo
    let sub = shape.subdivision || 1;
    if (interval / sub < AUDIO.minEventSpacing) {
      sub = Math.max(1, Math.floor(interval / AUDIO.minEventSpacing));
    }
    const vertexStride = interval < AUDIO.minEventSpacing
      ? Math.ceil(AUDIO.minEventSpacing / interval)
      : 1;
    const subInterval = interval / sub;
    const volume = shape.volume != null ? shape.volume : 1;
    const fx = { ...makeDefaultFx(), ...(shape.fx || {}) };
    const isDrum = (shape.timbre || '').startsWith('drumkit');

    for (let cycle = 0; cycle < numCycles; cycle++) {
      const cycleStart = t0 + cycle * cycleDuration;

      for (let vi = 0; vi < sides; vi++) {
        if (vi % vertexStride !== 0) continue;
        const v = shape.vertices[vi];
        if (!v) continue;

        for (let s = 0; s < sub; s++) {
          const stepData = s === 0 ? v : (v.subs && v.subs[s - 1]);
          if (!stepData || stepData.muted) continue;

          const eventTime = cycleStart + vi * interval + s * subInterval;
          const startSample = Math.floor(eventTime * sampleRate);
          const vel = ((stepData.velocity || 85) / 127) * 0.85 * volume;
          const dur = Math.min(interval * 0.6, 0.5);

          if (isDrum) {
            const pitches = stepData.pitches || [vi % 4];
            for (const slotIdx of pitches) {
              const kit = drumBankRef && drumBankRef[shape.timbre];
              if (!kit) continue;
              const n = DRUM_SLOTS.length;
              const slotName = DRUM_SLOTS[((Math.round(slotIdx) % n) + n) % n];
              const buf = kit[slotName];
              if (!buf) continue;
              mixSample(shapeBus, sampleRate, buf, 1, startSample, vel, dur,
                drivenData(shape.timbre + ':' + slotName, buf.getChannelData(0), fx.drive));
            }
          } else {
            const pitches = stepData.pitches || [60];
            for (const pitch of pitches.slice(0, 3)) {
              const sample = findSampleData(shape.timbre, pitch);
              if (!sample) continue;
              mixSample(shapeBus, sampleRate, sample.buffer, sample.rate, startSample, vel, dur,
                drivenData(shape.timbre + ':' + sample.ref, sample.buffer.getChannelData(0), fx.drive));
            }
          }
        }
      }
    }

    // Channel strip: (drive already applied per-buffer, matching live) →
    // EQ → filter → pan into master; sends tap post-EQ/filter
    applyShapeEqAndFilter(shapeBus, fx, sampleRate);
    const p = Math.max(-1, Math.min(1, fx.pan));
    const gl = Math.cos((p + 1) * Math.PI / 4);
    const gr = Math.sin((p + 1) * Math.PI / 4);
    for (let i = 0; i < totalSamples; i++) {
      const x = shapeBus[i];
      if (x === 0) continue;
      outL[i] += x * gl;
      outR[i] += x * gr;
    }

    // Ping-pong echo taps (BPM-synced spacing when delaySync is set)
    if (fx.echoSend > 0.01 && master.delayWet > 0.01) {
      const dt = master.delaySync
        ? Math.max(0.05, Math.min(1.2, (60 / bpm) * master.delaySync))
        : Math.max(0.05, Math.min(0.7, master.delayTime));
      const fb = Math.max(0, Math.min(0.85, master.delayFeedback));
      for (let k = 1; k <= 3; k++) {
        const g = fx.echoSend * Math.pow(fb, k);
        if (g < 0.012) break;
        const off = Math.floor(k * dt * sampleRate);
        const dest = (k % 2 === 1) ? echoL : echoR;
        for (let i = 0; i + off < totalSamples; i++) {
          const x = shapeBus[i];
          if (x !== 0) dest[i + off] += x * g;
        }
      }
    }

    // Diffuse reverb taps
    if (fx.verbSend > 0.01 && master.reverbWet > 0.01) {
      for (let k = 0; k < VERB_TAPS.length; k++) {
        const g = fx.verbSend * 0.7 * Math.pow(0.62, k);
        const off = Math.floor(VERB_TAPS[k] * sampleRate);
        for (let i = 0; i + off < totalSamples; i++) {
          const x = shapeBus[i];
          if (x !== 0) verb[i + off] += x * g;
        }
      }
    }
  }

  // Bus returns — biquad lowpass (matches the live BiquadFilter exactly)
  processBiquad(echoL, biquadCoeffs('lowpass', 5000, 0.707, 0, sampleRate));
  processBiquad(echoR, biquadCoeffs('lowpass', 5000, 0.707, 0, sampleRate));
  processBiquad(verb, biquadCoeffs('lowpass', 3200, 0.707, 0, sampleRate));
  const echoWet = Math.max(0, Math.min(1, master.delayWet));
  const verbWet = Math.max(0, Math.min(1, master.reverbWet));
  for (let i = 0; i < totalSamples; i++) {
    // Equal-power ±0.7 panners (exact StereoPanner math), verb centered
    outL[i] += echoL[i] * echoWet * ECHO_G_NEAR + echoR[i] * echoWet * ECHO_G_FAR + verb[i] * verbWet * 0.71;
    outR[i] += echoR[i] * echoWet * ECHO_G_NEAR + echoL[i] * echoWet * ECHO_G_FAR + verb[i] * verbWet * 0.71;
  }

  // Master EQ + tone + volume — exact biquads, both channels
  for (const chan of [outL, outR]) {
    if (Math.abs(master.eqLow) > 0.01) processBiquad(chan, biquadCoeffs('lowshelf', EQ_BANDS.low.freq, 0.707, eqGainDb(master.eqLow), sampleRate));
    if (Math.abs(master.eqMid) > 0.01) processBiquad(chan, biquadCoeffs('peaking', EQ_BANDS.mid.freq, EQ_BANDS.mid.Q, eqGainDb(master.eqMid), sampleRate));
    if (Math.abs(master.eqHigh) > 0.01) processBiquad(chan, biquadCoeffs('highshelf', EQ_BANDS.high.freq, 0.707, eqGainDb(master.eqHigh), sampleRate));
    if (master.tone < 0.99) processBiquad(chan, biquadCoeffs('lowpass', toneToHz(master.tone, 300, 20000), 0.707, 0, sampleRate));
  }
  const mv = Math.max(0, Math.min(1, master.volume));

  // Normalize (joint, preserves stereo image)
  let peak = 0;
  for (let i = 0; i < totalSamples; i++) {
    const a = Math.abs(outL[i]);
    const b = Math.abs(outR[i]);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  if (peak > 0.01) {
    const scale = (0.9 * mv) / peak;
    for (let i = 0; i < totalSamples; i++) { outL[i] *= scale; outR[i] *= scale; }
  }

  return { left: outL, right: outR, sampleRate };
}

export async function exportAudio(numCycles = 4) {
  const mix = renderAudioMix(getState(), numCycles);
  if (!mix) return;
  const { left, right, sampleRate } = mix;

  // Interleave stereo
  const interleaved = new Float32Array(left.length * 2);
  for (let i = 0; i < left.length; i++) {
    interleaved[i * 2] = left[i];
    interleaved[i * 2 + 1] = right[i];
  }

  // Encode to WAV
  const wavBuffer = encodeWAV(interleaved, sampleRate, 2);
  const base64 = arrayBufferToBase64(wavBuffer);

  const fileUri = FileSystem.cacheDirectory + 'clockworks_export.wav';
  await FileSystem.writeAsStringAsync(fileUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'audio/wav',
      dialogTitle: 'Export Audio',
    });
  }
}
