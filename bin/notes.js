#!/usr/bin/env node
/** Demo: two replicas edit the same note offline, then converge. */
import { Replica } from '../src/replica.js';
import { fuzzConvergence } from '../src/fuzz.js';
import { formatClock } from '../src/vector-clock.js';

function block(label, replica) {
  const stats = replica.stats();
  return [
    `--- ${label} @ ${replica.site} ---`,
    `text:  ${JSON.stringify(replica.text)}`,
    `title: ${JSON.stringify(replica.title)}`,
    `tags:  ${JSON.stringify(replica.tags)}`,
    `clock: ${formatClock(replica.clock)}`,
    `nodes: ${stats.characters} visible, ${stats.tombstones} tombstones, ${stats.ops} ops`,
  ].join('\n');
}

function demo() {
  const left = new Replica('laptop');
  const right = new Replica('phone');
  left.insert(0, 'Ship the offline editor');
  left.rename('Release notes');
  left.tag('draft');
  right.sync(left);

  // Partition: both sides keep editing without seeing each other.
  left.insert(0, 'Today ');
  left.tag('urgent');
  right.insert(0, 'Carefully ');
  right.remove(right.text.indexOf('offline '), 'offline '.length);
  right.untag('draft');

  console.log(block('left, before sync', left));
  console.log(block('right, before sync', right));

  const transfer = left.sync(right);
  console.log(
    `\n--- sync ---\nsent ${transfer.sent} ops, received ${transfer.received} ops\n`,
  );
  console.log(block('left, after sync', left));
  console.log(block('right, after sync', right));

  const converged = left.canonicalState() === right.canonicalState();
  console.log(`\nconverged: ${converged}`);
  console.log(`text: ${JSON.stringify(left.text)}`);
  console.log(`title: ${JSON.stringify(left.title)}  tags: ${JSON.stringify(left.tags)}`);
  return converged;
}

function fuzz(steps) {
  const result = fuzzConvergence({ steps, seed: 20261106, replicas: 4 });
  console.log(
    `seed ${result.seed} · ${result.steps} steps · ${result.replicas} replicas · ` +
      `${result.history.insert} inserts, ${result.history.delete} deletes, ` +
      `${result.history.tag} tag ops, ${result.history.title} renames, ${result.history.syncs} partial syncs`,
  );
  console.log(`final text (${result.text.length} chars): ${JSON.stringify(result.text.slice(0, 120))}`);
  console.log(`title: ${JSON.stringify(result.title)}  tags: ${JSON.stringify(result.tags)}`);
  console.log(`clock: ${formatClock(result.clock)}`);
  console.log(`converged: ${result.converged}`);
  return result.converged;
}

const argv = process.argv.slice(2);
const fuzzIndex = argv.indexOf('--fuzz');
const ok = fuzzIndex >= 0 ? fuzz(Number(argv[fuzzIndex + 1]) || 400) : demo();
process.exitCode = ok ? 0 : 1;
