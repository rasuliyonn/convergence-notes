import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareClocks,
  covers,
  emptyClock,
  formatClock,
  mergeClocks,
  seen,
  sumClock,
  tick,
} from '../src/vector-clock.js';

test('tick is pure and increments one site', () => {
  const base = { a: 1 };
  const next = tick(base, 'a');
  assert.deepEqual(base, { a: 1 });
  assert.deepEqual(next, { a: 2 });
  assert.deepEqual(tick({}, 'b'), { b: 1 });
});

test('merge takes the componentwise maximum', () => {
  assert.deepEqual(mergeClocks({ a: 3, b: 1 }, { a: 1, c: 5 }), { a: 3, b: 1, c: 5 });
  assert.deepEqual(mergeClocks(emptyClock(), { z: 2 }), { z: 2 });
});

test('covers identifies causal knowledge', () => {
  assert.equal(covers({ a: 2, b: 1 }, { a: 1 }), true);
  assert.equal(covers({ a: 1 }, { a: 2 }), false);
  assert.equal(covers({ a: 1 }, {}), true);
});

test('compare distinguishes equal, before, after and concurrent', () => {
  assert.equal(compareClocks({ a: 1 }, { a: 1 }), 'equal');
  assert.equal(compareClocks({ a: 1 }, { a: 2 }), 'before');
  assert.equal(compareClocks({ a: 2 }, { a: 1 }), 'after');
  assert.equal(compareClocks({ a: 1 }, { b: 1 }), 'concurrent');
  assert.equal(compareClocks({ a: 1, b: 2 }, { a: 2, b: 1 }), 'concurrent');
});

test('seen and formatting helpers', () => {
  assert.equal(seen({ a: 3 }, 'a', 3), true);
  assert.equal(seen({ a: 3 }, 'a', 4), false);
  assert.equal(seen({}, 'a', 1), false);
  assert.equal(formatClock({ b: 2, a: 1 }), 'a:1 b:2');
  assert.equal(sumClock({ a: 1, b: 2, c: 3 }), 6);
});
