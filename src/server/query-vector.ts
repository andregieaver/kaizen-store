import "server-only";

import { AiError, aiFor, embedTexts } from "./ai";
import { cached, cacheKey } from "./search-cache";

/** How long a search waits for its vector before going on by keyword alone. */
const QUERY_TIMEOUT_MS = 2500;

/**
 * A search's vector from the store's search model (D74), kept in the search
 * cache, as the same searches come again. The model's `space` is part of
 * the key, so a changed model never gets an old vector; a failure is not
 * kept.
 */
export async function queryVector(storeId: string, space: string, text: string): Promise<number[]> {
  return cached(storeId, "vector", cacheKey(space, text), async () => {
    const ai = await aiFor(storeId);
    if (!ai || ai.space !== space) throw new AiError("The store's search model changed.");
    const { vectors } = await embedTexts(ai, [text], QUERY_TIMEOUT_MS);
    return vectors[0];
  });
}
