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

/** How long a search waits for its filters before running as typed. */
const UNDERSTAND_WAIT_MS = 4000;
/** How long the model may take: a late answer is still kept for the next search. */
const UNDERSTAND_TIMEOUT_MS = 20_000;

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
  const { filters } = await askForFilters(connection, query, context, timeoutMs);
  if (!filters) throw new AiError("The model did not answer with filters.");
  return filters;
}

/** The model's reply as it came, and the filters it gives once checked (null if none). */
async function askForFilters(
  connection: AiConnection,
  query: string,
  context: UnderstandingContext,
  timeoutMs: number,
): Promise<{ reply: string; filters: SearchFilters | null }> {
  // Room for a reasoning model's thinking, which counts towards the limit; as little of it as the model allows.
  const reply = await completeText(connection, understandingMessages(query, context), {
    maxTokens: 2000,
    timeoutMs,
    temperature: 0,
    reasoningEffort: "low",
  });
  return { reply: reply.text, filters: cleanFilters(parseModelJson(reply.text), query, context) };
}

/**
 * A search's filters from the store's text model, kept in the search cache,
 * as searches come again. A search waits `UNDERSTAND_WAIT_MS`; a slower answer
 * is still kept, for the next one. The model and the instructions (market,
 * the store's categories and tags, the prompt) are part of the key, so a new
 * model, a changed category or a changed prompt asks again; a failure is not
 * kept.
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
  // The instructions hold the market, the store's terms and the prompt itself, so a change to any asks again.
  const [instructions] = understandingMessages("", context);
  const key = cacheKey(textModel, instructions.content, query);
  return cached(storeId, "filters", key, async () => {
    const ai = await aiFor(storeId);
    if (!ai?.textModel || ai.textModel !== textModel) throw new AiError("The store's text model changed.");
    return understandWith(ai, query, context);
  }, UNDERSTAND_WAIT_MS);
}

export type EvalResult = {
  model: string;
  passed: number;
  total: number;
  /** Whether the model passes: at least `PASS_RATE` of the cases. */
  ok: boolean;
  ms: number;
  /** With the model's own answer, shown as text, to see why. */
  failures: { query: string; problems: string[]; answer?: string }[];
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
        const { reply, filters } = await askForFilters(connection, testCase.query, testCase.context, 10_000);
        const answer = reply.trim().slice(0, 400);
        const score = filters ? scoreCase(testCase, filters) : { pass: false, problems: ["The model did not answer with filters."] };
        if (score.pass) passed += 1;
        else failures.push({ query: testCase.query, problems: score.problems, answer });
      } catch (error) {
        failures.push({ query: testCase.query, problems: [error instanceof Error ? error.message : String(error)] });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const total = EVAL_CASES.length;
  return { model: connection.textModel, passed, total, ok: passed / total >= PASS_RATE, ms: Date.now() - started, failures };
}
