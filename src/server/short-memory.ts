import "server-only";

/**
 * This instance's short memory of what the proxy and its readers looked up (so a flood of one address is one query), shared by every reader
 * that keeps an answer for a few seconds (bloat review step 2.20): the redirect lookups and a store's facts, the site switch, running A/B
 * tests and held domains. A read in flight is shared too: callers that ask for one key while its load runs wait for that load, so a cold
 * instance asks the database once per key, not once per request. A load that fails is not remembered. Forgetting a key also drops a load
 * in flight, so a read that started before a change is never handed to a caller after it. No other import: the proxy reaches this file.
 */
const memory = new Map<string, { at: number; value: unknown }>();
const loading = new Map<string, Promise<unknown>>();
export const MEMORY_MS = 5_000;
const MEMORY_MAX = 2_000;

/** Remembers an answer for a few seconds, per instance; bounded. A second caller while the load runs gets the same promise. */
export async function remembered<T>(key: string, load: () => Promise<T>, ms: number = MEMORY_MS): Promise<T> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.value as T;
  const pending = loading.get(key);
  if (pending) return pending as Promise<T>;
  // Only the load still in `loading` stores its answer or clears its entry: one forgotten while it ran (a change since) does neither.
  const run: Promise<T> = load()
    .then((value) => {
      if (loading.get(key) === run) {
        if (memory.size >= MEMORY_MAX) memory.clear();
        memory.set(key, { at: Date.now(), value });
      }
      return value;
    })
    .finally(() => {
      if (loading.get(key) === run) loading.delete(key);
    });
  loading.set(key, run);
  return run;
}

/** Forgets one answer this instance remembers, and a load of it in flight. */
export function forgetRemembered(key: string): void {
  memory.delete(key);
  loading.delete(key);
}

/** Forgets every answer whose key matches, remembered or in flight. */
export function forgetWhere(match: (key: string) => boolean): void {
  for (const key of memory.keys()) if (match(key)) memory.delete(key);
  for (const key of loading.keys()) if (match(key)) loading.delete(key);
}
