// Offline audio renderer — mixes samples into a WAV file in pure JS.
// No AudioContext needed — reads directly from decoded sample buffers.
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getState } from '../state.js';
import { TIMING } from '../constants.js';

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

// Mix a single sample into the output buffer at a given time.
// The effective rate accounts for both pitch shifting AND sample rate conversion.
function mixSample(output, outputRate, buffer, pitchRate, startSample, velocity, duration) {
  const channelData = buffer.getChannelData(0);
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

export async function exportAudio(numCycles = 4) {
  const state = getState();
  if (!sampleBankRef) throw new Error('Samples not loaded');

  const sampleRate = 44100;
  const bpm = state.bpm || 120;
  const cycleDuration = (60 / bpm) * TIMING.defaultCycleBeats;
  const totalDuration = cycleDuration * numCycles * state.scenes.length;
  const totalSamples = Math.ceil(totalDuration * sampleRate);
  const output = new Float32Array(totalSamples);

  let timeOffset = 0;

  for (const scene of state.scenes) {
    for (let cycle = 0; cycle < numCycles; cycle++) {
      const cycleStart = timeOffset + cycle * cycleDuration;

      for (const shape of scene.shapes) {
        const sides = shape.sides || 3;
        const sub = shape.subdivision || 1;
        const interval = cycleDuration / sides;
        const subInterval = interval / sub;
        const volume = shape.volume != null ? shape.volume : 1;
        const isDrum = (shape.timbre || '').startsWith('drumkit');

        for (let vi = 0; vi < sides; vi++) {
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
                const slotName = DRUM_SLOTS[slotIdx % DRUM_SLOTS.length];
                const buf = kit[slotName];
                if (!buf) continue;
                mixSample(output, sampleRate, buf, 1, startSample, vel, dur);
              }
            } else {
              const pitches = stepData.pitches || [60];
              for (const pitch of pitches.slice(0, 3)) {
                const sample = findSampleData(shape.timbre, pitch);
                if (!sample) continue;
                mixSample(output, sampleRate, sample.buffer, sample.rate, startSample, vel, dur);
              }
            }
          }
        }
      }
    }
    timeOffset += numCycles * cycleDuration;
  }

  // Normalize
  let peak = 0;
  for (let i = 0; i < output.length; i++) {
    const a = Math.abs(output[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.01) {
    const scale = 0.9 / peak;
    for (let i = 0; i < output.length; i++) output[i] *= scale;
  }

  // Encode to WAV
  const wavBuffer = encodeWAV(output, sampleRate, 1);
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
