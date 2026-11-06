/**
 * Observed-Remove Set with retired tags.
 *
 * Each add carries a unique tag. A remove retires exactly the tags the remover
 * has observed, and a merge recomputes live tags as
 * (live ∪ live) minus (retired ∪ retired). A concurrent add therefore survives
 * a remove, while an already-observed tag can never come back.
 */

export function createSet() {
  return new Map();
}

function entryFor(set, value) {
  let entry = set.get(value);
  if (!entry) {
    entry = { live: new Set(), retired: new Set() };
    set.set(value, entry);
  }
  return entry;
}

export function addValue(set, value, tag) {
  const entry = entryFor(set, value);
  if (entry.retired.has(tag)) return false;
  if (entry.live.has(tag)) return false;
  entry.live.add(tag);
  return true;
}

/** Retire every tag currently visible for `value`; returns the retired tags. */
export function removeValue(set, value) {
  const entry = set.get(value);
  if (!entry || entry.live.size === 0) return [];
  const retired = [...entry.live];
  for (const tag of retired) entry.retired.add(tag);
  entry.live.clear();
  return retired;
}

export function retireTags(set, value, tags) {
  const entry = entryFor(set, value);
  for (const tag of tags) {
    entry.retired.add(tag);
    entry.live.delete(tag);
  }
}

export function hasValue(set, value) {
  const entry = set.get(value);
  return Boolean(entry && entry.live.size > 0);
}

export function values(set) {
  return [...set.keys()].filter((value) => hasValue(set, value)).sort();
}

export function tagsOf(set, value) {
  const entry = set.get(value);
  return entry ? [...entry.live].sort() : [];
}

export function snapshotSet(set) {
  return [...set.entries()]
    .map(([value, entry]) => [value, [...entry.live].sort(), [...entry.retired].sort()])
    .filter(([, live, retired]) => live.length > 0 || retired.length > 0)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

export function loadSet(snapshot) {
  const set = createSet();
  for (const [value, live, retired] of snapshot || []) {
    set.set(value, { live: new Set(live || []), retired: new Set(retired || []) });
  }
  return set;
}

export function mergeSets(left, right) {
  const merged = loadSet(snapshotSet(left));
  for (const [value, entry] of right.entries()) {
    const target = entryFor(merged, value);
    for (const tag of entry.live) target.live.add(tag);
    for (const tag of entry.retired) target.retired.add(tag);
  }
  for (const entry of merged.values()) {
    for (const tag of entry.retired) entry.live.delete(tag);
  }
  return merged;
}

export function canonicalSet(set) {
  return JSON.stringify(snapshotSet(set));
}
