// Timbre system — one-shot oscillators.
// AudioParam scheduling (linearRamp, exponentialRamp) does NOT work
// reliably in react-native-audio-api v0.5. Use direct .value assignment
// and JS setTimeout for fade-out (matches the working test beep pattern).

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
  const durMs = duration * 1000;

  for (const pitch of pitches) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = config.oscType;
    osc.frequency.value = midiToFreq(pitch);
    gain.gain.value = vol;

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);

    // JS-based fade-out to prevent stop clicks
    setTimeout(() => { gain.gain.value = vol * 0.3; }, Math.max(0, durMs - 40));
    setTimeout(() => { gain.gain.value = vol * 0.05; }, Math.max(0, durMs - 15));
    setTimeout(() => {
      gain.gain.value = 0;
      try { osc.stop(); } catch (e) {}
    }, durMs + 5);
  }
}

export { createTimbre, triggerTimbre };
