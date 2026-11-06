import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addValue,
  canonicalSet,
  createSet,
  hasValue,
  loadSet,
  mergeSets,
  removeValue,
  snapshotSet,
  tagsOf,
  values,
} from '../src/orset.js';

test('add, remove and membership', () => {
  const set = createSet();
  assert.equal(addValue(set, 'draft', 'a:1'), true);
  assert.equal(addValue(set, 'draft', 'a:1'), false);
  assert.equal(hasValue(set, 'draft'), true);
  assert.deepEqual(values(set), ['draft']);
  assert.deepEqual(removeValue(set, 'draft'), ['a:1']);
  assert.equal(hasValue(set, 'draft'), false);
  assert.deepEqual(values(set), []);
});

test('a concurrent add survives a remove (add wins)', () => {
  const left = createSet();
  addValue(left, 'urgent', 'a:1');
  const right = createSet();
  addValue(right, 'urgent', 'b:1');

  removeValue(left, 'urgent');
  assert.equal(hasValue(left, 'urgent'), false);

  const merged = mergeSets(left, right);
  assert.equal(hasValue(merged, 'urgent'), true);
  assert.deepEqual(tagsOf(merged, 'urgent'), ['b:1']);
});

test('a removed tag cannot resurrect from a stale peer', () => {
  const authority = createSet();
  addValue(authority, 'urgent', 'a:1');
  const stale = mergeSets(createSet(), authority);
  removeValue(authority, 'urgent');

  const merged = mergeSets(authority, stale);
  assert.equal(hasValue(merged, 'urgent'), false);
  assert.equal(canonicalSet(merged), canonicalSet(authority));
});

test('snapshots survive a serialisation round trip', () => {
  const set = createSet();
  addValue(set, 'alpha', 'a:1');
  addValue(set, 'alpha', 'b:2');
  removeValue(set, 'alpha');
  addValue(set, 'beta', 'a:3');
  const restored = loadSet(JSON.parse(JSON.stringify(snapshotSet(set))));
  assert.equal(canonicalSet(restored), canonicalSet(set));
  assert.deepEqual(values(restored), ['beta']);
});
