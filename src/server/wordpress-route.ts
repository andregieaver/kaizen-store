import "server-only";

import { connection } from "next/server";

import { authenticate, storeFor, type WpCaller } from "./wordpress";
import type { Store } from "./stores";

/** The plugin's answers are never cached or indexed: they are for one site's server, read with its token. */
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
export const problem = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

/** Runs `handle` for a request that carries a live token, else the answer to give. Every route of the plugin's API starts here. */
export async function asPlugin(request: Request, handle: (caller: WpCaller) => Promise<Response>): Promise<Response> {
  await connection();
  const auth = await authenticate(request.headers.get("authorization"));
  if (!auth.ok) {
    return auth.reason === "limited"
      ? problem(429, "rate_limited", "Too many calls from this connection. Try again in a few minutes.")
      : problem(401, "unauthorized", "The connection is not valid. Connect the plugin again.");
  }
  try {
    return await handle(auth.caller);
  } catch (error) {
    console.warn(`[wordpress] ${error instanceof Error ? error.message : String(error)}`);
    return problem(503, "unavailable", "Kaizen could not answer just now.");
  }
}

/** Like `asPlugin`, for a route about one of the account's stores: the store, or a 404 that says nothing of stores that are not theirs. */
export async function asPluginForStore(request: Request, slug: string, handle: (caller: WpCaller, store: Store) => Promise<Response>): Promise<Response> {
  return asPlugin(request, async (caller) => {
    const store = await storeFor(caller.accountId, slug);
    return store ? handle(caller, store) : problem(404, "no_such_store", "No such store.");
  });
}
