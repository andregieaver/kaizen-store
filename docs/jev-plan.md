# Jev (TypeSafe AI) in Kaizen Store: a plan for later

Status: **idea, not started.** Written 8 October 2026. Nothing here is decided; it is a plan to pick up when Jev
leaves early access, and only after the privacy question in section 5 is answered.

## 1. What Jev is (as far as we know)

Jev is TypeSafe AI's first "System One" model (announced 15 September 2026, early access). It does not write text:
it takes structured state plus named questions and returns typed answers in one pass: a choice with a confidence and
probabilities, a score, or a yes/no probability. The API is `POST https://api.typesafe.ai/v1/systemone` with a
bearer key; `GET /v1/models` lists models; the schemas are in TypeSafe's OpenAPI specification.

The figures we have are the vendor's own: roughly $0.042 per million input tokens with output free, and 20–200×
faster and 40–400× cheaper than mid-tier text models on its own four-workflow benchmark, at about the accuracy of
a mid-tier model. We have read only secondary articles (DataCamp, a Medium post), not TypeSafe's documentation.
**Read the official docs, the OpenAPI spec, the DPA and the privacy terms before building anything.** A fixed answer
schema limits the *shape* of an answer, not its correctness.

Where it fits: bounded decisions that today ask a text model and parse its reply. Where it does not: anything that
needs written words (chat replies, product texts, page studio, alt texts, translations, explanations).

## 2. How it would fit Kaizen's rules

Kaizen already has the rules a decision model needs; Jev would be one more kind of connection under them.

- **No provider or model in code (D73).** Jev is not OpenAI-compatible, so it is a new *kind* of model in the AI
  settings, next to the vision, image and live models (D163, D105): a *Decision model* field with its own base
  address, key and model name in `commerce.ai_providers`, on both AI settings pages (Kaizen's and a store's own).
  `TypeSafe`/`jev-latest` appear only as suggestions in `AI_PROVIDERS`, never as a fixed value.
- **One door.** `decide(connection, state, questions)` in `src/server/ai.ts` (or `src/server/ai-decide.ts`), with the
  pure parts in `src/lib/ai-decision.ts`: question builders, answer parsing (zod), and one confidence rule
  (`decisionOr(answer, threshold, fallback)`). A connection without a decision model returns null, and every caller
  then does what it does today. `AiError` is caught and the feature carries on without it, as now.
- **Metered and priced (D106, D145, D146).** Every call goes through `metered()` with the provider's own token
  figures, a feature from `AI_FEATURES`, and a price row in `ai_model_prices` (input per million, output 0). Usage
  reports show it like any other model; a call with no price shows "No price", never as free.
- **Grounded by construction.** Jev may only choose among what Kaizen hands it: the store's own category slugs,
  candidate product ids, tool names, page addresses. Code checks every answer against that list again (as
  `cleanFilters()`, `parseRerank()` and `cleanMotionPlan()` do today). It never states a price, stock level or
  product, and never decides money, VAT, legal texts, withdrawals or anything a person must approve.
- **Low confidence defers.** Below the threshold the caller falls back to today's path (the text model or plain
  code), never guesses.

## 3. Candidate uses, in order

Each is a place where Kaizen already asks a text model for a bounded answer, or would like to but finds it too slow
or costly. Each keeps its present path as the fallback.

| # | Where | The decision | Why it fits | Measured by |
|---|---|---|---|---|
| 1 | **Search query understanding** (D75, `src/server/query-understanding.ts`) | Which of the store's categories and tags a search names, which kind of product, whether it states a price limit (the numbers still parsed in code) | On the shopper's path, latency-bound, answers are choices among the store's own slugs, no personal data needed | The existing eval (`src/lib/query-eval.ts`), run from the AI pages: accuracy, latency, cost against the text model |
| 2 | **AI manager tool selection** (D94, D103, `runTurn()`) | Which groups of `OWNER_TOOLS`/`MANAGER_TOOLS` a message needs, so the turn sends the big model a much shorter tool list | Shorter prompts make every turn faster and cheaper; a wrong pick falls back to the full list | Time to first token and tokens per turn, before and after; a replay of logged turns' tool calls |
| 3 | **Chat agent routing** (D81, `runChat()`) | Product question, knowledge question, navigation, or off the site's subject | Decides which tools to offer and whether a model call is needed at all | Turn latency; off-subject refusals agreeing with today's |
| 4 | **Recommendation re-ranking** (D139, `recommend.ts`) | A score per candidate id instead of a text model's ordered list | The model already only orders ids; scores are Jev's natural answer | `compareArms()` on tabs (D140), never impressions; 100 tabs a side |
| 5 | **Suggestions owners approve** | A category or tag for a product (editor and import), a target for a 404 address among the store's live addresses (D168), a category for an unknown cookie from the scan (D58) | Choices among the store's own lists; a person ticks each one | Share of suggestions accepted |
| 6 | **Extra guards that can only refuse more** | "Is this a personal detail or a secret?" before `readLearned()` keeps a memory; "does this AI copy make a claim?" beside `findClaims()` | A second opinion that may add a refusal, never remove one | Refusals added, checked by hand on a sample |

**Not candidates:** withdrawals and returns (never ask or judge a reason, D153), VAT and tax decisions, prices,
stock, order or payment actions, legal pages, approvals of gated tools (`saysYes()` stays code), fraud blocking,
and anything shown to shoppers as words.

## 4. Pilot

1. Read TypeSafe's docs, OpenAPI spec, DPA and privacy terms; settle section 5.
2. Build the connection kind, `decide()`, metering and pricing (section 2), with a *Check the decision model*
   button like the vision check (D163): a known small choice it must get right.
3. Pilot use 1 (search query understanding) behind a platform switch, off by default, Kaizen's own key only.
4. Run the query eval with the text model and with Jev on the same cases; log latency, accuracy, fallback rate and
   cost per thousand searches. Keep it only if it is faster at the same or better accuracy.
5. If it holds, try use 2 (tool selection), which has the most to gain for owners. Decide uses 3–6 from those numbers.

Note: Jev speeds up decisions only. Slow pages caused by rendering, streaming or navigation need their own profiling.

## 5. Privacy and where data goes (must be settled first)

- Kaizen keeps data processing in the EU when adding a vendor (CLAUDE.md, Stack). TypeSafe's published material
  says its services are hosted in the US. Until there is EU processing or a signed DPA with an adequate transfer basis,
  send Jev **no personal data**: only store catalogue facts (slugs, titles, ids) and a search's words with numbers
  of eight or more digits removed (as `recordablePath()` does), never emails, names, addresses, orders or chat
  histories. That rules out uses 3 and 6 until it is settled.
- Add TypeSafe to the sub-processor list and the privacy texts before the first live call; a store using its own key
  is told what it sends.
- TypeSafe says inputs are not used for training without consent; confirm that in the terms we sign.

## 6. Sources

- [DataCamp: System One models, Jev](https://www.datacamp.com/de/blog/system-one-models-jev)
- [Level Up Coding: Stop using generative LLMs for every decision, meet Jev](https://levelup.gitconnected.com/stop-using-generative-llms-for-every-decision-meet-jev-96f2ec183fc4)
- [Hora de Codar: O que é Jev](https://horadecodar.com.br/?p=45767)
