/**
 * A contract's versions (D695, D857), pure: a new version `replaces` the one before it, so the contracts of a store or a deal make chains.
 * Each contract's number is its place in its chain (the first is 1), and its chain is every version, oldest first. A chain whose first
 * version is not among the rows given starts at the first one given.
 */

export type Versioned = { id: string; replacesId: string | null };

export function contractVersions<T extends Versioned>(all: readonly T[]): Map<string, { number: number; chain: T[] }> {
  const byId = new Map(all.map((c) => [c.id, c]));
  const next = new Map<string, T>();
  for (const c of all) if (c.replacesId && byId.has(c.replacesId)) next.set(c.replacesId, c);
  const out = new Map<string, { number: number; chain: T[] }>();
  for (const c of all) {
    if (c.replacesId && byId.has(c.replacesId)) continue;
    // A first version (or the first one given): walk forward, numbering each.
    const chain: T[] = [];
    const seen = new Set<string>();
    for (let at: T | undefined = c; at && !seen.has(at.id); at = next.get(at.id)) {
      seen.add(at.id);
      chain.push(at);
    }
    chain.forEach((v, i) => out.set(v.id, { number: i + 1, chain }));
  }
  return out;
}
