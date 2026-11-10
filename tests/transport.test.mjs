import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTransportControl } from '../src/audio/transportControl.js';

// Fake context mimicking 0.6.5: each call completes after a random delay
// (its own native thread) — unserialized calls can finish out of order.
function fakeCtx() {
  const log = [];
  const ctx = {
    state: 'suspended', log,
    resume() { return new Promise(r => setTimeout(() => { ctx.state = 'running'; log.push('resume'); r(); }, Math.random() * 5)); },
    suspend() { return new Promise(r => setTimeout(() => { ctx.state = 'suspended'; log.push('suspend'); r(); }, Math.random() * 5)); },
  };
  return ctx;
}

test('unserialized calls can end in the wrong state (the 0.6.5 race this fixes)', async () => {
  let wrong = 0;
  for (let k = 0; k < 40; k++) {
    const ctx = fakeCtx(); ctx.state = 'running';
    ctx.suspend(); await ctx.resume(); await new Promise(r => setTimeout(r, 8));
    if (ctx.state !== 'running') wrong++;
  }
  assert.ok(wrong > 0, 'race reproduced');
});

test('rapid pause→play always ends running; fade + kill only when really suspending', async () => {
  for (let k = 0; k < 40; k++) {
    const ctx = fakeCtx(); ctx.state = 'running';
    let kills = 0, fades = 0;
    const tc = createTransportControl(() => ctx, { fadeOut: () => { fades++; return 3; }, beforeSuspend: () => { kills++; } });
    tc.request('suspended', 'pause');
    if (k % 2) await new Promise(r => setTimeout(r, 1));
    tc.request('running');
    await tc.idle();
    assert.equal(ctx.state, 'running');
    assert.equal(kills, 0, 'no kill when play pressed during the fade');
  }
});

test('pause after play ends suspended, with fade before suspend', async () => {
  const ctx = fakeCtx();
  const order = [];
  const tc = createTransportControl(() => ctx, { fadeOut: () => { order.push('fade'); return 2; }, beforeSuspend: () => order.push('kill') });
  tc.request('running');
  tc.request('suspended', 'pause');
  await tc.idle();
  // 'running' was superseded before it ran → context stays suspended, no suspend needed
  assert.equal(ctx.state, 'suspended');
  tc.request('running'); await tc.idle();
  tc.request('suspended', 'pause'); await tc.idle();
  assert.equal(ctx.state, 'suspended');
  assert.deepEqual(order, ['fade', 'kill']);
});

test('kick restarts the engine (suspend then resume) only while playing', async () => {
  const ctx = fakeCtx();
  const tc = createTransportControl(() => ctx);
  tc.request('running'); await tc.idle();
  ctx.log.length = 0;
  tc.kick(); await tc.idle();
  assert.deepEqual(ctx.log, ['suspend', 'resume']);
  assert.equal(ctx.state, 'running');
  tc.request('suspended'); await tc.idle();
  ctx.log.length = 0;
  tc.kick(); await tc.idle();
  assert.deepEqual(ctx.log, []);
});
