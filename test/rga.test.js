import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MissingParentError,
  anchorAt,
  canonicalDoc,
  createDoc,
  deleteNode,
  insertNode,
  loadDoc,
  mergeDocs,
  snapshotDoc,
  textOf,
  visibleIdsInRange,
} from '../src/rga.js';

function node(site, seq, parent, ch) {
  return { id: `${site}:${seq}`, parent, ch, counter: seq, site };
}

test('insertion after an anchor preserves reading order', () => {
  const doc = createDoc();
  insertNode(doc, node('a', 1, null, 'A'));
  insertNode(doc, node('a', 2, 'a:1', 'B'));
  insertNode(doc, node('a', 3, 'a:2', 'C'));
  assert.equal(textOf(doc), 'ABC');
  insertNode(doc, node('a', 4, null, 'X'));
  assert.equal(textOf(doc), 'XABC');
});

test('deleting a node keeps its children reachable', () => {
  const doc = createDoc();
  insertNode(doc, node('a', 1, null, 'A'));
  insertNode(doc, node('a', 2, 'a:1', 'B'));
  insertNode(doc, node('a', 3, 'a:2', 'C'));
  deleteNode(doc, 'a:2');
  assert.equal(textOf(doc), 'AC');
  // A new child of the tombstone is ordered by its own sort key.
  insertNode(doc, node('b', 1, 'a:2', 'Z'));
  assert.equal(textOf(doc), 'ACZ');
});

test('concurrent inserts at the same anchor converge to one order', () => {
  const left = createDoc();
  const right = createDoc();
  insertNode(left, node('a', 1, null, 'A'));
  insertNode(right, node('a', 1, null, 'A'));
  insertNode(left, node('a', 2, 'a:1', 'L'));
  insertNode(right, node('b', 1, 'a:1', 'R'));

  const mergedBothWays = [mergeDocs(left, right), mergeDocs(right, left)];
  assert.equal(textOf(mergedBothWays[0]), textOf(mergedBothWays[1]));
  assert.equal(textOf(mergedBothWays[0]).length, 3);
  assert.ok(['ALR', 'ARL'].includes(textOf(mergedBothWays[0])));
});

test('merging is idempotent and keeps deletions', () => {
  const left = createDoc();
  insertNode(left, node('a', 1, null, 'A'));
  insertNode(left, node('a', 2, 'a:1', 'B'));
  const right = createDoc();
  insertNode(right, node('a', 1, null, 'A'));
  deleteNode(right, 'a:1');

  const merged = mergeDocs(left, right);
  const again = mergeDocs(merged, right);
  assert.equal(textOf(merged), 'B');
  assert.equal(canonicalDoc(merged), canonicalDoc(again));
});

test('snapshot round trip preserves structure and rejects orphans', () => {
  const doc = createDoc();
  insertNode(doc, node('a', 1, null, 'A'));
  insertNode(doc, node('a', 2, 'a:1', 'B'));
  const restored = loadDoc(snapshotDoc(doc));
  assert.equal(textOf(restored), 'AB');
  assert.equal(canonicalDoc(restored), canonicalDoc(doc));

  const broken = { nodes: [node('a', 1, 'missing:1', 'A')], tombstones: [] };
  assert.throws(() => loadDoc(broken), MissingParentError);
});

test('deleting an unseen node leaves a tombstone that wins later', () => {
  const doc = createDoc();
  deleteNode(doc, 'a:9');
  insertNode(doc, node('a', 9, null, 'Q'));
  assert.equal(textOf(doc), '');
});

test('anchor and range helpers are bounds checked', () => {
  const doc = createDoc();
  insertNode(doc, node('a', 1, null, 'A'));
  assert.equal(anchorAt(doc, 0), null);
  assert.equal(anchorAt(doc, 1), 'a:1');
  assert.deepEqual(visibleIdsInRange(doc, 0, 1), ['a:1']);
  assert.throws(() => anchorAt(doc, 2), RangeError);
  assert.throws(() => visibleIdsInRange(doc, 1, 1), RangeError);
});
