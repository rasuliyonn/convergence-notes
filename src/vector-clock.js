/**
 * Vector clocks: compact causal history per replica.
 * A clock is a plain object { siteId: counter } and is never mutated in place.
 */

export function emptyClock() {
  return {};
}

export function tick(clock, site) {
  const next = { ...clock };
  next[site] = (next[site] || 0) + 1;
  return next;
}

export function mergeClocks(left, right) {
  const merged = { ...left };
  for (const [site, counter] of Object.entries(right)) {
    merged[site] = Math.max(merged[site] || 0, counter);
  }
  return merged;
}

/** true when every event seen by `a` is also seen by `b`. */
export function covers(b, a) {
  for (const [site, counter] of Object.entries(a)) {
    if ((b[site] || 0) < counter) return false;
  }
  return true;
}

/**
 * Compare two clocks: 'equal' | 'before' | 'after' | 'concurrent'.
 * 'before' means a happened causally before b.
 */
export function compareClocks(a, b) {
  const aBefore = covers(b, a);
  const bBefore = covers(a, b);
  if (aBefore && bBefore) return 'equal';
  if (aBefore) return 'before';
  if (bBefore) return 'after';
  return 'concurrent';
}

export function sumClock(clock) {
  return Object.values(clock).reduce((total, value) => total + value, 0);
}

export function formatClock(clock) {
  return Object.keys(clock)
    .sort()
    .map((site) => `${site}:${clock[site]}`)
    .join(' ');
}

export function seen(clock, author, seq) {
  return (clock[author] || 0) >= seq;
}
