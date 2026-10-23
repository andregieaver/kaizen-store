import "server-only";

import type { DomainRegistrar, RegistrarId } from "./types";
import { vercelRegistrar } from "./vercel";

/**
 * The registrars Kaizena Flow sells domains through (D315, `docs/domains.md` 4.1). Which one sells a TLD is the registrars' own lists, read
 * at most once a day per instance, never a list in code. Today Vercel alone: generic TLDs. Country TLDs (`.no`, `.se`, `.dk`, `.eu`, …) come
 * with the EU registrar of phase 5, which is one more entry here; until then a name under them is simply not offered.
 */

export const REGISTRARS: Record<RegistrarId, () => DomainRegistrar> = {
  vercel: () => vercelRegistrar(),
};

const DAY_MS = 86_400_000;
let tldCache: { at: number; byRegistrar: Map<RegistrarId, Set<string>> } | null = null;

/** Every TLD each registrar sells, from their lists (kept a day). A registrar that cannot be reached sells nothing until it answers. */
export async function supportedTlds(now = Date.now()): Promise<Map<RegistrarId, Set<string>>> {
  if (tldCache && now - tldCache.at < DAY_MS) return tldCache.byRegistrar;
  const byRegistrar = new Map<RegistrarId, Set<string>>();
  for (const id of Object.keys(REGISTRARS) as RegistrarId[]) {
    const list = await REGISTRARS[id]()
      .supportedTlds()
      .catch(() => null);
    if (list) byRegistrar.set(id, new Set(list));
  }
  if (byRegistrar.size > 0) tldCache = { at: now, byRegistrar };
  return byRegistrar;
}

/** The TLD of a name: everything after its first label (`shop` for `nordic.shop`, `co.uk` for `nordic.co.uk`). */
export const tldOf = (domain: string): string => domain.toLowerCase().split(".").slice(1).join(".");

/** The registrar that sells a name, or null when none does (yet). */
export async function registrarFor(domain: string): Promise<DomainRegistrar | null> {
  const tld = tldOf(domain);
  for (const [id, tlds] of await supportedTlds()) if (tlds.has(tld)) return REGISTRARS[id]();
  return null;
}

/** The registrar a registration was made with. */
export const registrarById = (id: string): DomainRegistrar | null => (id in REGISTRARS ? REGISTRARS[id as RegistrarId]() : null);

/** For tests: forget the TLD lists. */
export function forgetSupportedTlds(): void {
  tldCache = null;
}
