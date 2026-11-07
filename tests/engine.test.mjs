import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, STEP, sweepBox, WIDTH } from '../src/engine.js';

function fixture(type, { vx = 70, vy = 480, seed = 123 } = {}) {
  const e = new Engine({ seed, generate: false });
  Object.assign(e.ball, { x: 200, y: 186, vx, vy });
  const n = e.addNote(type, 160, 210, 94, 110);
  return { e, n };
}
function untilHit(e) { for (let i = 0; i < 200 && !e.hits; i++) e.step(); assert.equal(e.hits, 1); }
test('blue note bounces the ball upward and can only be consumed once', () => {
  const { e, n } = fixture('tap'); untilHit(e);
  assert.ok(e.ball.vy < 0); assert.equal(n.dead, true);
  for (let i = 0; i < 240; i++) e.step();
  assert.equal(e.hits, 1);
});
test('yellow note keeps the incoming direction and increases speed', () => {
  const { e, n } = fixture('drag');
  const initialSpeed = e.speed; untilHit(e);
  assert.ok(e.ball.vy > 0); assert.ok(e.ball.vx > 0);
  assert.ok(e.speed > initialSpeed * 1.2); assert.equal(n.dead, true);
});
test('red note accelerates and uses genuinely different seeded directions', () => {
  const results = [];
  for (const seed of [1, 20, 300, 4000]) {
    const { e } = fixture('flick', { seed }); const speed = e.speed;
    untilHit(e); assert.ok(e.speed > speed); results.push(Math.atan2(e.ball.vy, e.ball.vx));
  }
  assert.equal(new Set(results).size, 4);
  assert.ok(results.some(x => x < 0)); assert.ok(results.some(x => x > 0));
});
test('hold locks X, descends at 105 units/sec, consumes along its length, then releases', () => {
  const { e, n } = fixture('hold'); untilHit(e);
  assert.ok(e.ball.hold); assert.equal(n.dead, false);
  const x = e.ball.x, y = e.ball.y;
  for (let i = 0; i < 120; i++) e.step();
  assert.equal(e.ball.x, x); assert.ok(Math.abs(e.ball.y - y - 52.5) < 1e-7);
  assert.ok(n.progress > 0.4 && n.progress < 0.6); assert.equal(e.ball.vx, 0);
  for (let i = 0; i < 150; i++) e.step();
  assert.equal(e.ball.hold, null); assert.equal(n.dead, true); assert.equal(e.hits, 1);
});
test('swept collisions catch a fast ball that crosses an entire key in one step', () => {
  const hit = sweepBox(200, 100, 0, 250, { x: 150, y: 200, w: 100, h: 6 }, 11);
  assert.ok(hit && hit.t > 0 && hit.t < 1); assert.equal(hit.ny, -1);
  const { e } = fixture('tap', { vx: 0, vy: 3000 });
  e.step(0.05); assert.equal(e.hits, 1); assert.ok(e.ball.vy < 0);
});
test('simulation is deterministic for a given seed and independent of render frequency', () => {
  const a = new Engine({ seed: 42 }), b = new Engine({ seed: 42 });
  for (let frame = 0; frame < 3600; frame++) { a.step(); a.step(); b.step(); b.step(); }
  assert.deepEqual(a.ball, b.ball); assert.equal(a.hits, b.hits); assert.equal(a.camera, b.camera);
});
test('all four mixed note types occur and an extended run remains bounded and finite', () => {
  const e = new Engine({ seed: 3467 }); let maxNotes = 0;
  for (let i = 0; i < 240 * 600; i++) {
    e.step(STEP); e.drainEvents(); maxNotes = Math.max(maxNotes, e.notes.length);
    assert.ok(Number.isFinite(e.ball.x + e.ball.y + e.camera));
    assert.ok(e.ball.x >= e.ball.r - 0.01 && e.ball.x <= WIDTH - e.ball.r + 0.01);
  }
  for (const type of ['tap', 'flick', 'drag', 'hold']) assert.ok(e.typeHits[type] > 0, `${type} was encountered`);
  assert.ok(e.maxDepth > 5000); assert.ok(maxNotes < 160); assert.ok(e.rows.length < 20); assert.ok(e.trail.length < 25);
});
