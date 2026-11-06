/**
 * A replica owns a note, an operation log and a vector clock. Peers exchange
 * only the operations the other side has not seen, which is a vector-clock
 * delta sync; state snapshots are supported as a second, equivalent transport.
 */
import {
  addTag,
  applyOp,
  canonicalNote,
  createNote,
  deleteRange,
  insertText,
  loadNote,
  mergeNotes,
  removeTag,
  setTitle,
  snapshotNote,
  tagValues,
  text,
} from './note.js';
import { seen } from './vector-clock.js';

export class Replica {
  constructor(site, note = null) {
    this.site = site;
    this.note = note || createNote(site);
    this.log = [];
  }

  static fromSnapshot(snapshot) {
    return new Replica(snapshot.site, loadNote(snapshot));
  }

  get text() {
    return text(this.note);
  }

  get title() {
    return this.note.title.value;
  }

  get tags() {
    return tagValues(this.note);
  }

  get clock() {
    return { ...this.note.clock };
  }

  insert(index, input) {
    const ops = insertText(this.note, this.site, index, input);
    this.log.push(...ops);
    return ops;
  }

  remove(index, length = 1) {
    const ops = deleteRange(this.note, this.site, index, length);
    this.log.push(...ops);
    return ops;
  }

  tag(value) {
    const ops = addTag(this.note, this.site, value);
    this.log.push(...ops);
    return ops;
  }

  untag(value) {
    const ops = removeTag(this.note, this.site, value);
    this.log.push(...ops);
    return ops;
  }

  rename(value) {
    const ops = setTitle(this.note, this.site, value);
    this.log.push(...ops);
    return ops;
  }

  /** Apply remote operations; out-of-order inserts are buffered by the note. */
  receive(ops) {
    const fresh = ops
      .filter((op) => !seen(this.note.clock, op.site, op.seq))
      .sort((left, right) =>
        left.site === right.site ? left.seq - right.seq : left.site < right.site ? -1 : 1,
      );
    for (const op of fresh) {
      applyOp(this.note, op);
      this.log.push(op);
    }
    return fresh.length;
  }

  /** Bidirectional anti-entropy: each side sends what the other is missing. */
  sync(peer) {
    const outbound = this.log.filter((op) => !seen(peer.note.clock, op.site, op.seq));
    const inbound = peer.log.filter((op) => !seen(this.note.clock, op.site, op.seq));
    const sent = peer.receive(outbound);
    const received = this.receive(inbound);
    return { sent, received };
  }

  snapshot() {
    return snapshotNote(this.note);
  }

  mergeSnapshot(snapshot) {
    this.note = mergeNotes(this.note, loadNote(snapshot));
    return this;
  }

  canonicalState() {
    return canonicalNote(this.note);
  }

  stats() {
    const state = snapshotNote(this.note);
    return {
      site: this.site,
      characters: state.doc.nodes.filter((node) => !node.deleted).length,
      tombstones: state.doc.nodes.filter((node) => node.deleted).length,
      ops: this.log.length,
      bufferedOps: this.note.pending.length,
      clock: this.note.clock,
    };
  }
}
