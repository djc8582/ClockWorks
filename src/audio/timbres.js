// Timbre system — one-shot oscillators per note.
// Uses osc.start(time) for precise scheduling on the audio thread.
// Envelopes use exponentialRampToValueAtTime with 0.00001 floor
// (matching react-native-audio-api official examples).

const TIMBRE_CONFIGS = {
  classic: {
    oscType: 'sine',
    volume: -6,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.4,
    release: 0.5,
  },
  bright: {
    oscType: 'sawtooth',
    volume: -12,
    attack: 0.005,
    decay: 0.15,
    sustain: 0.3,
    release: 0.3,
  },
  wurly: {
    oscType: 'triangle',
    volume: -4,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.35,
    release: 0.4,
  },
  crystal: {
    oscType: 'square',
    volume: -16,
    attack: 0.005,
    decay: 0.6,
    sustain: 0.15,
    release: 1.0,
  },
  soft: {
    oscType: 'sine',
    volume: -6,
    attack: 0.1,
    decay: 0.4,
    sustain: 0.5,
    release: 1.5,
  },
};

function dbToGain(db) {
  return Math.pow(10, db / 20);
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// createTimbre just returns config + volume multiplier
function createTimbre(ctx, timbreId) {
  const config = TIMBRE_CONFIGS[timbreId] || TIMBRE_CONFIGS.classic;
  return {
    config,
    volume: dbToGain(config.volume),
    timbreId,
    dispose() {},
  };
}

// Play a note at a precise scheduled time.
// Creates osc → gain → destination (masterGain).
// Everything is scheduled on the audio thread.
function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration, time) {
  const config = synth.config;
  const pitches = stepData.pitches || [60];
  const vol = synth.volume * velocity;

  for (const pitch of pitches) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = config.oscType;
    osc.frequency.value = midiToFreq(pitch);

    // Connect: osc → gain → masterGain (→ destination)
    osc.connect(gain);
    gain.connect(masterGain);

    // ADSR envelope (matching react-native-audio-api official pattern)
    // Use 0.00001 as floor (exponentialRamp can't use 0)
    const peak = Math.max(0.00001, vol);
    const sus = Math.max(0.00001, vol * config.sustain);
    const attackEnd = time + config.attack;
    const decayEnd = attackEnd + config.decay;
    const releaseStart = time + duration;
    const releaseEnd = releaseStart + config.release;

    gain.gain.setValueAtTime(0.00001, time);
    gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
    gain.gain.exponentialRampToValueAtTime(sus, decayEnd);
    gain.gain.setValueAtTime(sus, releaseStart);
    gain.gain.exponentialRampToValueAtTime(0.00001, releaseEnd);

    // Schedule oscillator start and stop on the audio thread
    osc.start(time);
    osc.stop(releaseEnd + 0.05);
  }
}

export { createTimbre, triggerTimbre };
