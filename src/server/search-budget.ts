import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { SEARCH_AI_MONTHLY_TOKEN_CAP } from "@/lib/search";

import { forgetRemembered, remembered } from "./redirect-live";
import { takeBudget } from "./request-budget";
import { col, typedRow } from "./typed-rows";

/**
 * The search's ceiling on the AI (bloat review step 0.21): a search nobody made before asks the store's model for its meaning
 * (`queryVector()`) and its filters (`understandQuery()`), and a visitor can type as many as they like. Each such call, on a cache miss
 * only, first asks `searchAiRoom()`: within the visitor's and the store's `search_ai` budgets (a minute) and `search_ai_hour` (an hour),
 * and under the store's monthly tokens for search (`SEARCH_AI_MONTHLY_TOKEN_CAP`). Past any of them the call is not made and the search
 * runs by keyword alone: a search is never refused, and a failed count allows (neither budget is in `FAIL_CLOSED`).
 */

const TOKENS_ROW = z.object({ tokens: col.minor });

const tokensKey = (storeId: string) => `search-ai-tokens:${storeId}`;

/** The tokens a store's searches used this month, read at most once a minute per store and instance. */
function searchTokensThisMonth(storeId: string): Promise<number> {
  return remembered(
    tokensKey(storeId),
    async () => {
      const row = await typedRow(
        TOKENS_ROW,
        sql`
          select coalesce(sum(input_tokens + output_tokens), 0)::bigint as tokens from commerce.ai_usage
          where store_id = ${storeId}::uuid and feature = 'search' and created_at >= date_trunc('month', now())
        `,
      );
      return row?.tokens ?? 0;
    },
    60_000,
  );
}

/** For tests: read the store's month of search tokens again on the next ask. */
export function forgetSearchTokens(storeId: string): void {
  forgetRemembered(tokensKey(storeId));
}

/** Whether a search may ask the store's AI once more (`visitor` null counts as one anonymous visitor). */
export async function searchAiRoom(storeId: string, visitor: string | null): Promise<boolean> {
  if ((await searchTokensThisMonth(storeId)) >= SEARCH_AI_MONTHLY_TOKEN_CAP) return false;
  const who = visitor ?? "anon";
  if (!(await takeBudget(storeId, "search_ai", who))) return false;
  return takeBudget(storeId, "search_ai_hour", who);
}
