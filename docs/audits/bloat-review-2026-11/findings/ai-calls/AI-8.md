# AI-8 ✓ Tool schemas say more than the model needs

What every AI call carries (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P2. **Effort:** M. **Confidence:** medium. **Step:** 2.22.
- **Second check:** corrected.
- **Where:** `src/lib/owner-tools.ts:2076-2082`, `src/lib/owner-tools.ts:375-384`, `src/server/owner-assistant.ts:137`, `src/server/owner-assistant.ts:827`, `src/lib/mcp-catalogue.ts:9-15`, `docs/consolidation.md:80-83`
- **Evidence:** update_product is 11,908 characters and create_product 11,305; both are in today's default set and in any round on a products page. Of 154,036 schema characters over all store tools, 25,804 are length, range and pattern bounds that zod checks again on the server (readToolInput(), owner-tools.ts:2085-2088). In today's default set the string bounds are 7,563 characters (the skeptic's measure); in the lean sets of AI-1 I measure 4,006 (Home), 5,562 (orders) and 7,654 (products). Each gated tool gets a 161-character sentence added (owner-tools.ts:2080); 35 gated tools are in today's default set (5,635 characters), 10 in a lean orders or products round (1,610), none on Home. consolidation.md records that the eval passed only once the sentence was on the tool. Tool results are cut blind at 12,000 characters (owner-assistant.ts:827: a slice of the JSON text, so a cut result is broken JSON with no word that it was cut), and every result stays in the messages for all later rounds of the turn. toolDefinition() also feeds the owner MCP's catalogue, whose rule is that the tools' inputs stay as they are (mcp-catalogue.ts:9-15).
- **Cost today:** After AI-1: 4,000 to 7,700 characters of string bounds and up to 1,610 of gate sentences a round, and the two product tools at 23,213 on a products page or in a Dream Factory catalogue turn (30,564 characters of tools, three quarters of it these two; src/lib/dream-factory.ts:332-344). Up to 12,000 characters per earlier tool result on every later round of the turn. Paid by: The server per AI manager call.
- **Saving:** Measured removable after AI-1: 4,006 to 7,654 characters a round of string bounds, and up to 1,610 of gate sentences only if a shorter wording passes the eval. The product split saves up to about 10,000 more on a products page and in each Dream Factory product turn, only where the split-off tools are not sent.
- **Risk:** Without a stated length a model may send over-long text more often and get a validation refusal, which costs a round: watch the count of 'The arguments could not be read' answers in the round log before and after. Splitting tools adds to the count against the cap of 124 and changes a playbook and the Dream Factory's tool list.
- **Already tracked:** No. FA6 (step 3.21) is about where a tool's facts live, not their size.

## The fix

1. src/lib/owner-tools.ts: add `modelDefinition(t)`: toolDefinition(t) with the keys maxLength, minLength, pattern and format removed from its schema at every depth, kept per tool in a WeakMap. Number ranges, enums, required and array limits stay. toolDefinition() itself stays as it is for /api/mcp and its catalogue (src/lib/mcp-catalogue.ts).
2. Use modelDefinition() where the model is sent tools: src/server/owner-assistant.ts:727, 732, 740 and src/server/agent-eval.ts:79, 152 (toolsVersion() must hash what the model is sent).
3. src/server/owner-assistant.ts:827: when JSON.stringify(result) is longer than RESULT_MAX, send `{ cut: true, note: "Longer than fits here: ask for fewer rows or a narrower question.", start: <the first 11,800 characters> }` so the model gets valid JSON and knows. Do not rewrite older results in place: that would break the stable prefix AI-3 relies on.
4. Try a shorter gate sentence in the same eval run (for example 'Calling it only asks the owner; call it when they ask, never ask in words first.') and keep it only if the case manager-asked-refund still passes; otherwise leave today's.
5. Only together with AI-1, as a later change of its own: split update_product so the main tool keeps title, texts, status, categories, tags and prices, and variants, pictures and translations get tools of their own in the products area (src/lib/product-tools.ts, src/server/product-tools.ts, TOOL_WORDS, the permission and feature maps, the add-product playbook, and the Dream Factory's CATALOGUE_TOOLS). Tools split off help only where they are not sent by default.

**Done when:** src/server/ai-round.scan.test.ts (AI-10) finds no "maxLength", "minLength" or "pattern" key in the tools of the default round (5,562 characters of them in a lean orders round today), and the int test of a cut result passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/owner-tools.test.ts and the per-area *-tools.test.ts files that read toolDefinition(): unchanged; add a test that modelDefinition() of every tool has no string bound and still lists every property and required key.
- src/lib/mcp-catalogue.test.ts: the MCP catalogue's inputSchema is unchanged (assert a tool still carries maxLength there).
- The tools' version changes: eval run and recording (share AI-1's). src/server/owner-assistant.int.test.ts: a result over 12,000 characters reaches the model as valid JSON with `cut`.
- docs/consolidation.md:80-83 (why the gate sentence is on the tool): weigh it, keep the sentence unless the eval holds without it.
- For the split: src/lib/product-tools.test.ts, src/server/product-tools.int.test.ts, src/lib/dream-factory.ts:347-362, src/lib/assistant-skills.ts (add-product), docs/rules/admin/ai.md (the AI manager's catalogue tools, D308).

**Comes after:** AI-1 (do steps 1 to 4 in the same change and eval run; the split only after it); A new run of the agents' eval on Platform, AI in production after the deploy, and its recording committed as src/data/agent-eval-recording.json (a person with platform access does this; CI only replays it)

**Notes:** The first four steps are small and ride on AI-1's eval run at no extra cost; alone they would not be worth a recording. The split is the larger gain and the larger change: decide it after AI-1's numbers are in.
