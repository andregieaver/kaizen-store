# AI-9 ✓ A turn does needless work before the first model call

What every AI call carries (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P2. **Effort:** S. **Confidence:** high. **Step:** 2.36.
- **Second check:** corrected.
- **Where:** `src/server/owner-assistant.ts:646`, `src/server/owner-assistant.ts:226-238`, `src/server/owner-assistant.ts:663-683`, `src/server/assistant-memory.ts:85-94`, `src/server/assistant-memory.ts:185-207`
- **Evidence:** To check that a conversation is the person's, runTurn() calls getConversation() (line 646), which selects every message and every approval of it with select * (lines 233-236; a message may hold 20,000 characters), then reads the last 20 again (663-669). memoriesFor() asks the provider for an embedding of the message on every turn, with a 5-second timeout (assistant-memory.ts:85-94, 201), even for a person with no memories or with fewer than the 8 that fit in the prompt. The embedding runs beside the other reads, so it delays the first model call only by what it takes beyond them.
- **Cost today:** One embeddings call and one usage row a turn (a tiny price, but a network round trip the first word can wait for), and the whole conversation read once more on every turn of it. Time not measured. Small beside the model call itself. Paid by: The owner waiting for the answer, and the database; per turn, so it follows use.
- **Saving:** One embeddings call a turn for a person with 8 or fewer memories, and a read that grows with the conversation becomes constant. Latency gain not measured; expect little.
- **Risk:** Low. Ranking is unchanged for a person with more than 8 memories. If the 'used' count is not moved for the memories sent, the daily fading (fadeMemories()) would drop ones still in use: keep that update.
- **Already tracked:** No.

## The fix

1. src/server/owner-assistant.ts:646: replace the getConversation() call with a one-row check, `select 1 from commerce.assistant_conversations where id = ... and <inScope(p)> and account_id = ...`, the same test as lines 229-230, in a small `ownsConversation(p, id)` beside getConversation(); keep the id's format check.
2. src/server/assistant-memory.ts, memoriesFor() (lines 185-207): first count the person's memories in scope. With PER_TURN (8) or fewer, select them all by importance and date, skip the keyword query and vectorFor(), and still count them as used as the function does for the ones it returns. With more, run it as today.

**Done when:** A case in src/server/owner-assistant.int.test.ts counts 0 embeddings requests for a turn of a person with 3 memories (1 today), and the turn's first statement on assistant_messages is the 20-row read.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/owner-assistant.int.test.ts and src/server/ai-manager.int.test.ts: a turn in another person's conversation still starts a new one; a turn of a person with 3 memories gets all 3 and makes no embeddings call (count calls on the fake connection).
- src/server/oauth.int.test.ts (a client's own conversation, D439): still refused outside it.
- docs/rules/admin/ai.md (Memory: 'memoriesFor() each turn'): unchanged in meaning.

**Notes:** Real but minor, as the skeptic said. Worth doing only because AI-1 opens the same lines of runTurn(); fold it into that change. On its own it would be P3.
