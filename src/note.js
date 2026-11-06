/**
 * A note is an RGA text plus an OR-Set of tags and a last-writer-wins title.
 * Mutations emit operations: the same operations can be replayed on a peer,
 * or the whole note can be merged as a state snapshot. Both paths converge.
 */
import {
  MissingParentError,
  anchorAt,
  createDoc,
  deleteNode,
  flatten,
  insertNode,
  loadDoc,
  mergeDocs,
  snapshotDoc,
  textOf,
  visibleIdsInRange,
} from './rga.js';
import {
  addValue,
  canonicalSet,
  createSet,
  hasValue,
  loadSet,
  mergeSets,
  removeValue,
  retireTags,
  tagsOf,
  snapshotSet,
  values,
} from './orset.js';
import { mergeClocks, tick } from './vector-clock.js';

export function createNote(site, title = 'Untitled') {
  return {
    site,
    doc: createDoc(),
    tags: createSet(),
    title: { value: title, lamport: 0, site },
    clock: {},
    pending: [],
  };
}

function nextSeq(note, site) {
  return (note.clock[site] || 0) + 1;
}

function commit(note, op) {
  note.clock = { ...note.clock, [op.site]: Math.max(note.clock[op.site] || 0, op.seq) };
  return op;
}

export function text(note) {
  return textOf(note.doc);
}

export function tagValues(note) {
  return values(note.tags);
}

/** Split text into grapheme-ish chunks: one code point per CRDT node. */
function charsOf(input) {
  return [...input];
}

export function applyOp(note, op) {
  switch (op.kind) {
    case 'insert': {
      try {
        insertNode(note.doc, op);
      } catch (error) {
        if (!(error instanceof MissingParentError)) throw error;
        if (!note.pending.some((item) => item.id === op.id)) note.pending.push(op);
      }
      drainPending(note);
      break;
    }
    case 'delete':
      deleteNode(note.doc, op.id);
      break;
    case 'tag-add':
      addValue(note.tags, op.value, op.tag);
      break;
    case 'tag-remove':
      retireTags(note.tags, op.value, op.tags);
      break;
    case 'title':
      if (
        op.lamport > note.title.lamport ||
        (op.lamport === note.title.lamport && op.site > note.title.site)
      ) {
        note.title = { value: op.value, lamport: op.lamport, site: op.site };
      }
      break;
    default:
      throw new Error(`unknown operation kind: ${op.kind}`);
  }
  return commit(note, op);
}

export function drainPending(note) {
  let progress = true;
  while (note.pending.length > 0 && progress) {
    progress = false;
    const remaining = [];
    for (const op of note.pending) {
      try {
        insertNode(note.doc, op);
        progress = true;
      } catch (error) {
        if (!(error instanceof MissingParentError)) throw error;
        remaining.push(op);
      }
    }
    note.pending = remaining;
  }
}

export function insertText(note, site, index, input) {
  const ops = [];
  let anchor = anchorAt(note.doc, index);
  for (const ch of charsOf(input)) {
    const seq = nextSeq(note, site);
    const op = {
      kind: 'insert',
      id: `${site}:${seq}`,
      parent: anchor,
      ch,
      counter: seq,
      site,
      seq,
    };
    applyOp(note, op);
    ops.push(op);
    anchor = op.id;
  }
  return ops;
}

export function deleteRange(note, site, index, length) {
  const ops = [];
  for (const id of visibleIdsInRange(note.doc, index, length)) {
    const seq = nextSeq(note, site);
    const op = { kind: 'delete', id, site, seq };
    applyOp(note, op);
    ops.push(op);
  }
  return ops;
}

export function addTag(note, site, value) {
  const seq = nextSeq(note, site);
  const op = { kind: 'tag-add', value, tag: `${site}:${seq}`, site, seq };
  return [applyOp(note, op)];
}

export function removeTag(note, site, value) {
  if (!hasValue(note.tags, value)) return [];
  const seq = nextSeq(note, site);
  const op = { kind: 'tag-remove', value, tags: tagsOf(note.tags, value), site, seq };
  return [applyOp(note, op)];
}

export function setTitle(note, site, value) {
  const lamport = Math.max(...Object.values(note.clock), 0) + 1;
  const seq = nextSeq(note, site);
  const op = { kind: 'title', value, lamport, site, seq };
  return [applyOp(note, op)];
}

export function snapshotNote(note) {
  return {
    site: note.site,
    doc: snapshotDoc(note.doc),
    tags: snapshotSet(note.tags),
    title: note.title,
    clock: Object.fromEntries(Object.entries(note.clock).sort()),
    pending: [...note.pending].sort((left, right) =>
      left.site === right.site ? left.seq - right.seq : left.site < right.site ? -1 : 1,
    ),
  };
}

export function loadNote(snapshot) {
  const note = {
    site: snapshot.site,
    doc: loadDoc(snapshot.doc),
    tags: loadSet(snapshot.tags),
    title: snapshot.title,
    clock: { ...snapshot.clock },
    pending: [...(snapshot.pending || [])],
  };
  drainPending(note);
  return note;
}

export function mergeNotes(left, right) {
  const merged = {
    site: left.site,
    doc: mergeDocs(left.doc, right.doc),
    tags: mergeSets(left.tags, right.tags),
    title:
      right.title.lamport > left.title.lamport ||
      (right.title.lamport === left.title.lamport && right.title.site > left.title.site)
        ? right.title
        : left.title,
    clock: mergeClocks(left.clock, right.clock),
    pending: [...left.pending, ...right.pending],
  };
  drainPending(merged);
  return merged;
}

export function canonicalNote(note) {
  const snapshot = snapshotNote(note);
  return JSON.stringify({
    doc: snapshot.doc,
    tags: canonicalSet(note.tags),
    title: snapshot.title,
    clock: snapshot.clock,
  });
}

export function noteStats(note) {
  const nodes = flatten(note.doc);
  return {
    characters: nodes.filter((node) => !node.deleted).length,
    tombstones: nodes.filter((node) => node.deleted).length,
    pendingOps: note.pending.length,
    tags: tagValues(note).length,
  };
}

export { visibleIdsInRange };
