// Timbre system using one-shot oscillators per note.
// react-native-audio-api does NOT support AudioNode.connect(AudioParam),
// so FM/AM synthesis via modulation routing is impossible.
// Oscillators are started immediately with gain=0, then the envelope
// controls when sound is actually heard (avoids relying on start(futureTime)).

// ── Timbre definitions ──────────────────────────────────────
const TIMBRE_CONFIGS = {
  classic: {
    oscType: 'sine',
    volume: -6,
    envelope: { attack: 0.005, decay: 0.3, sustain: 0.4, release: 0.8 },
  },
  bright: {
    oscType: 'sawtooth',
    volume: -12,
    envelope: { attack: 0.001, decay: 0.2, sustain: 0.3, release: 0.5 },
  },
  wurly: {
    oscType: 'triangle',
    volume: -4,
    envelope: { attack: 0.01, decay: 0.4, sustain: 0.35, release: 0.6 },
  },
  crystal: {
    oscType: 'square',
    volume: -14,
    envelope: { attack: 0.001, decay: 0.8, sustain: 0.1, release: 1.5 },
  },
  soft: {
    oscType: 'sine',
    volume: -6,
    envelope: { attack: 0.15, decay: 0.5, sustain: 0.6, release: 2.0 },
  },
};

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ── Create timbre (just an output gain node) ────────────────
function createTimbre(ctx, timbreId) {
  if (timbreId === 'kick' || timbreId === 'snare' || timbreId === 'hihat') {
    return createDrumTimbre(ctx, timbreId);
  }

  const config = TIMBRE_CONFIGS[timbreId];
  if (!config) {
    return createTimbre(ctx, 'classic');
  }

  const output = ctx.createGain();
  output.gain.value = dbToGain(config.volume);

  return { output, timbreId, dispose() {} };
}

function createDrumTimbre(ctx, timbreId) {
  const output = ctx.createGain();
  if (timbreId === 'kick') output.gain.value = 0.5;
  else if (timbreId === 'snare') output.gain.value = 0.4;
  else if (timbreId === 'hihat') output.gain.value = 0.25;
  else output.gain.value = 0.3;
  return { output, timbreId, dispose() {} };
}

// ── Trigger a note ──────────────────────────────────────────
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

  const config = TIMBRE_CONFIGS[timbreId] || TIMBRE_CONFIGS.classic;
  const pitches = stepData.pitches || [60];
  const env = config.envelope;

  for (const pitch of pitches) {
    const osc = ctx.createOscillator();
    const envGain = ctx.createGain();

    osc.type = config.oscType;
    osc.frequency.value = midiToFreq(pitch);

    // Start silent — envelope controls when sound is heard
    envGain.gain.value = 0;

    // Connect chain: osc → envGain → synth output
    osc.connect(envGain);
    envGain.connect(synth.output);

    // Start oscillator immediately (don't rely on start(futureTime))
    osc.start();

    // Schedule ADSR envelope at the precise time
    envGain.gain.setValueAtTime(0.001, time);
    envGain.gain.linearRampToValueAtTime(velocity, time + env.attack);
    envGain.gain.linearRampToValueAtTime(
      Math.max(0.001, velocity * env.sustain),
      time + env.attack + env.decay
    );

    const releaseStart = time + duration;
    envGain.gain.setValueAtTime(Math.max(0.001, velocity * env.sustain), releaseStart);
    envGain.gain.exponentialRampToValueAtTime(0.001, releaseStart + env.release);

    // Stop oscillator after release
    osc.stop(releaseStart + env.release + 0.2);
  }
}

// ── Drum triggers ───────────────────────────────────────────
function triggerKick(ctx, synth, stepData, velocity, duration, time) {
  const osc = ctx.createOscillator();
  const envGain = ctx.createGain();

  osc.type = 'sine';
  const basePitch = (stepData.pitches && stepData.pitches[0]) || 36;
  const baseFreq = midiToFreq(basePitch);

  envGain.gain.value = 0;
  osc.connect(envGain);
  envGain.connect(synth.output);
  osc.start();

  osc.frequency.setValueAtTime(baseFreq * 8, time);
  osc.frequency.exponentialRampToValueAtTime(Math.max(baseFreq, 0.001), time + 0.05);

  envGain.gain.setValueAtTime(velocity, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.stop(time + duration + 0.1);
}

function triggerSnare(ctx, synth, velocity, duration, time) {
  const bufferSize = Math.floor(ctx.sampleRate * Math.max(duration, 0.2));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const envGain = ctx.createGain();
  envGain.gain.value = 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2000;
  filter.Q.value = 1;

  source.connect(filter);
  filter.connect(envGain);
  envGain.connect(synth.output);
  source.start();

  envGain.gain.setValueAtTime(velocity, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
}

function triggerHihat(ctx, synth, velocity, duration, time) {
  const envGain = ctx.createGain();
  envGain.gain.value = 0;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 4000;
  filter.Q.value = 2;

  const freqs = [800, 1200, 1600, 2400, 3200];
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    osc.connect(filter);
    osc.start();
    osc.stop(time + duration + 0.1);
  }

  filter.connect(envGain);
  envGain.connect(synth.output);

  envGain.gain.setValueAtTime(velocity, time);
  envGain.gain.exponentialRampToValueAtTime(0.001, time + duration);
}

export { createTimbre, triggerTimbre };
