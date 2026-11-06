/**
 * Deterministic convergence fuzzing for partitions, concurrent edits and merges.
 * Every run is reproducible from its seed, so a failing schedule can be replayed.
 */
import { Replica } from './replica.js';
import { loadNote, mergeNotes, snapshotNote } from './note.js';

const WORDS = [
  'offline',
  'merge',
  'anchor',
  'tombstone',
  'replica',
  'vector',
  'causal',
  'sync',
  'conflict',
  'order',
  'clock',
  'note',
];

export function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, list) {
  return list[Math.floor(random() * list.length) % list.length];
}

function edit(random, replica) {
  const length = replica.text.length;
  const roll = random();
  if (roll < 0.5 || length === 0) {
    const index = Math.floor(random() * (length + 1));
    const word = pick(random, WORDS);
    replica.insert(index, random() < 0.5 ? `${word} ` : word);
    return 'insert';
  }
  if (roll < 0.75) {
    const index = Math.floor(random() * length);
    replica.remove(index, 1 + Math.floor(random() * Math.min(3, length - index)));
    return 'delete';
  }
  if (roll < 0.88) {
    const word = pick(random, WORDS);
    if (replica.tags.includes(word) && random() < 0.5) replica.untag(word);
    else replica.tag(word);
    return 'tag';
  }
  replica.rename(`${pick(random, WORDS)} ${replica.title}`);
  return 'title';
}

/**
 * Run a schedule of local edits and partial syncs, then a full mesh sync.
 * Returns the final canonical states so callers can assert convergence.
 */
export function fuzzConvergence(options = {}) {
  const replicaCount = options.replicas ?? 3;
  const steps = options.steps ?? 240;
  const seed = options.seed ?? 7;
  const random = createRandom(seed);
  const replicas = Array.from({ length: replicaCount }, (_, index) => new Replica(`r${index + 1}`));
  const history = { insert: 0, delete: 0, tag: 0, title: 0, syncs: 0 };

  for (let step = 0; step < steps; step += 1) {
    const replica = replicas[Math.floor(random() * replicaCount)];
    if (random() < 0.72) {
      history[edit(random, replica)] += 1;
    } else {
      const other = replicas[Math.floor(random() * replicaCount)];
      if (other !== replica) {
        replica.sync(other);
        history.syncs += 1;
      }
    }
  }

  // Deliver every remaining operation: full mesh, twice, to prove idempotence.
  for (let round = 0; round < 2; round += 1) {
    for (const left of replicas) {
      for (const right of replicas) {
        if (left !== right) left.sync(right);
      }
    }
  }

  const states = replicas.map((replica) => replica.canonicalState());
  const text = replicas[0].text;
  return {
    seed,
    steps,
    replicas: replicaCount,
    history,
    states,
    converged: states.every((state) => state === states[0]),
    title: replicas[0].title,
    tags: replicas[0].tags,
    text,
    clock: replicas[0].clock,
  };
}

/**
 * State-based merge is associative: grouping three snapshots differently must
 * produce byte-identical documents.
 */
export function mergeAssociativityCheck(snapshots) {
  if (snapshots.length !== 3) throw new Error('expected exactly three snapshots');
  const [a, b, c] = snapshots.map((snapshot) => loadNote(snapshot));
  const left = mergeNotes(mergeNotes(a, b), c);
  const right = mergeNotes(a, mergeNotes(b, c));
  return {
    associative: JSON.stringify(snapshotNote(left)) === JSON.stringify(snapshotNote(right)),
  };
}
