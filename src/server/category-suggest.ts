import "server-only";

import { categoryCandidates, categoryMessages, readCategoryChoice } from "@/lib/category-suggest";
import type { CategoryHit } from "@/lib/product-taxonomy";
import { parseModelJson } from "@/lib/query-understanding";

import { AiError, completeText, type AiConnection } from "./ai";
import { audit } from "./auth";
import { taxonomySearch } from "./product-taxonomy";

/**
 * A suggested standard category for a product (wave 6 unit I, D327): candidates by code from the product's own words in the store's main
 * language, one chosen by the store's text model (feature `product_taxonomy`), never saved here. The audit keeps who asked, which product
 * and what was suggested, never the product's words.
 */

export type CategorySuggestion = { suggestion: CategoryHit | null; candidates: number };

export async function suggestCategory(
  connection: AiConnection,
  who: { accountId: string; storeId: string; productId: string | null; locale: string },
  product: { title: string; description: string },
): Promise<CategorySuggestion> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const candidates = categoryCandidates(await taxonomySearch(who.locale), product);
  // Nothing in the taxonomy is like the product's words: no model call, nothing to suggest.
  if (candidates.length === 0) return { suggestion: null, candidates: 0 };
  const reply = await completeText(connection, categoryMessages(product, candidates), { maxTokens: 1500, timeoutMs: 45_000, reasoningEffort: "low" });
  const suggestion = readCategoryChoice(parseModelJson(reply.text), candidates);
  await audit(who.accountId, who.storeId, "product.category_suggested", {
    productId: who.productId,
    category: suggestion?.id ?? null,
    candidates: candidates.length,
    model: connection.textModel,
    source: connection.source,
  });
  return { suggestion, candidates: candidates.length };
}
