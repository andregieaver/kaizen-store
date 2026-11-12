# PM-5 ✓ The admin's page lists, pickers and AI tools read and parse the draft and the published copy of every page to show titles

The page builder's model and a built page's render (`README.md` beside this file), part of `docs/audits/bloat-review-2026-11.md`.

- **Kind:** oversize. **Priority:** P1. **Effort:** S. **Confidence:** high. **Step:** 2.17.
- **Second check:** confirmed.
- **Where:** `src/server/pages.ts:135`, `src/server/pages.ts:112`, `src/lib/page-content.ts:4317`, `src/server/pages.ts:382`, `src/app/admin/(gated)/[store]/pages/actions.ts:408`, `src/app/admin/try/[sandbox]/actions.ts:219`, `src/server/owner-tools.ts:979`, `src/server/manager-tools.ts:574`, `src/server/admin-api-content.ts:222`, `src/server/shopify-copy.ts:555`
- **Evidence:** listPages() selects `draft, published` for every page of a type (pages.ts:136-140), runs the full schema on both and compares them with two JSON.stringify calls (samePageContent, page-content.ts:4317) to get a title, a state and a thumbnail. My rg: 16 call sites. Several keep only id and title (pages/actions.ts:408, admin/try/[sandbox]/actions.ts:219), one only slugs (shopify-copy.ts:555); the AI manager's list_pages tool and the Admin API's pages list go through it. Publishing writes draft and published from one string (pages.ts:358, :382-384), so an unchanged published page has equal copies as stored.
- **Cost today:** Per call: two documents a page from the database and about 2 ms a page of parsing and comparing (estimate from 0.9 ms a parse). A 30-page store is about 60 documents and 55 ms; 100 pages about 2 MB and 190 ms, to draw a list or answer one AI tool call. Paid by: An owner's admin; the database; an agent's session (the AI manager's page tools)
- **Saving:** Estimate: a 100-page list falls from about 2 MB and 190 ms to a few KB and a few ms; each AI tool call that lists pages the same.
- **Risk:** Low. The state by jsonb equality must agree with samePageContent(): step 2 keeps the old comparison for the rows that differ, and the new test holds it. A document that no longer parses shows its stored title, where today it shows its address.
- **Already tracked:** no (code review step 1.13, one way to search and page a list, Open, is about paging; this is about what a row reads)

## The fix

1. src/server/pages.ts listPages(): read the list's fields in SQL, no document: id, slug, coalesce(nullif(draft ->> 'title', ''), slug) as title (the fallback readDraft() gives a draft that does not parse), draft -> 'thumbnail' ->> 'url', the two flags from coalesce(published, draft) with the schema's default of true, published is not null as live, (published is not null and draft = published) as same, published_at, updated_at. Describe the row with col and read it through typedRows().
2. Keep the state's meaning exactly: not live is 'draft'; same is 'published'. For the rows that are live and differ as stored, read draft and published for those ids only and decide with stateOf() as today, because two copies can differ as stored and be equal once the schema has filled its defaults.
3. Add pageTitles(owner, type) returning id, slug and title, and use it where no more is wanted: pages/actions.ts:408, admin/try/[sandbox]/actions.ts:219, platform/pages/actions.ts:332, shopify-copy.ts:555.
4. src/server/admin-api-content.ts:222: put the `since` filter in the statement (updated_at > the date) instead of filtering the whole list in code.

**Done when:** rg -n 'select id, slug, draft, published' src/server/pages.ts shows the statement only in getPageForEdit(), and the new case in src/server/pages.int.test.ts passes.

**Tests and rules that hold today's behaviour, and change with it:**

- src/server/pages.int.test.ts: add a case that listPages() gives the same summaries (title, state, flags, thumbnail) as today's parse for the seed's pages and for one page built from a signature theme, a draft that differs, and a draft that does not parse.
- The AI manager's tools read the list: src/lib/agent-eval.test.ts checks tool names only, so no recording changes; the Admin API's content tests (src/server/admin-api*.int.test.ts) hold pages.list's shape.
- Rule: new reads go through typedRows() with col; src/server/ratchet.scan.test.ts falls by one unchecked read (lower the baseline with node scripts/ratchet.mjs).

**Comes after:** PM-4 (the owner's filter in the new statement)

**Notes:** The same read as AD-14 (admin data), which also orders the list view's other reads; do it once. Runs only in the admin and for agents.
