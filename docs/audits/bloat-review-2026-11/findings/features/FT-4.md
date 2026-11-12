# FT-4 ✓ The AI manager sends up to 124 tool definitions a round whatever the store uses; gating tools by feature would not lower that

The product's surface (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 2.21.
- **Second check:** corrected.
- **Where:** `src/lib/tool-budget.ts:15`, `src/lib/tool-budget.ts:67`, `src/server/owner-assistant.ts:716`, `src/server/owner-assistant.ts:733`, `src/server/offered-tools.ts:16`, `src/lib/owner-tool-features.ts:13`, `docs/audits/code-review-2026-11.md:120`, `docs/audits/code-review-2026-11.md:488`
- **Evidence:** OWNER_TOOLS holds 254 tools; 121 have a feature, 101 of them 'shop'; a shop-only store is offered 234 (my re-run of the counting script), beside the manager's own 26. chooseTools() sends everything when it fits and otherwise cuts a round to TOOLS_PER_TURN = 124 (tool-budget.ts:15, 67-96; called at owner-assistant.ts:733 with the manager's tools as 'always'). With more feature gates a shop-only store would still be offered more than the 98 store tools a round has room for, so the round still sends 124. The skeptic measured the descriptions at 101,537 characters, mean 400.
- **Cost today:** Estimate at 4 characters a token: 124 definitions of mean 400 characters are about 12,000 tokens of descriptions a round before their schemas, sent again each round of a turn. Paid whatever features the store uses. Paid by: An agent's session (the owner's AI allowance, the platform's AI bill)
- **Saving:** From feature gating alone: nothing. From step 3.18 (estimate): 124 to about 66 definitions a round, near 5,800 tokens of descriptions a round, plus schemas and what the cache saves.
- **Risk:** A model that lacks a tool must ask for its area first, one more round for the rare question; the eval shows whether it does. A changed prompt or tool list needs a new eval run and recording.
- **Already tracked:** docs/audits/code-review-2026-11.md FA1, step 3.18 'Cheaper, faster AI rounds' (Open) covers the 124, the default set and caching; FA6, step 3.21 (Open) covers the registry.

## The fix

1. Do step 3.18 of the code review ('Cheaper, faster AI rounds', docs/audits/code-review-2026-11.md:488). In src/lib/tool-budget.ts add a default budget of about 40 store tools: the core tools, the tools used earlier in the conversation and the area of the page the person is on; everything else stays one load_tools call away, named by area as today. Keep 124 as the hard cap for a round that asked for areas.
2. src/server/owner-assistant.ts:731-741 (toolsNow): pass the default budget when no area was asked for; keep the order of the definitions stable between rounds (the manager's own first, then store tools by name) so a provider's prompt cache can hold the prefix; set cache markers where the provider takes them (src/server/ai.ts) and record cached input tokens in the usage row.
3. Correct the comment at src/lib/tool-budget.ts:5 (254 and 26, not about 190 and 24).
4. Run the agents' safety eval on Platform, AI after the change, commit the new recording src/data/agent-eval-recording.json and raise the prompts' versions (CLAUDE.md, Conventions).
5. Do not add feature gates to tools for the sake of size. Give a tool its feature in the registry of step 3.21 only where the owner adds a switch (FT-1).

**Done when:** A case in src/lib/tool-budget.test.ts shows chooseTools() over the whole registry with no area asked sends at most 40 store tools; the usage row of a second round shows cached input tokens above 0; a new eval recording is committed and agent-eval-replay.int.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/lib/tool-budget.test.ts (the cut and load_tools), src/server/owner-assistant.int.test.ts, src/lib/agent-eval.test.ts (every tool a case names exists), src/server/agent-eval-replay.int.test.ts (CI replays the recording, so a changed tool list needs a new run).
- Rule: D333, at most TOOLS_PER_TURN a round because providers refuse more than 128; kept. Rule: prompts are versioned (D391, src/server/prompt-versions.ts).

**Notes:** The same work as the AI dimension's finding on 124 definitions per call; count it once there. Kept here only to say that more feature switches are not the way to a smaller round. The skeptic rated the comment fix S; step 3.18 itself is M in the code review.
