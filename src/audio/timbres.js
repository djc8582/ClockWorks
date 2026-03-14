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

  setTimeout(() => { gain.gain.value = 0; }, releaseStart + releaseMs + 5);
  return releaseStart + releaseMs + 20;
}

// ── Bell ────────────────────────────────────────────────────
// Two detuned sines — shimmering, melodic
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
  osc2.frequency.value = freq * 2.01;
  const g2 = ctx.createGain();
  g2.gain.value = 0.35;
  osc2.connect(g2);
  g2.connect(gain);

  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 3.99;
  const g3 = ctx.createGain();
  g3.gain.value = 0.15;
  osc3.connect(g3);
  g3.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now); osc3.start(now);
  const stopTime = envelope(gain, vol * 0.3, 0.005, 0.4, 0.15, 0.6, durMs);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); osc3.stop(); } catch(e){} }, stopTime);
}

// ── Keys ────────────────────────────────────────────────────
// Sine + triangle — warm, piano-like
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
  const g2 = ctx.createGain();
  g2.gain.value = 0.4;
  osc2.connect(g2);
  g2.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now);
  const stopTime = envelope(gain, vol * 0.3, 0.005, 0.3, 0.35, 0.5, durMs);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch(e){} }, stopTime);
}

// ── Pluck ───────────────────────────────────────────────────
// Sawtooth through closing lowpass — guitar-like, snappy
function triggerPluck(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq * 6;
  filter.Q.value = 1.5;
  filter.connect(gain);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  osc.connect(filter);

  const now = ctx.currentTime;
  osc.start(now);

  // Filter closes over time
  setTimeout(() => { filter.frequency.value = freq * 4; }, 30);
  setTimeout(() => { filter.frequency.value = freq * 2.5; }, 80);
  setTimeout(() => { filter.frequency.value = freq * 1.8; }, 150);
  setTimeout(() => { filter.frequency.value = freq * 1.2; }, 250);

  const stopTime = envelope(gain, vol * 0.22, 0.002, 0.15, 0.2, 0.3, durMs);
  setTimeout(() => { try { osc.stop(); } catch(e){} }, stopTime);
}

// ── Marimba ─────────────────────────────────────────────────
// Sine with quick decay + sub-octave body — woody, percussive
function triggerMarimba(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  // Main tone
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(gain);

  // Sub-octave body
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.5;
  const g2 = ctx.createGain();
  g2.gain.value = 0.5;
  osc2.connect(g2);
  g2.connect(gain);

  // High harmonic click
  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 4;
  const g3 = ctx.createGain();
  g3.gain.value = 0.12;
  osc3.connect(g3);
  g3.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now); osc3.start(now);

  // Quick decay on the click harmonic
  setTimeout(() => { g3.gain.value = 0.04; }, 40);
  setTimeout(() => { g3.gain.value = 0; }, 100);

  const stopTime = envelope(gain, vol * 0.35, 0.002, 0.2, 0.08, 0.3, durMs);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); osc3.stop(); } catch(e){} }, stopTime);
}

// ── Bass ────────────────────────────────────────────────────
// Triangle an octave down through lowpass — deep, round, warm
function triggerBass(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq * 2;
  filter.Q.value = 0.8;
  filter.connect(gain);

  // Main bass tone (octave down)
  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq * 0.5;
  osc1.connect(filter);

  // Sub tone
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.5;
  const g2 = ctx.createGain();
  g2.gain.value = 0.6;
  osc2.connect(g2);
  g2.connect(filter);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now);
  const stopTime = envelope(gain, vol * 0.45, 0.005, 0.2, 0.4, 0.3, durMs);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch(e){} }, stopTime);
}

// ── Sub Bass ────────────────────────────────────────────────
// Pure sine two octaves down — deep sub, felt more than heard
function triggerSubBass(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);

  // Two octaves down
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq * 0.25;
  osc1.connect(gain);

  // Slight upper harmonic for definition
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.5;
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  osc2.connect(g2);
  g2.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now);
  const stopTime = envelope(gain, vol * 0.55, 0.005, 0.15, 0.5, 0.25, durMs);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch(e){} }, stopTime);
}

// ── Main trigger ────────────────────────────────────────────
function triggerTimbre(ctx, masterGain, synth, stepData, velocity, duration) {
  const pitches = stepData.pitches || [60];
  const durMs = duration * 1000;

  for (const pitch of pitches) {
    const freq = midiToFreq(pitch);
    switch (synth.timbreId) {
      case 'bell':    triggerBell(ctx, masterGain, freq, velocity, durMs); break;
      case 'keys':    triggerKeys(ctx, masterGain, freq, velocity, durMs); break;
      case 'pluck':   triggerPluck(ctx, masterGain, freq, velocity, durMs); break;
      case 'marimba': triggerMarimba(ctx, masterGain, freq, velocity, durMs); break;
      case 'bass':    triggerBass(ctx, masterGain, freq, velocity, durMs); break;
      case 'subbass': triggerSubBass(ctx, masterGain, freq, velocity, durMs); break;
      default:        triggerBell(ctx, masterGain, freq, velocity, durMs); break;
    }
  }
}

export { createTimbre, triggerTimbre };
