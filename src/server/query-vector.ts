import "server-only";

import { cacheLife } from "next/cache";

import { AiError, aiFor, embedTexts } from "./ai";

/** How long a search waits for its vector before going on by keyword alone. */
const QUERY_TIMEOUT_MS = 2500;

/**
 * A search's vector from the store's search model (D74), cached, as the
 * same searches come again. The model's `space` is part of the key, so a
 * changed model never gets an old vector; a failure is not cached.
 */
export async function queryVector(storeId: string, space: string, text: string): Promise<number[]> {
  "use cache";
  cacheLife("days");
  const ai = await aiFor(storeId);
  if (!ai || ai.space !== space) throw new AiError("The store's search model changed.");
  const { vectors } = await embedTexts(ai, [text], QUERY_TIMEOUT_MS);
  return vectors[0];
}
