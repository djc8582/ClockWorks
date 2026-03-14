// Timbre system — layered oscillators + filters.
// Uses direct .value and JS setTimeout for envelopes.
// Start at target volume (no attack click), smooth multi-step fade-out.

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function createTimbre(ctx, timbreId) {
  return { timbreId, dispose() {} };
}

// Smooth fade-out: decays gain from vol to 0 over releaseMs
function fadeOut(gain, vol, durMs, releaseMs) {
  const steps = 12;
  const stepMs = releaseMs / steps;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Exponential-ish curve for natural decay
    const v = vol * (1 - t) * (1 - t);
    setTimeout(() => { gain.gain.value = Math.max(0, v); }, durMs + stepMs * i);
  }
  setTimeout(() => { gain.gain.value = 0; }, durMs + releaseMs + 5);
  return durMs + releaseMs + 20;
}

// Helper: create gain, connect, set volume, start oscs, schedule fade + stop
function playOscs(ctx, masterGain, oscs, vol, durMs, releaseMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol; // Start at target volume (no attack click)
  gain.connect(masterGain);

  for (const osc of oscs) {
    osc.connect(gain);
    osc.start(ctx.currentTime);
  }

  const stopTime = fadeOut(gain, vol, durMs, releaseMs);
  setTimeout(() => {
    for (const osc of oscs) { try { osc.stop(); } catch(e){} }
  }, stopTime);
}

// Helper: create gain node at a specific level (for mixing oscillators)
function mixGain(ctx, osc, level, dest) {
  const g = ctx.createGain();
  g.gain.value = level;
  osc.connect(g);
  g.connect(dest);
}

// ── Bell ────────────────────────────────────────────────────
function triggerBell(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol * 0.3;
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 2.01;
  mixGain(ctx, osc2, 0.35, gain);

  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 3.99;
  mixGain(ctx, osc3, 0.15, gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now); osc3.start(now);

  const stopTime = fadeOut(gain, vol * 0.3, durMs, 500);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); osc3.stop(); } catch(e){} }, stopTime);
}

// ── Keys ────────────────────────────────────────────────────
function triggerKeys(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol * 0.3;
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = freq;
  mixGain(ctx, osc2, 0.4, gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now);

  const stopTime = fadeOut(gain, vol * 0.3, durMs, 400);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch(e){} }, stopTime);
}

// ── Pluck ───────────────────────────────────────────────────
function triggerPluck(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol * 0.22;
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

  const stopTime = fadeOut(gain, vol * 0.22, durMs, 250);
  setTimeout(() => { try { osc.stop(); } catch(e){} }, stopTime);
}

// ── Marimba ─────────────────────────────────────────────────
function triggerMarimba(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol * 0.35;
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq;
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.5;
  mixGain(ctx, osc2, 0.5, gain);

  const osc3 = ctx.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = freq * 4;
  const clickGain = ctx.createGain();
  clickGain.gain.value = 0.12;
  osc3.connect(clickGain);
  clickGain.connect(gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now); osc3.start(now);

  // Quick click decay
  setTimeout(() => { clickGain.gain.value = 0.04; }, 40);
  setTimeout(() => { clickGain.gain.value = 0; }, 100);

  const stopTime = fadeOut(gain, vol * 0.35, durMs, 300);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); osc3.stop(); } catch(e){} }, stopTime);
}

// ── Bass ────────────────────────────────────────────────────
function triggerBass(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol * 0.45;
  gain.connect(masterGain);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = freq * 2;
  filter.Q.value = 0.8;
  filter.connect(gain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq * 0.5;
  osc1.connect(filter);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.5;
  mixGain(ctx, osc2, 0.6, filter);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now);

  const stopTime = fadeOut(gain, vol * 0.45, durMs, 250);
  setTimeout(() => { try { osc1.stop(); osc2.stop(); } catch(e){} }, stopTime);
}

// ── Sub Bass ────────────────────────────────────────────────
function triggerSubBass(ctx, masterGain, freq, vol, durMs) {
  const gain = ctx.createGain();
  gain.gain.value = vol * 0.55;
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = freq * 0.25;
  osc1.connect(gain);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = freq * 0.5;
  mixGain(ctx, osc2, 0.25, gain);

  const now = ctx.currentTime;
  osc1.start(now); osc2.start(now);

  const stopTime = fadeOut(gain, vol * 0.55, durMs, 200);
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
