# convergence-notes

An offline-first note synchronisation engine built from three real CRDTs — no
Yjs, no Automerge, no dependencies. Replicas edit while disconnected, exchange
only the operations the other side is missing, and always end up with exactly
the same document.

```bash
node bin/notes.js          # two replicas, partitioned edits, convergence
node bin/notes.js --fuzz 800
node --test                # 31 tests
```

## Why this is not a toy

**RGA text.** Every character is a node with a unique `(site, counter)` id and a
parent anchor. Siblings are ordered by counter then site descending, a total
order every replica computes identically. Deleting marks a tombstone instead of
removing the node, so later inserts keep a valid anchor and text never "jumps".

**OR-Set tags with retired tags.** Each add carries a unique tag. A remove
retires exactly the tags the remover has observed, and merge recomputes
`(live ∪ live) − (retired ∪ retired)`. A concurrent add survives a remove, while
an already-removed tag can never be resurrected by a stale peer — the classic
OR-Set bug this project explicitly tests against.

**Vector clocks and delta sync.** Each op is stamped with its author and
monotonic sequence. A peer sends only ops the other vector clock has not seen,
so a second sync transfers zero operations. Clocks are compared for causality:
`equal`, `before`, `after` or `concurrent`.

**Out-of-order delivery.** Inserts whose anchor has not arrived yet are buffered
in the note and drained the moment the parent shows up. Tombstones for unseen
characters are remembered, so a delete that overtakes its insert still wins.

**LWW title.** Renames use a Lamport value with a site tie-break, so concurrent
titles resolve deterministically without a coordinator.

Both transports are implemented and tested: operation-log anti-entropy and whole
state snapshots. Merging snapshots is associative, commutative in effect and
idempotent; the tests check byte-identical canonical states.

## Demo

```
--- left, before sync @ laptop ---
text:  "Today Ship the offline editor"
title: "Release notes"
tags:  ["draft","urgent"]
clock: laptop:32
--- right, before sync @ phone ---
text:  "Carefully Ship the editor"
title: "Release notes"
tags:  []
clock: laptop:25 phone:19

--- sync ---
sent 7 ops, received 19 ops

--- left, after sync @ laptop ---
text:  "Today Carefully Ship the editor"
tags:  ["urgent"]
clock: laptop:32 phone:19
```

The right replica deleted "offline " while it had never seen "Today ", and the
left replica tagged `urgent` and untagged `draft` concurrently — both edits
survive, in a deterministic order.

## Fuzzing

`src/fuzz.js` runs a seeded schedule of edits and partial pairwise syncs, then a
full mesh sync twice. Every run is reproducible from its seed.

```
$ node bin/notes.js --fuzz 800
seed 20261106 · 800 steps · 4 replicas · 298 inserts, 131 deletes,
73 tag ops, 68 renames, 168 partial syncs
converged: true
```

The test suite runs 20 additional seeds at 130 steps each and asserts that all
replicas share one canonical state.

## Layout

```
src/vector-clock.js   causal clocks: tick, merge, compare, seen
src/rga.js            character tree, tombstones, snapshots, state merge
src/orset.js          observed-remove set with retired tags
src/note.js           text + tags + LWW title, operations, snapshots
src/replica.js        op log, delta sync, snapshot transport
src/fuzz.js           seeded partition/convergence fuzzing
bin/notes.js          demo and fuzz CLI
test/                 31 tests (node:test)
```

## Limitations

- Tombstones are never garbage-collected, so a long-lived document grows with
  its edit history. A real deployment needs causal-stability-based compaction.
- Plain text only: no rich-text attributes, cursors or presence.
- Synchronisation is transport-agnostic but in-memory; there is no HTTP/WebSocket
  server in this repository.
- Vectors and logs are not persisted to disk.

## License

MIT
