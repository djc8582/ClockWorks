// Raw Web Audio node graphs for each timbre.
// Each factory returns { output: GainNode, voices: [], dispose() }
// triggerTimbre() handles note-on with ADSR envelope.

const VOICE_POOL_SIZE = 16;

// ── ADSR envelope helper ─────────────────────────────────────
function applyADSR(ctx, gainNode, envelope, time, duration) {
  const { attack, decay, sustain, release } = envelope;
  const t = time;

  gainNode.gain.cancelScheduledValues(t);
  gainNode.gain.setValueAtTime(0.001, t);
  gainNode.gain.linearRampToValueAtTime(1.0, t + attack);
  gainNode.gain.linearRampToValueAtTime(sustain, t + attack + decay);

  const releaseStart = t + duration;
  gainNode.gain.setValueAtTime(sustain, releaseStart);
  gainNode.gain.exponentialRampToValueAtTime(0.001, releaseStart + release);
}

// ── FM Synth voice ──────────────────────────────────────────
function createFMVoice(ctx, config) {
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modGain = ctx.createGain();
  const envGain = ctx.createGain();

  carrier.type = 'sine';
  modulator.type = config.modType || 'sine';
  modGain.gain.value = 0;
  envGain.gain.value = 0;

  modulator.connect(modGain);
  modGain.connect(carrier.frequency);
  carrier.connect(envGain);

  carrier.start();
  modulator.start();

  return {
    carrier,
    modulator,
    modGain,
    envGain,
    harmonicity: config.harmonicity || 2,
    modulationIndex: config.modulationIndex || 3.5,
    envelope: config.envelope,
    modEnvelope: config.modEnvelope,
    active: false,
  };
}

function triggerFMVoice(ctx, voice, freq, velocity, duration, time) {
  const t = time;
  const modFreq = freq * voice.harmonicity;
  const modAmount = modFreq * voice.modulationIndex;

  voice.carrier.frequency.setValueAtTime(freq, t);
  voice.modulator.frequency.setValueAtTime(modFreq, t);

  // Modulation envelope
  voice.modGain.gain.cancelScheduledValues(t);
  voice.modGain.gain.setValueAtTime(0.001, t);
  voice.modGain.gain.linearRampToValueAtTime(modAmount, t + voice.modEnvelope.attack);
  voice.modGain.gain.linearRampToValueAtTime(
    modAmount * voice.modEnvelope.sustain,
    t + voice.modEnvelope.attack + voice.modEnvelope.decay
  );
  const modRelStart = t + duration;
  voice.modGain.gain.setValueAtTime(modAmount * voice.modEnvelope.sustain, modRelStart);
  voice.modGain.gain.exponentialRampToValueAtTime(0.001, modRelStart + voice.modEnvelope.release);

  // Carrier envelope
  applyADSR(ctx, voice.envGain, voice.envelope, t, duration);

  // Apply velocity
  const peakGain = velocity;
  voice.envGain.gain.cancelScheduledValues(t);
  voice.envGain.gain.setValueAtTime(0.001, t);
  voice.envGain.gain.linearRampToValueAtTime(peakGain, t + voice.envelope.attack);
  voice.envGain.gain.linearRampToValueAtTime(
    peakGain * voice.envelope.sustain,
    t + voice.envelope.attack + voice.envelope.decay
  );
  const relStart = t + duration;
  voice.envGain.gain.setValueAtTime(peakGain * voice.envelope.sustain, relStart);
  voice.envGain.gain.exponentialRampToValueAtTime(0.001, relStart + voice.envelope.release);

  voice.active = true;
  setTimeout(() => { voice.active = false; }, (duration + voice.envelope.release + 0.1) * 1000);
}

