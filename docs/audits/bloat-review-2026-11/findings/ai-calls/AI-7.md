# AI-7 ✓ One text model does every job, small ones included

What every AI call carries (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 2.39.
- **Second check:** confirmed.
- **Where:** `src/server/ai.ts:46-48`, `src/server/ai.ts:229-232`, `src/server/ai.ts:529-536`, `src/server/owner-assistant.ts:843-848`, `src/server/assistant-memory.ts:341-358`, `src/server/support-tone.ts:44-50`, `src/server/query-understanding.ts:81-85`, `src/server/recommend.ts:581-590`, `src/server/content-moderation.ts:43-46`
- **Evidence:** A connection has one textModel. The same model runs the AI manager's tool loop, the shopper chat, a memory pass after every manager turn (on by default), search understanding for a shopper's new search, the recommendation rerank, tone rating of each customer message (on by default with support on; 60 tokens of answer), support summaries and the check of 10 listings a dispatcher run. 33 completeText call sites in 25 files take whatever model the platform or the store chose (my rg). seeing() at ai.ts:229-232 already shows the pattern for a second model: a copy of the connection with another model as its text model.
- **Cost today:** Each small job is billed and timed at the price and speed of the model chosen for multi-step work. Not measurable from here without usage by feature and model. The one price seeded is gpt-5-mini at 0.25 dollars a million input tokens, already a small model, so the gap is small until the platform or a store picks a larger one for the manager. Paid by: The server per AI call and the store's AI allowance; a shopper waits for search understanding on a new query.
- **Saving:** Not measured: it is the price gap between the two models times the small jobs' tokens, and with gpt-5-mini as the main model the gap is small. The jobs named are the frequent ones (per message, per new search, per turn).
- **Risk:** A weaker model may read tone or a search's filters worse: the search-understanding eval and the agents' eval exist to check, and tone leaves a message 'not measured' rather than wrong when the answer cannot be read.
- **Already tracked:** Yes: code review step 3.20 'A quick model for small jobs' (FA8), Open.

## The fix

1. src/db/schema.ts, the ai_providers table: `quickModel` (text, null, the same length check as the other model names); `pnpm db:generate`; push the migration on its own first.
2. src/lib/ai-provider.ts: a `quickModel` default in each provider's facts, chosen from that provider's current list when built, and the field in aiProviderInput. src/server/ai.ts: carry it through AiSettings, toSettings(), saveAiSettings() and its audit entry.
3. src/server/ai.ts beside seeing(): `quick(connection)` returns the connection with `textModel` set to its quickModel, else the provider's default, else its own text model.
4. Use it: learnFromTurn() (src/server/owner-assistant.ts:845 passes quick(connection)), src/server/support-tone.ts:44, src/server/support-summary.ts, src/server/recommend.ts:581-590, src/server/query-understanding.ts:81-85, the listing check in src/server/content-moderation.ts (the reading of a notice stays on the main model), src/server/category-suggest.ts and src/server/theme-highlight-words.ts.
5. Give the memory pass its own feature name in AI_FEATURES (src/lib/ai-usage.ts:24-63), so usage shows it apart from the manager's rounds.
6. Settings, AI and Platform, AI: one optional field under Advanced, 'Model for small jobs'; empty means the default, so Homer never chooses. The platform's form gets it in the same change (the parity rule).
7. A price row for each quick model on Platform, AI, Prices before it is used, or its calls show 'No price' and do not count toward a store's allowance.
8. Run the search-understanding eval and the agents' eval (its listing case then runs on the quick model) and commit the recording. Set code review step 3.20 to Done.

**Done when:** select model, count(*) from commerce.ai_usage where feature in ('support_tone', 'support_summary', 'recommendations', the memory pass's new feature) and created_at > the deploy group by 1 shows the quick model on those rows, and code review step 3.20's own check holds (learnFromTurn and the summaries run on the quick model, with a default per provider).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/ai.int.test.ts (settings saved and read), src/lib/ai-provider.test.ts (the defaults name real models of each provider's list).
- src/server/query-understanding.int.test.ts, src/server/recommend.int.test.ts, src/server/support-partner.int.test.ts and src/server/content-moderation.int.test.ts pass their own connections: unchanged unless they assert the model's name.
- src/lib/store-copy-rules.ts:237 never copies ai_providers (the keys are secrets): nothing to add there. pnpm db:check and src/db/commerce.test.ts for the new column.
- docs/rules/admin/ai.md (AI providers, D73: 'Nothing else names a provider or model'); docs/audits/code-review-2026-11.md:122, 277, 490 (step 3.20, FA8).

**Comes after:** A price row for each quick model (Platform, AI, Prices); A new run of the agents' eval on Platform, AI in production after the deploy, and its recording committed as src/data/agent-eval-recording.json (a person with platform access does this; CI only replays it)

**Notes:** P2 because the seeded main model is already a small one. It becomes P1 the day the platform's manager runs on a larger model: do it before that switch, not after.
