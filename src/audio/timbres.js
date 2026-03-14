// Ultra-simple timbre system.
// No AudioParam scheduling — just .value and setTimeout.
// This matches the pattern that produced the working test beep.

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

// Play a note RIGHT NOW using the simplest possible approach.
// No future scheduling, no AudioParam automation.
function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration) {
  const config = synth.config;
  const pitches = stepData.pitches || [60];
  const vol = config.volume * velocity;

  for (const pitch of pitches) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = config.oscType;
    osc.frequency.value = midiToFreq(pitch);
    gain.gain.value = vol;

    osc.connect(gain);
    gain.connect(masterGain);

    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + duration);
  }
}

export { createTimbre, triggerTimbre };
