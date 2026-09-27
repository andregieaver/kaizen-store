import "server-only";

import { minorUnitDigits } from "@/lib/money";
import { EVAL_CASES, PASS_RATE, scoreCase } from "@/lib/query-eval";
import {
  cleanFilters,
  parseModelJson,
  understandingMessages,
  type SearchFilters,
  type UnderstandingContext,
} from "@/lib/query-understanding";

import { AiError, aiFor, completeText, type AiConnection } from "./ai";
import { cached, cacheKey } from "./search-cache";
import { siteTerms } from "./taxonomy";

/** How long a search waits for its filters before running as typed; answers are cached, so a search waits once. */
const UNDERSTAND_TIMEOUT_MS = 4000;

/**
 * Asks the connection's text model what a search means as filters (D75),
 * checked against the context. Throws `AiError` when the model fails or
 * its answer is not filters.
 */
export async function understandWith(
  connection: AiConnection,
  query: string,
  context: UnderstandingContext,
  timeoutMs = UNDERSTAND_TIMEOUT_MS,
): Promise<SearchFilters> {
  // Room for a reasoning model's thinking, which counts towards the limit; as little of it as the model allows.
  const reply = await completeText(connection, understandingMessages(query, context), {
    maxTokens: 2000,
    timeoutMs,
    temperature: 0,
    reasoningEffort: "low",
  });
  const filters = cleanFilters(parseModelJson(reply.text), query, context);
  if (!filters) throw new AiError("The model did not answer with filters.");
  return filters;
}

/**
 * A search's filters from the store's text model, kept in the search cache,
 * as searches come again. The model, the market and the store's categories
 * and tags are part of the key, so a new model or a changed category asks
 * again; a failure is not kept.
 */
export async function understandQuery(
  storeId: string,
  textModel: string,
  market: { locale: string; currency: string },
  query: string,
): Promise<SearchFilters> {
  const terms = await siteTerms(storeId, "product");
  const context: UnderstandingContext = {
    locale: market.locale,
    currency: market.currency,
    currencyDigits: minorUnitDigits(market.currency),
    categories: terms.filter((term) => term.kind === "category").map(({ slug, name }) => ({ slug, name })),
    tags: terms.filter((term) => term.kind === "tag").map(({ slug, name }) => ({ slug, name })),
  };
  const key = cacheKey(textModel, market.locale, market.currency, JSON.stringify([context.categories, context.tags]), query);
  return cached(storeId, "filters", key, async () => {
    const ai = await aiFor(storeId);
    if (!ai?.textModel || ai.textModel !== textModel) throw new AiError("The store's text model changed.");
    return understandWith(ai, query, context);
  });
}

export type EvalResult = {
  model: string;
  passed: number;
  total: number;
  /** Whether the model passes: at least `PASS_RATE` of the cases. */
  ok: boolean;
  ms: number;
  failures: { query: string; problems: string[] }[];
};

/**
 * Runs the query-understanding eval against a connection's text model:
 * every case in `EVAL_CASES`, a few at a time, each with the time a
 * search would give it.
 */
export async function runUnderstandingEval(connection: AiConnection): Promise<EvalResult> {
  if (!connection.textModel) throw new AiError("No text model is set.");
  const started = Date.now();
  const failures: EvalResult["failures"] = [];
  let passed = 0;
  const queue = [...EVAL_CASES];
  const worker = async () => {
    for (let testCase = queue.shift(); testCase; testCase = queue.shift()) {
      try {
        const filters = await understandWith(connection, testCase.query, testCase.context, 10_000);
        const score = scoreCase(testCase, filters);
        if (score.pass) passed += 1;
        else failures.push({ query: testCase.query, problems: score.problems });
      } catch (error) {
        failures.push({ query: testCase.query, problems: [error instanceof Error ? error.message : String(error)] });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const total = EVAL_CASES.length;
  return { model: connection.textModel, passed, total, ok: passed / total >= PASS_RATE, ms: Date.now() - started, failures };
}