// ── AM Synth voice ──────────────────────────────────────────
function createAMVoice(ctx, config) {
  const carrier = ctx.createOscillator();
  const modulator = ctx.createOscillator();
  const modGain = ctx.createGain();
  const envGain = ctx.createGain();

  carrier.type = config.carrierType || 'triangle';
  modulator.type = config.modType || 'square';
  modGain.gain.value = 0;
  envGain.gain.value = 0;

  // AM: modulator controls carrier amplitude
  modulator.connect(modGain);
  modGain.connect(envGain.gain);
  carrier.connect(envGain);

  carrier.start();
  modulator.start();

  return {
    carrier,
    modulator,
    modGain,
    envGain,
    harmonicity: config.harmonicity || 1.5,
    envelope: config.envelope,
    modEnvelope: config.modEnvelope,
    active: false,
  };
}

function triggerAMVoice(ctx, voice, freq, velocity, duration, time) {
  const t = time;
  const modFreq = freq * voice.harmonicity;

  voice.carrier.frequency.setValueAtTime(freq, t);
  voice.modulator.frequency.setValueAtTime(modFreq, t);

  // Modulation depth
  voice.modGain.gain.cancelScheduledValues(t);
  voice.modGain.gain.setValueAtTime(0.001, t);
  voice.modGain.gain.linearRampToValueAtTime(velocity * 0.5, t + voice.modEnvelope.attack);

  // Carrier envelope (amplitude)
  voice.envGain.gain.cancelScheduledValues(t);
  voice.envGain.gain.setValueAtTime(0.001, t);
  voice.envGain.gain.linearRampToValueAtTime(velocity, t + voice.envelope.attack);
  voice.envGain.gain.linearRampToValueAtTime(
    velocity * voice.envelope.sustain,
    t + voice.envelope.attack + voice.envelope.decay
  );
  const relStart = t + duration;
  voice.envGain.gain.setValueAtTime(velocity * voice.envelope.sustain, relStart);
  voice.envGain.gain.exponentialRampToValueAtTime(0.001, relStart + voice.envelope.release);

  voice.active = true;
  setTimeout(() => { voice.active = false; }, (duration + voice.envelope.release + 0.1) * 1000);
}

// ── Timbre definitions ──────────────────────────────────────
const TIMBRE_CONFIGS = {
  classic: {
    type: 'fm',
    harmonicity: 2,
    modulationIndex: 3.5,
    volume: -10,
    envelope: { attack: 0.001, decay: 1.2, sustain: 0.3, release: 1.5 },
    modEnvelope: { attack: 0.001, decay: 0.4, sustain: 0.1, release: 0.8 },
  },
  bright: {
    type: 'fm',
    harmonicity: 2,
    modulationIndex: 8,
    volume: -10,
    envelope: { attack: 0.001, decay: 0.8, sustain: 0.4, release: 1.2 },
    modEnvelope: { attack: 0.001, decay: 0.6, sustain: 0.3, release: 1.0 },
  },
  wurly: {
    type: 'fm',
    harmonicity: 1.5,
    modulationIndex: 1.2,
    volume: -8,
    envelope: { attack: 0.001, decay: 0.6, sustain: 0.25, release: 0.8 },
    modEnvelope: { attack: 0.001, decay: 0.3, sustain: 0.4, release: 0.6 },
  },
  crystal: {
    type: 'fm',
    harmonicity: 3.01,
    modulationIndex: 12,
    volume: -12,
    envelope: { attack: 0.001, decay: 1.5, sustain: 0.1, release: 1.8 },
    modEnvelope: { attack: 0.001, decay: 0.3, sustain: 0.0, release: 0.4 },
  },
  soft: {
    type: 'fm',
    harmonicity: 1,
    modulationIndex: 0.8,
    volume: -10,
    envelope: { attack: 0.15, decay: 0.8, sustain: 0.6, release: 2.5 },
    modEnvelope: { attack: 0.2, decay: 0.5, sustain: 0.3, release: 2.0 },
  },
};

