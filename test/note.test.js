import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addTag,
  canonicalNote,
  createNote,
  deleteRange,
  insertText,
  loadNote,
  mergeNotes,
  noteStats,
  removeTag,
  setTitle,
  snapshotNote,
  tagValues,
  text,
} from '../src/note.js';

test('text editing through operations', () => {
  const note = createNote('a');
  insertText(note, 'a', 0, 'hello');
  insertText(note, 'a', 5, ' world');
  insertText(note, 'a', 0, '> ');
  assert.equal(text(note), '> hello world');
  deleteRange(note, 'a', 0, 2);
  assert.equal(text(note), 'hello world');
  const stats = noteStats(note);
  assert.equal(stats.characters, 11);
  assert.equal(stats.tombstones, 2);
});

test('tags are an observed-remove set', () => {
  const note = createNote('a');
  addTag(note, 'a', 'draft');
  addTag(note, 'a', 'review');
  assert.deepEqual(tagValues(note), ['draft', 'review']);
  removeTag(note, 'a', 'draft');
  assert.deepEqual(tagValues(note), ['review']);
  assert.deepEqual(removeTag(note, 'a', 'missing'), []);
});

test('title last-writer-wins uses lamport then site', () => {
  const left = createNote('a');
  const right = createNote('b');
  setTitle(left, 'a', 'Draft');
  setTitle(right, 'b', 'Final');
  // Both notes have lamport 1; the higher site id wins deterministically.
  assert.equal(mergeNotes(left, right).title.value, 'Final');
  assert.equal(mergeNotes(right, left).title.value, 'Final');

  setTitle(left, 'a', 'Frozen');
  assert.equal(mergeNotes(left, right).title.value, 'Frozen');
});

test('snapshot round trip keeps pending operations', () => {
  const note = createNote('a');
  insertText(note, 'a', 0, 'abc');
  // A child whose parent has not arrived yet stays pending, but is preserved.
  note.pending.push({
    kind: 'insert',
    id: 'z:1',
    parent: 'z:99',
    ch: '!',
    counter: 1,
    site: 'z',
    seq: 1,
  });
  const restored = loadNote(JSON.parse(JSON.stringify(snapshotNote(note))));
  assert.equal(text(restored), 'abc');
  assert.equal(restored.pending.length, 1);

  restored.pending = [];
  assert.equal(canonicalNote(loadNote(snapshotNote(restored))), canonicalNote(restored));
});

test('range and index errors are explicit', () => {
  const note = createNote('a');
  insertText(note, 'a', 0, 'abc');
  assert.throws(() => insertText(note, 'a', 5, 'x'), RangeError);
  assert.throws(() => deleteRange(note, 'a', 2, 2), RangeError);
});
