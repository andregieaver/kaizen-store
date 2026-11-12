# DS-5 ✓ The knowledge job re-cuts pages that have no text every five minutes, and reads every page's content to compare a date

The database's shape (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** eager. **Priority:** P1. **Effort:** M. **Confidence:** high. **Step:** 0.21.
- **Second check:** confirmed.
- **Where:** `src/server/knowledge.ts:167-177`, `src/server/knowledge.ts:179-193`, `src/server/knowledge.ts:196-203`, `src/server/knowledge.ts:233-256`, `src/server/knowledge.ts:296-312`, `supabase/migrations/20261111172839_baseline_1_schema.sql:23688`
- **Evidence:** refreshKnowledge loops over every site with its chat agent on (knowledge.ts:297). For each, syncPageKnowledge selects `published` for every published page and article (:170-176), then compares the page's date with the version kept on its passages. A page whose text yields no passages has no kept version, so it is cut again on every run: replacePassages opens a transaction and deletes by page (:249). Production: 91,200 such deletes for 782 rows ever deleted; the content read ran 24,134 times. The chat agent is off by default (chat_agents.enabled defaults to false), so the cost follows sites that switch it on, but not change.
- **Cost today:** About 1,170 pointless transactions and about 310 whole-content reads a day today, for one or two sites. After opening, every five minutes all published content of each site with the chat on is read, changed or not. Paid by: The database and the server on every cron tick
- **Saving:** Estimate: the 91,200 delete transactions and nearly all 24,134 content reads per 78 days; at scale one slim read per site per tick instead of all its documents.
- **Risk:** Low. What could break: a page whose blog address changed without a new publish keeps an old path until its next publish; the path compare in step 3 covers it because the path is worked out on every tick from the slim read. chat.int.test.ts shows a missed re-cut.

## The fix

1. Add a small table for what was cut, in src/db/schema.ts then pnpm db:generate: commerce.knowledge_sources (store_id uuid null references stores on delete cascade, page_id uuid null unique references pages on delete cascade, entry_id uuid null unique references content_entries on delete cascade, version text not null, path text null, cut_at timestamptz not null default now(), check that exactly one of page_id and entry_id is set), row level security on as every commerce table.
2. src/server/knowledge.ts replacePassages() (:233-256): in the same transaction upsert the source's row with its version and path, also when there are no passages. That alone ends the empty re-cuts.
3. syncPageKnowledge() (:167-177): first a slim read with no document: select p.id, p.type, p.slug, p.published_at, p.published ->> 'blogId' as blog_id, k.version, k.path from commerce.pages p left join commerce.knowledge_sources k on k.page_id = p.id where <owned(storeId)> and p.type in ('page', 'article') and p.published_at is not null. Work out version and path as lines 180-185 do (an article's path needs its blog). Fetch `published` only for the ids whose version or path differ: select id, published from commerce.pages where id = any(…). The same for entries at :196-203 with their type_version.
4. The delete of passages no longer published (:223-229) also deletes their knowledge_sources rows (or relies on the cascades).
5. refreshKnowledge() (:296-312): call aiFor() and embedKnowledge() for a site only when something was cut or a passage lacks a vector (select exists (select 1 from commerce.knowledge_chunks where <owned> and space is null)).
6. One-off fill in a custom migration after it (drizzle-kit generate --custom --name knowledge_sources_fill, then node scripts/prune-snapshots.mjs): insert a row for each page and entry that has passages today, with min(version) and min(path) from knowledge_chunks, so the first tick after the deploy cuts nothing again.
7. Add the table to the registers a store table needs (src/lib/store-export-scope.ts, src/lib/store-copy-rules.ts, src/lib/personal-data.ts with subject none: it holds dates and addresses, no words).

**Done when:** On production a day after the deploy the calls of `delete from commerce.knowledge_chunks where page_id = $1` in pg_stat_statements grow by fewer than 20 a day (about 1,170 a day today).

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/chat.int.test.ts is the test of syncPageKnowledge and refreshKnowledge: add cases that a published page with only pictures is cut once and not again on the next run, that a page published again is cut again, that a changed slug moves the passages' path, and that an unpublished page loses its passages and its source row.
- src/db/commerce.test.ts for the new table's check and cascades; pnpm db:check; src/db/snapshots.scan.test.ts.
- src/server/store-export.scan.test.ts, src/db/privacy.test.ts and the store-copy rules test: a new store table must be decided in each register.
- Rule: docs/rules/storefront.md (the chat agent's knowledge: the five-minute job cuts pages published anew): keep the cadence, name the new table.

**Comes after:** DS-7 (owned() in the new reads)

**Notes:** The same work as DQ-6 in the queries dimension, which rates it P0 and names the same table; do it once. Rated P1 here because the chat agent is off by default, so the cost starts only where an owner turns it on. Steps 1 and 2 alone end the 91,200 transactions. This adds one table: a column on pages would also do, but content_entries has a trigger on every update (content_entries_rules), so a stamp there is not free.
