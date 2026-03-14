// Timbre system — one-shot oscillators with simple fade envelope.

const TIMBRE_CONFIGS = {
  classic: { oscType: 'sine', volume: 0.25 },
  bright: { oscType: 'sawtooth', volume: 0.12 },
  wurly: { oscType: 'triangle', volume: 0.3 },
  crystal: { oscType: 'square', volume: 0.08 },
  soft: { oscType: 'sine', volume: 0.2 },
};

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function createTimbre(ctx, timbreId) {
  const config = TIMBRE_CONFIGS[timbreId] || TIMBRE_CONFIGS.classic;
  return { config, timbreId, dispose() {} };
}

function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration) {
  const config = synth.config;
  const pitches = stepData.pitches || [60];
  const vol = config.volume * velocity;
  const now = ctx.currentTime;

  // Fade times to prevent clicks
  const fadeIn = 0.015;
  const fadeOut = 0.04;
  const stopTime = now + duration + fadeOut + 0.01;

  for (const pitch of pitches) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = config.oscType;
    osc.frequency.value = midiToFreq(pitch);

    // Start silent, fade in, hold, fade out
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + fadeIn);
    gain.gain.setValueAtTime(vol, now + duration);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration + fadeOut);

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(now);
    osc.stop(stopTime);
  }
}

export { createTimbre, triggerTimbre };
