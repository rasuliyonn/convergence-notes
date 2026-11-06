import test from 'node:test';
import assert from 'node:assert/strict';

import { Replica } from '../src/replica.js';
import { fuzzConvergence, mergeAssociativityCheck } from '../src/fuzz.js';
import { loadNote } from '../src/note.js';

test('concurrent inserts at the same position converge', () => {
  const left = new Replica('left');
  const right = new Replica('right');
  left.insert(0, 'base ');
  right.sync(left);

  left.insert(5, 'LEFT ');
  right.insert(5, 'RIGHT ');
  left.sync(right);

  assert.equal(left.text, right.text);
  assert.match(left.text, /^base (LEFT RIGHT|RIGHT LEFT) $/);
  assert.deepEqual(left.stats().clock, right.stats().clock);
});

test('second sync transfers nothing', () => {
  const left = new Replica('left');
  const right = new Replica('right');
  left.insert(0, 'hello');
  left.sync(right);
  const second = left.sync(right);
  assert.deepEqual(second, { sent: 0, received: 0 });
});

test('receiving the same batch twice is idempotent', () => {
  const source = new Replica('src');
  source.insert(0, 'abcdef');
  const ops = [...source.log];
  const target = new Replica('dst');
  target.receive(ops);
  const first = target.canonicalState();
  target.receive(ops);
  assert.equal(target.canonicalState(), first);
  assert.equal(target.text, 'abcdef');
});

test('out-of-order delivery is buffered until the anchor arrives', () => {
  const source = new Replica('src');
  source.insert(0, 'anchor ');
  source.insert(7, 'after');
  const target = new Replica('dst');
  const inserts = source.log.filter((op) => op.kind === 'insert');
  target.receive([...inserts].reverse());
  assert.equal(target.text, source.text);
  assert.equal(target.stats().bufferedOps, 0);
});

test('deleted text stays deleted across full mesh sync', () => {
  const left = new Replica('left');
  const right = new Replica('right');
  left.insert(0, 'keep DELETE keep');
  right.sync(left);
  left.remove(5, 6);
  right.insert(0, '>> ');
  left.sync(right);
  right.sync(left);
  assert.equal(left.text, right.text);
  assert.equal(left.text.includes('DELETE'), false);
});

test('state snapshots merge associatively for disjoint edits', () => {
  const a = new Replica('a');
  const b = new Replica('b');
  const c = new Replica('c');
  a.insert(0, 'alpha');
  b.insert(0, 'beta');
  c.insert(0, 'gamma');
  a.tag('one');
  b.tag('two');
  c.rename('Merged');

  const result = mergeAssociativityCheck([a.snapshot(), b.snapshot(), c.snapshot()]);
  assert.equal(result.associative, true);
});

test('snapshot merge converges with a late joiner', () => {
  const source = new Replica('source');
  source.insert(0, 'shared state');
  source.tag('draft');
  const joiner = Replica.fromSnapshot(source.snapshot());
  assert.equal(joiner.text, 'shared state');
  assert.deepEqual(joiner.tags, ['draft']);
});

test('random partitions converge and stay idempotent', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const result = fuzzConvergence({ seed, steps: 130, replicas: 4 });
    assert.equal(result.converged, true, `seed ${seed} diverged`);
    assert.equal(new Set(result.states).size, 1, `seed ${seed} produced multiple states`);
  }
});

test('fuzz history actually exercises the interesting paths', () => {
  const result = fuzzConvergence({ seed: 99, steps: 200, replicas: 3 });
  assert.ok(result.history.insert > 20);
  assert.ok(result.history.delete > 5);
  assert.ok(result.history.syncs > 5);
  assert.ok(result.text.length > 0);
});

test('canonical states ignore pending buffers once anchors arrive', () => {
  const source = new Replica('source');
  source.insert(0, 'xyz');
  const note = loadNote(source.snapshot());
  assert.equal(note.pending.length, 0);
});
