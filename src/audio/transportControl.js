// Serialized AudioContext suspend/resume (pure — unit-tested under Node).
//
// On react-native-audio-api 0.6.5 every resume()/suspend() call runs on its
// OWN detached std::thread (AudioContextHostObject.h). Two calls issued
// back-to-back (pause→play tap, init's resume→suspend, the watchdog) race:
// the later call can execute first, leaving the context suspended while the
// UI says "playing" (silence + frozen hand until the watchdog fires), and
// both threads poke AVAudioEngine concurrently. This controller keeps a
// single desired state and applies it one awaited native call at a time.
//
// hooks.fadeOut()      → ms to wait before suspending (master ramp to 0)
// hooks.beforeSuspend(reason) → called right before the native suspend
export function createTransportControl(getContext, hooks = {}, timers = { setTimeout }) {
  let desired = null;
  let reason = null;
  let chain = Promise.resolve();
  let gen = 0;

  const wait = (ms) => new Promise(r => timers.setTimeout(r, Math.max(0, ms)));

  function enqueue(fn) {
    chain = chain.then(fn).catch(() => {});
    return chain;
  }

  async function apply(myGen) {
    const ctx = getContext();
    if (!ctx || myGen !== gen) return;
    if (desired === 'running') {
      if (ctx.state !== 'running') await ctx.resume();
      return;
    }
    if (desired === 'suspended') {
      if (ctx.state !== 'running') return;
      const ms = hooks.fadeOut ? hooks.fadeOut(reason) : 0;
      if (ms > 0) await wait(ms);
      if (myGen !== gen || desired !== 'suspended') return; // play pressed during the fade
      if (hooks.beforeSuspend) { try { hooks.beforeSuspend(reason); } catch (e) {} }
      await ctx.suspend();
    }
  }

  function request(state, why) {
    desired = state;
    reason = why || null;
    const myGen = ++gen;
    return enqueue(() => apply(myGen));
  }

  // Force the native engine to restart (suspend→resume) — the only way to
  // revive AVAudioEngine on 0.6.5 after an interruption or route/config
  // change, because the context still reports 'running'.
  function kick() {
    const myGen = gen;
    return enqueue(async () => {
      const ctx = getContext();
      if (!ctx || desired !== 'running' || myGen !== gen) return;
      try { await ctx.suspend(); } catch (e) {}
      if (desired === 'running') await ctx.resume();
    });
  }

  function getDesired() { return desired; }
  function idle() { return chain; }

  return { request, kick, getDesired, idle };
}
