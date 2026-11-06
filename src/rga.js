/**
 * RGA (Replicated Growable Array) text sequence with tombstones.
 *
 * Every character is a node with a unique id, a parent anchor and a sort key.
 * Children of the same anchor are ordered by (counter, site) descending, which
 * gives every replica the same total order without coordination. Deleted
 * characters stay in the tree as tombstones so later inserts keep their anchor.
 */

export class MissingParentError extends Error {
  constructor(parent) {
    super(`unknown parent anchor: ${parent}`);
    this.name = 'MissingParentError';
    this.parent = parent;
  }
}

export function createDoc() {
  return { nodes: new Map(), tombstones: new Set() };
}

export function makeId(site, seq) {
  return `${site}:${seq}`;
}

export function parseId(id) {
  const index = id.lastIndexOf(':');
  return { site: id.slice(0, index), counter: Number(id.slice(index + 1)) };
}

export function nodeCount(doc) {
  return doc.nodes.size;
}

export function insertNode(doc, node) {
  if (doc.nodes.has(node.id)) return false;
  if (node.parent !== null && !doc.nodes.has(node.parent)) {
    throw new MissingParentError(node.parent);
  }
  const stored = {
    id: node.id,
    parent: node.parent,
    ch: node.ch,
    counter: node.counter,
    site: node.site,
    deleted: Boolean(node.deleted) || doc.tombstones.has(node.id),
  };
  doc.nodes.set(stored.id, stored);
  doc.tombstones.delete(stored.id);
  return true;
}

export function deleteNode(doc, id) {
  const node = doc.nodes.get(id);
  if (!node) {
    doc.tombstones.add(id);
    return false;
  }
  if (node.deleted) return false;
  node.deleted = true;
  return true;
}

function compareSiblings(left, right) {
  if (left.counter !== right.counter) return right.counter - left.counter;
  return left.site < right.site ? 1 : left.site > right.site ? -1 : 0;
}

/** Depth-first, newest-child-first traversal; tombstones are kept, not printed. */
export function flatten(doc) {
  const byParent = new Map();
  for (const node of doc.nodes.values()) {
    const siblings = byParent.get(node.parent) || [];
    siblings.push(node);
    byParent.set(node.parent, siblings);
  }
  for (const siblings of byParent.values()) siblings.sort(compareSiblings);

  const out = [];
  const seen = new Set();
  const stack = [...(byParent.get(null) || [])].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    out.push(node);
    const children = byParent.get(node.id);
    if (children) {
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
    }
  }
  if (out.length !== doc.nodes.size) {
    throw new Error('document contains unreachable nodes (corrupt snapshot)');
  }
  return out;
}

export function textOf(doc) {
  let text = '';
  for (const node of flatten(doc)) {
    if (!node.deleted) text += node.ch;
  }
  return text;
}

export function visibleChars(doc) {
  return flatten(doc).filter((node) => !node.deleted);
}

/** Anchor id for a visible insertion index: null means "start of document". */
export function anchorAt(doc, index) {
  const chars = visibleChars(doc);
  if (index < 0 || index > chars.length) {
    throw new RangeError(`insert index ${index} outside 0..${chars.length}`);
  }
  return index === 0 ? null : chars[index - 1].id;
}

export function visibleIdsInRange(doc, index, length) {
  const chars = visibleChars(doc);
  if (index < 0 || length < 0 || index + length > chars.length) {
    throw new RangeError(`delete range ${index}+${length} outside 0..${chars.length}`);
  }
  return chars.slice(index, index + length).map((node) => node.id);
}

export function snapshotDoc(doc) {
  const nodes = [...doc.nodes.values()]
    .map((node) => ({
      id: node.id,
      parent: node.parent,
      ch: node.ch,
      counter: node.counter,
      site: node.site,
      deleted: node.deleted,
    }))
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { nodes, tombstones: [...doc.tombstones].sort() };
}

function insertTopologically(doc, nodes) {
  const pending = [...nodes];
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const node = pending[index];
      if (node.parent !== null && !doc.nodes.has(node.parent)) continue;
      doc.nodes.set(node.id, {
        ...node,
        deleted: Boolean(node.deleted) || doc.tombstones.has(node.id),
      });
      doc.tombstones.delete(node.id);
      pending.splice(index, 1);
      progress = true;
    }
  }
  if (pending.length > 0) throw new MissingParentError(pending[0].parent);
}

export function loadDoc(snapshot) {
  const doc = createDoc();
  for (const id of snapshot.tombstones || []) doc.tombstones.add(id);
  insertTopologically(
    doc,
    (snapshot.nodes || []).map((node) => ({ ...node, deleted: Boolean(node.deleted) })),
  );
  for (const id of doc.tombstones) {
    if (doc.nodes.has(id)) doc.nodes.get(id).deleted = true;
  }
  return doc;
}

/** State-based merge: union of nodes, deletions are additive. */
export function mergeDocs(left, right) {
  const merged = loadDoc(snapshotDoc(left));
  const additions = [];
  for (const node of right.nodes.values()) {
    const existing = merged.nodes.get(node.id);
    if (existing) {
      existing.deleted = existing.deleted || node.deleted;
      continue;
    }
    additions.push({ ...node });
  }
  for (const id of right.tombstones) {
    if (merged.nodes.has(id)) merged.nodes.get(id).deleted = true;
    else merged.tombstones.add(id);
  }
  insertTopologically(merged, additions);
  return merged;
}

export function canonicalDoc(doc) {
  return JSON.stringify(snapshotDoc(doc));
}

export function docSize(doc) {
  let deleted = 0;
  for (const node of doc.nodes.values()) if (node.deleted) deleted += 1;
  return { chars: doc.nodes.size, tombstones: deleted };
}
