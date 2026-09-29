import "server-only";

import { cache } from "react";

const memo = cache(() => new Map<string, Promise<unknown>>());

/**
 * Runs `load` once for `key` while one request is rendered, and gives the
 * same answer to whoever asks again: the pieces of a working page (D117) each
 * read the cart or the order, and must not each go to the database (or to
 * Stripe). Outside a render nothing is shared.
 */
export function perRequest<T>(key: string, load: () => Promise<T>): Promise<T> {
  const shared = memo();
  const known = shared.get(key) as Promise<T> | undefined;
  if (known) return known;
  const started = load();
  shared.set(key, started);
  return started;
}