// ── Create timbre factory ───────────────────────────────────
function createTimbre(ctx, timbreId) {
  const config = TIMBRE_CONFIGS[timbreId];

  // Drum timbres
  if (timbreId === 'kick' || timbreId === 'snare' || timbreId === 'hihat') {
    return createDrumTimbre(ctx, timbreId);
  }

  // Melodic timbres (FM or AM)
  const output = ctx.createGain();
  const dbToGain = (db) => Math.pow(10, db / 20);
  output.gain.value = dbToGain(config.volume);

  const voices = [];
  for (let i = 0; i < VOICE_POOL_SIZE; i++) {
    let voice;
    if (config.type === 'am') {
      voice = createAMVoice(ctx, config);
    } else {
      voice = createFMVoice(ctx, config);
    }
    voice.envGain.connect(output);
    voices.push(voice);
  }

  return {
    output,
    voices,
    type: config.type,
    nextVoice: 0,
    dispose() {
      for (const v of voices) {
        try { v.carrier.stop(); } catch (e) {}
        try { v.modulator.stop(); } catch (e) {}
      }
    },
  };
}

function createDrumTimbre(ctx, timbreId) {
  const output = ctx.createGain();

  if (timbreId === 'kick') {
    output.gain.value = 0.5; // -6dB
    return { output, type: 'kick', dispose() {} };
  }
  if (timbreId === 'snare') {
    output.gain.value = 0.4; // -8dB
    return { output, type: 'snare', dispose() {} };
  }
  if (timbreId === 'hihat') {
    output.gain.value = 0.25; // -12dB
    return { output, type: 'hihat', dispose() {} };
  }
}

// ── Trigger timbre (play a note) ────────────────────────────
function triggerTimbre(ctx, synth, timbreId, stepData, velocity, duration, time) {
  if (timbreId === 'kick') {
    triggerKick(ctx, synth, stepData, velocity, duration, time);
    return;
  }
  if (timbreId === 'snare') {
    triggerSnare(ctx, synth, velocity, duration, time);
    return;
  }
  if (timbreId === 'hihat') {
    triggerHihat(ctx, synth, velocity, duration, time);
    return;
  }

  // Melodic: round-robin voice allocation
  const pitches = stepData.pitches || [60];
  const freq440 = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  for (const pitch of pitches) {
    const voice = synth.voices[synth.nextVoice % synth.voices.length];
    synth.nextVoice++;

    const freq = freq440(pitch);
    if (synth.type === 'am') {
      triggerAMVoice(ctx, voice, freq, velocity, duration, time);
    } else {
      triggerFMVoice(ctx, voice, freq, velocity, duration, time);
    }
  }
}

// ── Drum triggers ───────────────────────────────────────────
function triggerKick(ctx, synth, stepData, velocity, duration, time) {
  const osc = ctx.createOscillator();
  const envGain = ctx.createGain();

  osc.type = 'sine';
  const basePitch = (stepData.pitches && stepData.pitches[0]) || 36;
  const baseFreq = 440 * Math.pow(2, (basePitch - 69) / 12);

  // Frequency sweep: start high, drop to base
  osc.frequency.setValueAtTime(baseFreq * 8, time);
  osc.frequency.exponentialRampToValueAtTime(baseFreq, time + 0.05);

  // Amplitude envelope
  envGain.gain.setValueAtTime(velocity, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.connect(envGain);
  envGain.connect(synth.output);
  osc.start(time);
  osc.stop(time + duration + 0.1);
}

function triggerSnare(ctx, synth, velocity, duration, time) {
  // White noise burst
  const bufferSize = ctx.sampleRate * Math.max(duration, 0.2);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(velocity, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  // Bandpass for snare character
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2000;
  filter.Q.value = 1;

  source.connect(filter);
  filter.connect(envGain);
  envGain.connect(synth.output);
  source.start(time);
}

function triggerHihat(ctx, synth, velocity, duration, time) {
  // Multiple detuned oscillators + bandpass
  const freqs = [800, 1200, 1600, 2400, 3200];
  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(velocity, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 4000;
  filter.Q.value = 2;

  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.connect(filter);
    osc.start(time);
    osc.stop(time + duration + 0.1);
  }

  filter.connect(envGain);
  envGain.connect(synth.output);
}

export { createTimbre, triggerTimbre };
