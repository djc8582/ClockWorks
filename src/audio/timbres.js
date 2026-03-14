// Timbre system — layered oscillators + filters for rich, distinct sounds.
// Uses direct .value assignment and JS setTimeout for envelopes
// (AudioParam ramps are broken in react-native-audio-api v0.5).

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function createTimbre(ctx, timbreId) {
  return { timbreId, dispose() {} };
}

// Smooth JS envelope: ramps gain over multiple steps via setTimeout
function envelope(gain, vol, attack, decay, sustain, release, durMs) {
  const steps = 8;

  if (attack > 0) {
    // Attack: 0 → vol
    const attackMs = attack * 1000;
    const attackStep = attackMs / steps;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      setTimeout(() => { gain.gain.value = vol * t; }, attackStep * i);
    }
  } else {
    gain.gain.value = vol;
  }

  // Decay: vol → sustain level
  const decayStart = attack * 1000;
  const decayMs = decay * 1000;
  const susVol = vol * sustain;
  if (decay > 0 && sustain < 1) {
    const decayStep = decayMs / steps;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const v = vol + (susVol - vol) * t;
      setTimeout(() => { gain.gain.value = v; }, decayStart + decayStep * i);
    }
  }

  // Release: sustain → 0
  const releaseStart = durMs;
  const releaseMs = release * 1000;
  const releaseStep = releaseMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const v = susVol * (1 - t);
    setTimeout(() => { gain.gain.value = Math.max(0, v); }, releaseStart + releaseStep * i);
  }

  // Final silence
  setTimeout(() => { gain.gain.value = 0; }, releaseStart + releaseMs + 5);

  return releaseStart + releaseMs + 20;
}

// ── Bell ────────────────────────────────────────────────────
// Two detuned sines create a shimmering, bell-like tone
function triggerBell(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2.01; // Slight detune on overtone
  const gain2 = ctx.createGain();
  gain2.gain.value = 0.35;
  osc2.connect(gain2);
  gain2.connect(gain);

  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 3.99;
  const gain3 = ctx.createGain();
  gain3.gain.value = 0.15;
  osc3.connect(gain3);
  gain3.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now);
  osc2.start(now);
  osc3.start(now);

  const stopTime = envelope(gain, vol * 0.3, 0.005, 0.4, 0.15, 0.6, durMs);

  setTimeout(() => {
    try { osc1.stop(); osc2.stop(); osc3.stop(); } catch (e) {}
  }, stopTime);
}

// ── Keys ────────────────────────────────────────────────────
// Sine + triangle layered — warm, piano-like
function triggerKeys(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = freq;
  const gain2 = ctx.createGain();
  gain2.gain.value = 0.4;
  osc2.connect(gain2);
  gain2.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now);
  osc2.start(now);

  const stopTime = envelope(gain, vol * 0.3, 0.005, 0.3, 0.35, 0.5, durMs);

  setTimeout(() => {
    try { osc1.stop(); osc2.stop(); } catch (e) {}
  }, stopTime);
}

// ── Pad ─────────────────────────────────────────────────────
// Triangle through lowpass — soft, atmospheric, slow attack
function triggerPad(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq * 3;
  filter.Q.value = 0.7;
  filter.connect(gain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;
  osc1.connect(filter);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.998; // Slight detune for width
  const gain2 = ctx.createGain();
  gain2.gain.value = 0.5;
  osc2.connect(gain2);
  gain2.connect(filter);

  const now = ctx.currentTime;
  osc1.start(now);
  osc2.start(now);

  const stopTime = envelope(gain, vol * 0.35, 0.12, 0.3, 0.7, 0.8, durMs);

  setTimeout(() => {
    try { osc1.stop(); osc2.stop(); } catch (e) {}
  }, stopTime);
}

// ── Pluck ───────────────────────────────────────────────────
// Sawtooth through lowpass that closes quickly — guitar-like
function triggerPluck(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq * 6; // Start bright
  filter.Q.value = 1.5;
  filter.connect(gain);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  osc.connect(filter);

  const now = ctx.currentTime;
  osc.start(now);

  // Simulate filter closing over time (pluck characteristic)
  setTimeout(() => { filter.frequency.value = freq * 4; }, 30);
  setTimeout(() => { filter.frequency.value = freq * 2.5; }, 80);
  setTimeout(() => { filter.frequency.value = freq * 1.8; }, 150);
  setTimeout(() => { filter.frequency.value = freq * 1.2; }, 250);

  const stopTime = envelope(gain, vol * 0.2, 0.002, 0.15, 0.2, 0.3, durMs);

  setTimeout(() => {
    try { osc.stop(); } catch (e) {}
  }, stopTime);
}

// ── Glass ───────────────────────────────────────────────────
// Square through bandpass — thin, crystalline, ethereal
function triggerGlass(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq * 2;
  filter.Q.value = 4;
  filter.connect(gain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'square';
  osc1.frequency.value = freq;
  osc1.connect(filter);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 3.01; // Inharmonic partial
  const gain2 = ctx.createGain();
  gain2.gain.value = 0.2;
  osc2.connect(gain2);
  gain2.connect(gain); // Bypass filter for the high partial

  const now = ctx.currentTime;
  osc1.start(now);
  osc2.start(now);

  const stopTime = envelope(gain, vol * 0.18, 0.005, 0.5, 0.1, 1.0, durMs);

  setTimeout(() => {
    try { osc1.stop(); osc2.stop(); } catch (e) {}
  }, stopTime);
}

// ── Main trigger ────────────────────────────────────────────
function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration) {
  const pitches = stepData.pitches || [60];
  const durMs = duration * 1000;

  for (const pitch of pitches) {
    const freq = midiToFreq(pitch);

    switch (synth.timbreId) {
      case 'bell':
        triggerBell(ctx, masterGain, freq, velocity, durMs);
        break;
      case 'keys':
        triggerKeys(ctx, masterGain, freq, velocity, durMs);
        break;
      case 'pad':
        triggerPad(ctx, masterGain, freq, velocity, durMs);
        break;
      case 'pluck':
        triggerPluck(ctx, masterGain, freq, velocity, durMs);
        break;
      case 'glass':
        triggerGlass(ctx, masterGain, freq, velocity, durMs);
        break;
      default:
        triggerBell(ctx, masterGain, freq, velocity, durMs);
        break;
    }
  }
}

export { createTimbre, triggerTimbre };
