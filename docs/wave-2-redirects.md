# Wave 2, second run: redirects (automatic and manual, CSV, a 404 report) and SEO fields for categories and tags. Decision D168 proposed

The contract for the second run of wave 2 of `docs/parity-plan.md` ("Redirect manager: automatic redirects when an address changes, manual redirects with CSV import
and export on the data-job pipeline, a 404 report, and SEO fields for categories and tags"). It closes two tracker rows. Code, tests and texts follow this file, and a
disagreement is settled here first. **This file is documentation only: nothing here is built yet.** The model for the shape is `docs/returns.md` (D153) and, for the
pipeline it builds on, `docs/wave-2-data.md` (D165, the first run of wave 2, in `main` at `d522cde`).

This run builds on what exists, and does not start a parallel system: the pages' own redirects (`commerce.page_redirects`, D42, D57, `findPublishedPage()`) stay as they
are and keep serving pages and articles; the job table of D165 (`commerce.data_jobs` and its claim, tick, item, storage and retention code) gets two more kinds; the
category and tag pages (`terms`, D50) get SEO texts; and the sitemap (`storeSitemap()`) gets those pages. What is new is one table of redirects for everything else, a
table of missed addresses, and the code that answers a request which would otherwise be a 404.

Nothing here is legal advice. The run adds **no consumer-facing text** (the admin is English only; the shopper sees only a redirect or the store's existing 404 page). One
privacy question for a person to read is in section 8.

---

## 1. Purpose and scope

### 1.1 Rows this run closes, and what each can honestly reach

| Row | Weight | Bucket | What this run does | Honest rating when the run is done |
|---|---|---|---|---|
| `storefront.url-redirect-manager` | 4 | A | All four criteria: a product, category or tag whose address changes leaves a permanent redirect (pages and articles already do), a manual redirect manager (add, edit, delete, search, scoped to the store), CSV import (a dry run, then a resumable job) and export with per-line findings, and a 404 report with a redirect from each line. | **full**, held by the tests of section 6.1. Caveat for the row's history: the signed-in admin screens are held by view and integration tests, not by an end-to-end test (the repository has no signed-in admin fixture, D158); the serving side is held end to end. |
| `catalogue.seo-fields-title-description-handle-sitemap-hreflang` | 4 | A | Its four criteria: the automatic redirect on a changed address (criterion 1, the same code), the manager and the 404 report (criterion 2, the same code), an SEO title and description for each category and tag in each language (criterion 3), and a sitemap that lists the live addresses with hreflang alternates, now also the category and tag pages, and never an address that redirects (criterion 4). | **full** once the lead accepts the reword of criterion 3 in section 6.4 ("see collections" points at a row that stays open for what is not SEO). Without the reword: **partial** until wave 6, because criterion 3 names a row (`catalogue.collections-manual`) that this run does not close. |

Neither row is bucket B, C or D, neither needs an owner decision from `docs/parity-plan.md` section 5, and no credential stops the work (the database, the storage buckets and
the cron are the existing ones; no new vendor, no new secret). Ratings change only by `history` entries and `pnpm parity:write` at the end of the run, from what the tests hold.
The rows are not edited in this spec.

Two things this run does **not** close, so the ratings above are not read wider than they are: `catalogue.collections-manual` stays **partial** (a category's description, picture
and translated name, and a manual order of its products, are wave 6; only the SEO title and description are built here), and `platform.migration-from-other-platforms` stays
**partial** (its criterion "an import can create redirects from the old product addresses" is a later run of wave 2 that calls the service this run builds, section 7).

### 1.2 What Shopify does (read 2026-10-05 unless stated)

- **URL redirect manager** (<https://help.shopify.com/en/manual/online-store/menus-and-links/url-redirect>, fetched): Content, Menus, View URL redirects, Create URL redirect;
  "Redirect from" the old URL and "Redirect to" the new one; redirects work at once. At most **100,000** redirects (Plus 20,000,000). Cannot be redirected: the reserved prefixes
  `/apps`, `/application`, `/cart`, `/carts`, `/orders`, `/services`, `/shop`, the fixed paths `/products`, `/collections`, `/collections/all`, collection tag-filter URLs, and
  `.html` addresses to the same address without `.html`. "You can redirect only from broken URLs" (a source that still loads a page is refused; a hidden collection's address
  becomes eligible, and making it visible again deletes the redirect). Query strings "might not work as expected". The page does not describe chains or loops, and does not describe
  an automatic prompt when a handle changes.
- **Import and export** (same page, and the search result of the Help Center, 2026-10-05): Content, Menus, URL redirects, Import, a CSV file, review, Import redirects; a sample CSV
  is offered; the column headings are **"Redirect from"** and **"Redirect to"** (read in a search result of the Help Center; the template file itself,
  <https://help.shopify.com/csv/redirects_template.csv>, answers 404, so the headings are not read from the file). A target may be a relative URL (`/collections/shirts`) or a
  full URL, also outside the primary domain. An import **overwrites** a redirect with the same source (the new target replaces the old) and keeps the ones not in the file
  (<https://community.shopify.com/t/will-importing-a-csv-of-redirects-overwrite-my-current-redirects/50571>, a community answer, not Shopify's own text). The Admin API's
  import is two steps, create then submit, after a preview (<https://shopify.dev/docs/api/admin-graphql/latest/mutations/urlRedirectImportCreate>: the page states no limit).
- **A redirect when a handle changes**: a collection's settings page says "Select whether to create a redirect from the old URL to the new URL. This ensures that customers who click
  a link to the old URL are redirected to the new URL instead of landing on a 404" (<https://help.shopify.com/en/manual/products/collections/collection-settings>, fetched). The
  product page says only that the URL handle can be changed and should not be edited too often (<https://help.shopify.com/en/manual/products/add-update-products>, fetched; no
  word on a redirect). Shopify therefore asks for a collection and (by the page read) leaves a product open. Kaizen goes further, on purpose: no question, always a redirect.
- **A 404 report**: no page about one was found on help.shopify.com in this read (a search for it returned only the redirect manager). Shopify's own report is not described here and
  none is claimed; the criterion of the row (a list of the most requested missing paths) is Kaizen's own.
- **Google** (<https://developers.google.com/search/docs/crawling-indexing/301-redirects>, fetched): "The `301` and `308` status codes mean that a page has permanently moved to a new
  location"; use them "when you're sure that the redirect won't be reverted"; a permanent server-side redirect is the recommended way. "By default, Google's crawlers follow up to 10
  redirect hops" (<https://developers.google.com/search/docs/crawling-indexing/http-network-errors>, fetched).

Where Kaizen goes further, on purpose: an automatic redirect without a question for products and categories and tags; a **dry run** of a redirect file that names every line's
problem before anything is written; a report of what shoppers and crawlers asked for that was not there, with a suggested target; an audit entry per change and per job. Where
Kaizen stays behind, on purpose: **no redirect to another website by default** (section 4.3 rule 6), no wildcard or pattern redirect, no temporary redirect, no redirect manager for
Kaizen's own site (section 7).

### 1.3 Sources and what was not read

| Source | Used for | Read |
|---|---|---|
| The Shopify pages above | The Shopify side; the 100,000 figure; the reserved paths; "only from broken URLs"; the column headings; overwrite on import | 2026-10-05 (the template file and a 404 report: not found) |
| Google Search Central, permanent redirects and HTTP and network errors (URLs above) | 308 is a permanent redirect; at most 10 hops followed | 2026-10-05 |
| RFC 9110 section 15.4.9 (<https://www.rfc-editor.org/rfc/rfc9110>) | 308 "indicates that the target resource has been assigned a new permanent URI and any future references to this resource ought to use one of the enclosed URIs"; the server "SHOULD generate a Location header field" | read from the RFC's text, 2026-10-05 |
| RFC 3986 section 6.2.2.1 (<https://www.rfc-editor.org/rfc/rfc3986>) | "The other generic syntax components [than scheme and host] are assumed to be case-sensitive": the reason matching a redirect case-insensitively is a **choice** (section 4.1 rule 3), not what the standard says | read from the RFC's text, 2026-10-05 |
| Next.js 16 docs in `node_modules/next/dist/docs` (`not-found.md`, `connection.md`, `after.md`, `proxy.md`, `dynamic-routes.md`) | A `not-found` render streams with 200 unless it is sent before the first flush; `connection()` makes a render wait for a request; `after()` runs after the response and does not make a route dynamic; the proxy runs in Node; a `[slug]` route and a `[...path]` catch-all can sit side by side and the more specific wins | read 2026-10-05 |
| Existing code | `page_redirects` and its triggers, `findPublishedPage()`, `StorePageView`, `term-listing.tsx`, `p/[handle]/page.tsx`, `taxonomy.ts`, `seo.ts` (`storeSitemap()`), `proxy.ts`, `ab-routing.ts`, the data-job pipeline of D165, `store-translate.ts`, `audit.ts` | read for this spec |

---

## 2. Behaviour

### 2.1 Shopper side

Everything below is a request for a store's page, on `/s/{store}/{market}/…` or on the store's own host (`/{market}/…`). Nothing is set in the browser (no cookie, no storage), nothing
is asked of the shopper, and a redirect is served the same to every visitor.

1. **A changed address.** A product whose handle changed, a category or tag whose address changed: the old address answers **308 (permanent redirect)** to the current one in
   the same market (`/no/p/old-cup` to `/no/p/new-cup`; `/no-en/…` stays `/no-en/…`). A page's or an article's changed address redirects as it does today (D42, D57, `page_redirects`).
   If the thing was renamed several times, **every** old address redirects, each straight to the current address in **one** response (never a chain of responses).
2. **A manual redirect.** A request whose path (after the market) is the source of a manual redirect answers 308 to its target, in the same market. The source does not name a
   market and applies in **every** market and language of the store. The query string of the request is kept (section 4.1 rule 8).
3. **A path with no country.** On a store's own host (and on `/s/{store}/…` before stores have hosts), a path whose first part is **not** a market (`/collections/shoes`,
   `/products/old-cup`, `/pages/about`: the shapes of an old Shopify or other shop) is looked up as a manual redirect source, and, when one is found, goes to its target **in the store's
   main market**. Nothing is redirected for a path that is not a source: it is the 404 it was. This is served by the proxy for those paths only (section 5.3); it never runs for a
   path that has a market, so normal shopping is not slowed.
4. **Only misses are redirected.** A redirect is looked up only when the address would otherwise be a 404. A live page, product, category, tag or article is always served as itself,
   whatever redirects say (a manual redirect whose source later becomes a live address is simply not used; the manager says so, 2.2.5).
5. **Not a live target.** An automatic redirect whose target is not live in the market asked (a product that is a draft, archived, or has no price in that market; a deleted
   category) is **not** followed: the shopper gets the store's 404 page, and the miss is counted (2.3). A manual redirect is followed whatever its target is; staff are warned when they
   save one whose target does not exist (2.2.2).
6. **No redirect for working pages.** `/cart`, `/checkout`, `/order/…`, `/account/…`, `/returns/…`, `/download/…`, `/subscription/…`, `/unsubscribe/…`, `/withdraw`, `/wishlist`,
   `/deliveries`, `/search`, `/cookies`, the admin and the API are never redirected by this feature (section 4.1 rule 5).
7. **A 404 stays a 404.** An address with no redirect gets the store's 404 page (D112) **with the status 404** (the status is held by a test: a not-found render streams as 200 once
   the first flush has gone, so the check is made before anything is sent, section 5.3). Other markets and other stores are never consulted: a lookup carries the store id.
8. **Search engines.** A redirect has no body, no cookie and no `noindex`; the canonical address and the sitemap name only the current address (2.5). Browsers and search engines
   remember a permanent redirect for a long time: the manager says so (2.2.1) and a deleted redirect may keep working in a browser that has seen it.

### 2.2 Staff side: the redirect manager

Page `/admin/{store}/redirects` (store admin, Website section, between Menus and Headers; the key `website:read` to see it, `website:write` to change anything, as every Website page;
a member without the key gets a 404, and every action asks for the key itself, D158).

**2.2.1 The list.** A table of the store's redirects, 50 to a page, newest first, with a search box, a kind filter (*All*, *Manual*, *Automatic: products*, *categories and tags*, *pages
and articles*) and the count against the limit (`12 of 100,000 manual redirects`). Columns: **From** (`/old-cup`), **To** (the target as it is now: for an automatic redirect the
current address of the product or category; for a manual one the stored target), **Kind** (Manual, Product, Category, Tag, Page, Article), **Used** (the number of requests, a lower
bound, and when last), **Created** (and by whom, or *Automatic*), and a **status**: *Active*; *Not used: this address is live* (a manual redirect whose source is now a live address,
2.1.4); *Target not found* (the target is not a live address: a warning, the redirect still works); *Goes through N more redirects* (a chain, followed in one response, 4.1 rule 9). A
sentence above the table: "Redirects are permanent. Browsers and search engines remember them, so change or remove one with care." Search matches the source or the target as a
substring, case-insensitively (a trigram index keeps it fast at 100,000 rows). The page rows for pages and articles are the existing `page_redirects` rows, shown read-only.

**2.2.2 Add and edit** (a form on the page; a row's *Edit*). Two fields, *Redirect from* and *Redirect to*, each a path on the store (`/collections/shoes`), with a line under them: "Shoppers who
open `/collections/shoes` in any country go to `/category/shoes` in the same country." The server checks it (the findings of 4.4, one sentence each, shown under the field) and
refuses: an empty or unreadable path, a path with a country in it, a working page, a source that is a **live address** (`source.live`: "This address is a live page. Redirect only from
an address that does not exist"), a target equal to the source, a loop, a target on another website, and a 101,000th redirect. It **warns** and saves: a target that does not
exist now (`target.not_found`), a target that is itself redirected (saved as the final destination, `target.chain`), a query string in the source (dropped, `source.query_dropped`). A source that
already has a manual redirect is an **edit** (the form says "Replace the redirect from …?" and shows the old target); a source with an *automatic* redirect is replaced by the manual one
(the automatic row is deleted in the same step; the form says so). Saving writes the audit entry `redirect.created` or `redirect.updated` (the two addresses, never anything else).

**2.2.3 Delete.** A row's *Delete* (a confirmation) and, for a selection of rows, *Delete selected* (at most 200 a request). Any kind can be deleted, automatic ones too (the owner may not
want one), with the audit entry `redirect.deleted` (a count and, for one, the two addresses). There is no *Delete all*: a bulk removal is an export, an edit and an import, or the
selection.

**2.2.4 Import** (`/admin/{store}/redirects/import`, then `/redirects/import/{jobId}`; needs `website:write`). The flow of the product import (D165 2.2), with the redirect file:
1. **Upload** a `.csv` (at most 15 MiB, at most 100,000 data rows). The columns are read from the header: `Redirect from` and `Redirect to` (Shopify's headings), case-insensitively, also
   `from`/`to`, `source`/`target`, `old url`/`new url`, `path`/`destination`; extra columns (`type`, `created`, `used`, from our own export) are ignored with an info finding. A
   file with no heading we know is refused with the names accepted. Delimiter (comma, semicolon, tab) and encoding (UTF-8 with or without a byte order mark, UTF-16, else Windows-1252
   with a warning) are found as for products (`parseCsv()`).
2. **Options**: *A redirect from the same address already exists*: **replace its target** (Shopify's behaviour) / keep the old one and skip the line. Nothing else is chosen.
3. **Check** (a dry run, a job): writes nothing. The result is a table of every line's finding (row number, from, to, severity, code, sentence), the counts (**to create**, **to replace**,
   **unchanged**, **skipped**, **with errors**), filterable by severity, with a *Download problems* CSV (`writeCsv()`). The whole file is judged **as one set against what the store has**: a line
   that closes a loop with another line or with an existing redirect is an error on the line that closes it; a chain is collapsed (the stored target is the final destination,
   with a warning naming the hops); the same source twice is an error on the later line (`duplicate.in_file`: the first wins, the order of the file).
4. **Apply** only for a job whose check finished on the same file (the SHA-256 is checked) and the same options; a confirmation says the counts. Lines are written in chunks of 500, each
   chunk in one transaction under the store's lock, **each line checked again against the store's state at write time** (the check is advice: a product may have been renamed and a
   source become live since). A line with an error is skipped and listed; the others go on; nothing outside the file is touched; no redirect is ever deleted by an import.
5. **Resume and cancel** as for products (the cursor is a line index; a line already written is recorded as *unchanged* on the second look). One redirect import is open per store at a time.
6. The audit entries are `redirects.import_started` and `redirects.import_applied` (counts, job id, file name, never an address), one pair per job, not one per redirect.

**2.2.5 Export** (`/admin/{store}/redirects/export`; needs `website:read`). Choices: *Manual redirects* (the default) or *All redirects including the automatic ones*, and the dialect (Standard or
Excel (Nordic), D165 2.7). The file has the two Shopify columns first, `Redirect from`, `Redirect to`, then `type`, `created`, `used`, `last_used`. Up to `DIRECT_EXPORT_MAX_ROWS` (2,000) rows the file
downloads at once; more is a job (`redirect_export`) delivered by a link, never emailed, deleted after 7 days, exactly as the product export. The file is written by `writeCsv()`: a cell that
begins with `=`, `+`, `-`, `@` or a tab is escaped (an address such as `/-old` is a risk the pipeline already handles). **The export of a manual file imports back unchanged**: the check of that file
on the same store is all *unchanged* (held by a test).

**2.2.6 Where else the manager shows.** The product editor, when the handle is changed and saved, says "The old address /p/old-cup now redirects to /p/new-cup" (the reply of the save
carries the pair). The category and tag editor says the same for an address. The page builder already tells a page's owner about its own redirect (D42) and is unchanged.

### 2.3 Staff side: the 404 report

Page `/admin/{store}/redirects/404s` (a tab beside the list; `website:read` to see, `website:write` to redirect or ignore).

1. **What it lists.** The addresses shoppers and crawlers asked for that the store did not have and no redirect covered, for the last **30 days** (a choice of 7, 30 or 90), most requested
   first, at most 500 rows on screen. Columns: **Address** (market-less, as stored), **Requests** (shoppers and crawlers together), **Of which crawlers** (search engines and other robots,
   by a flag only: no user agent text is kept), **Last asked**, **A redirect?** (*Yes* once a redirect now covers it, so a fixed line disappears from the default view), and the actions.
2. **One click.** Each row offers up to three **suggested targets** as buttons (*Redirect to /category/shoes*), found in code from the store's own live addresses (4.5): one press makes the
   manual redirect, shows it, and the row is covered. Without a good suggestion the row offers *Redirect…* (a short form with the target field). Each row also has *Ignore* (hides the address
   from the default view for good; at most 1,000 ignored addresses; *Show ignored* brings them back).
3. **Noise is kept out, and so is anything personal** (4.6): addresses of working pages, addresses that look like a token, an email or an id, files robots probe for (`/wp-login.php`,
   `/.env`), and very long addresses are never recorded. At most 1,000 different addresses are recorded for a store on one day (the report says on how many days it was reached and that
   some addresses were not counted); the counts of an address are not capped.
4. **A CSV** of the report as shown (`writeCsv()`, up to 5,000 rows, a direct download, `website:read`), for whoever fixes the links.
5. Nothing is emailed, there is no alert, and no figure is estimated: a count is a count of requests that reached the server (a request answered from a CDN cache is not counted; the page says
   "at least").

### 2.4 Staff side: SEO fields for categories and tags

In the category and tag editor (`/admin/{store}/products/categories`, `TermsManager`), a **Search results** section for each term with, for **each language the store offers**
(`store.localization.locales`), the same two fields the product editor has (`SearchSnippetFields`: *Title in search results* with the 60-character advice and the 120-character limit,
*Description* with the 160-character advice and the 320-character limit, a preview of how a search result looks). Empty means the page uses the term's name as it does now. Saved by the same action as
the term (`updateTerm()`); a term saved without the field (an older form, an API) keeps what it has. The words are the owner's own: AI writes none here (the store's translation run can **suggest**
other languages from the main one, 2.4.2). Audit: the existing `…category_updated` / `…tag_updated` entry gains `seo: true`, never the text.

**2.4.1 What the shopper's page and search engines get.** On `/category/{slug}` and `/tag/{slug}` in a market whose language has an SEO text: the `<title>` is the SEO title as written (no store name added,
as a product's is), the meta description is the SEO description, and Open Graph and X tags use both. A market whose language has none keeps today's title (`Name · Store`) and the store's description;
**the text of another language is never used** (a Swedish page does not get a Norwegian title). Every term page also gets `hreflang` alternates for the store's market and language views, as a
product page has, and its canonical is its own address.

**2.4.2 The store translation run** (D110, `/admin/{store}/translate`): a new scope **Categories and tags** lists the terms whose main-language SEO text exists and whose other-language text does
not, for the owner to read and tick before anything is written (`applyTranslations()`); never legal; a term with no main-language text is not listed.

### 2.5 The sitemap

`storeSitemap()` gains the **category and tag pages**: one entry for each market and language view of each term that has at least one live product in that market (a category counts its subcategories'
products, as its page does), with `hreflang` alternates between those views and `x-default` as the other entries have, and `lastmod` the later of the term's and its products' last change. It lists
only **current** addresses: an address that redirects (an old handle or slug, a manual source) is in no sitemap, and a page that is a product's old address is not there as a second entry. A hidden
store, and a store that is not open, have no sitemap as now. (Pages with a role, noindex pages and the front page keep the rules they have.)

### 2.6 Platform side, emails, other kinds of order, other markets

- **Platform.** No platform page or table. The platform's admins see a store's redirects only as any support view of a store does (none is built). Kaizen's own site (`store_id` null) keeps its
  `page_redirects` for its pages and articles and gets nothing else (section 7).
- **Emails.** None, except the existing "your file is ready" email of the pipeline for a large redirect export (`data_job.ready`, to the requester, no file, no link that works without sign-in).
  The wording gains the kind's name (`redirect_export`: "Your redirect file").
- **Copied orders, host orders, other currencies.** No order, payment, price or amount is read or written, so none applies and there is **no euro scenario** in `checkout-kinds.int.test.ts`
  (it is stated here because the standing rule asks). A host's products have handles like any product and redirect like them.
- **Other languages and markets.** A redirect is market-relative and language-free: `/no-en/p/old` goes to `/no-en/p/new`. Product handles are not translated (one handle for all languages), so there is one
  redirect for all of them. Term SEO texts are per language (2.4). The admin is English only.
- **Copying a store** (D129 `duplicate_store()`, `clone_store()`): redirects and the report are **not** copied (the copy has new addresses; its history starts empty). The categories' SEO texts **are**
  copied with the categories (they are the store's set-up).
- **Erasure of a person** (D162): nothing here holds a person (4.6), so an erasure needs no step.

### 2.7 Failure behaviour

| Situation | What happens |
|---|---|
| The database cannot be read while looking for a redirect | The request is **a 404 as it would have been** (the lookup is wrapped: it never turns a miss into a 500, and never blocks a live page, which never reaches it). The error is logged. |
| Recording a miss fails or is slow | Nothing the shopper sees changes: it runs after the response (`after()`), is throttled per instance, and is dropped on any error. |
| A redirect loop or a chain longer than 10 hops exists (data that slipped past the checks) | The lookup follows at most 10 hops, remembers what it has seen, and gives up as a **404**, logging the source. It never answers with a loop. |
| An automatic redirect's product or category is gone (deleted) | The row goes with it (a cascade); the address is a 404 and shows in the report. |
| A CSV that is not a redirect file, is empty, has no header, is over the size or the 100,000-row limit, or is not decodable | Refused at the upload with a sentence naming the problem; the stored file is removed. |
| The storage service is down | The job is tried again by the next tick; after `DATA_JOB_MAX_ATTEMPTS` (6) it is failed with "Storage was not available" (the pipeline's behaviour). |
| The store already has 100,000 manual redirects | A new one is refused with the limit named; an import line over the limit is an error (`limit.reached`); delete or import fewer. |
| A member without `website:write` | A 404 for the page, the refusal sentence for an action, never a file or a write. Another store's redirects or jobs are "not found" (every query carries the store id). |
| The activity log cannot be written | A **direct** export is not served; a job's start entry that fails does not start the job (as D165); an add, edit or delete fails with "The activity log could not be written, so nothing was changed" (the change and the entry are one transaction). |

---

## 3. Data

New: two tables, a third for ignored addresses, and two columns. Every table has `store_id`, every query of them carries it, all are additive, all have row-level security on and no policy (the
Data API reaches none of it, as every `commerce` table).

### 3.1 `commerce.redirects`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `store_id` | uuid not null → `stores` | composite unique `(store_id, id)` |
| `kind` | text not null | `manual`, `product`, `category`, `tag` |
| `source` | text not null | the address that redirects: **market-relative**, normalised (4.1): lower case, a leading `/`, no trailing `/`, no query, no fragment, at most 500 characters |
| `target` | text | **manual only**: the address to go to, market-relative and normalised as a target (4.1 rule 6: a path, optionally with `?query` and `#fragment`, at most 2,000 characters); `/` is the market's front page |
| `product_id` | uuid | **product only**: the product whose handle it was |
| `term_id` | uuid | **category and tag only**: the term whose address it was |
| `origin` | text not null | `editor`, `import`, `report` (made from the 404 report), `assistant`, `system` (made by a database trigger) |
| `hits` | bigint not null default 0 | a lower bound (4.7) |
| `last_hit_at` | timestamptz | |
| `created_by` | uuid → `accounts` | null for a system row |
| `created_at`, `updated_at` | timestamptz | |

Constraints and the rules the database itself enforces:

- `unique (store_id, source)`: an address has one redirect.
- Checks: `kind in (…)`; `origin in (…)`; a **manual** row has a `target` and neither `product_id` nor `term_id`; a **product** row has `product_id` only; a **category** or **tag** row has `term_id` only; an
  automatic row has `origin = 'system'`; `source` and `target` have the shape of 4.1 (starts with `/`, no whitespace or control characters, no `//`, no trailing `/` on a source, the lengths above);
  `hits >= 0`.
- **Entity belongs to the store**: `(store_id, product_id)` references `products(store_id, id)` and a term's `store_id` and kind must equal the row's (a trigger, since a term's key is
  `(store_id, content_type, id)`), both `ON DELETE CASCADE` (a deleted product or term takes its redirects).
- **No loops** (`commerce.redirects_no_loop()`, a trigger on a manual row): starting from the new target's path and following manual rows' `source to target` for at most 20 hops, reaching the
  new source raises `redirect.loop` (`check_violation`). A target equal to the source is a loop of one. (Automatic rows cannot close a loop: their source is never a live address and their target is.)
- **Automatic rows are the triggers'**: `kind <> 'manual'` rows are immutable except `hits` and `last_hit_at` (they may be deleted by staff); a manual row's `store_id` and `kind` never change.
- **An address taken replaces an automatic redirect** (as `commerce.pages_keep_addresses()` does for pages): a product taking a handle, or a term taking a slug (insert or update), deletes the
  *automatic* redirect with that source in the store. A **manual** row is left (it becomes *not used* while the address is live, 2.2.1).
- **A changed address leaves a redirect.** `commerce.products_leave_redirect()` (AFTER UPDATE OF `handle` on `products`): when the handle changes and the product was ever live (`OLD.status <> 'draft'` or
  `OLD.first_active_at is not null`), insert `(store, 'product', '/p/' || OLD.handle, product_id)` with `ON CONFLICT (store_id, source) DO UPDATE` to this product (an older automatic row for the same
  address moves to the newest owner). `commerce.terms_leave_redirect()` (AFTER UPDATE OF `slug` on `terms`, for `content_type = 'product'` only): `('category'|'tag', '/category/' || OLD.slug …)`. Nothing is
  written when the handle or slug did not change, or for a product that was never live (nobody has the address).
- **Pages and articles stay in `page_redirects`**, unchanged, with their triggers (`pages_keep_addresses()`), keyed by the page's id so they follow it through any number of renames.

Indexes: `(store_id, kind)`, `(product_id)`, `(term_id)`, `(created_by)` (foreign keys are indexed, the advisor asks), and trigram indexes (`extensions.gin_trgm_ops`) on `source` and `target` for the manager's
search. Created by `drizzle-kit generate` plus a custom migration for the trigram indexes and the triggers (Drizzle cannot express them).

### 3.2 `commerce.not_found_hits`: the 404 report's data, per day

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid not null → `stores` | |
| `day` | date not null | the **UTC** day of the request (the report is a count of requests, not a business day: the analytics rule of the store's day is for money, D152) |
| `path` | text | the market-less, normalised address (4.6); **null** is the one row of a day that counts what was not recorded because the day's cap was reached |
| `hits` | integer not null default 0 | requests |
| `crawler_hits` | integer not null default 0 | of which by robots (a flag taken from the request, never stored as text) |
| `first_seen_at`, `last_seen_at` | timestamptz | |

Primary key `unique (store_id, day, path) nulls not distinct`; checks `hits >= 0`, `crawler_hits between 0 and hits`, `path is null or (length(path) <= 200 and path ~ '^/')`. **One function writes it**,
`commerce.record_not_found(p_store, p_path, p_crawler, p_cap)`: increments the row for `(store, today, path)`; inserts it if the day has fewer than `p_cap` (1,000) distinct addresses; else increments the
null row. (Two requests at once may overshoot the cap by a few; the unique index keeps the rows distinct.) It contains no `DELETE`.

`commerce.not_found_ignored (store_id, path, created_by, created_at)`, primary key `(store_id, path)`: the addresses staff hid, at most 1,000 a store (checked in the service under the store's lock).

### 3.3 Two columns

- `commerce.terms.seo jsonb not null default '{}'`: `{ "nb-NO": { "title": "…", "description": "…" } }`, keyed by the store's locale strings as `product_translations.locale` is; check
  `jsonb_typeof(seo) = 'object'`; the shape, the languages and the lengths are the zod schema's (`termSeoInput`, 5.1), shared with the browser. Wave 6 adds a category's description and picture here or beside it.
- `commerce.products.first_active_at timestamptz`: set by a `BEFORE UPDATE OF status` trigger when a product first becomes `active`, never cleared. **No backfill** (an update of existing products would run
  their publishing and unit-price triggers): a product that is active or archived today is treated as ever live by the rule `OLD.status <> 'draft'`; one that is a draft today and was live before the
  migration leaves no redirect if its handle changes (the limit is named in 2.6's edge list and in the manager's help).

### 3.4 The job pipeline learns two kinds (D165's tables, widened)

- `commerce.data_jobs.kind` check gains `redirect_import` and `redirect_export`; `data_job_items.kind` gains `redirect`. The jobs' format stays `kaizen` (a Shopify redirect file is read as the same layout; no new format).
- `commerce.data_jobs_rules()` (its `v_import := NEW.kind = 'product_import'` becomes "kind in the import kinds"), `data_jobs_export_no_input`, `data_jobs_import_no_files`, and `commerce.start_export_job()`
  (its list of export kinds and its `kind <> 'product_import'` count) are **replaced** by new versions (a new migration, `CREATE OR REPLACE FUNCTION`, drop-and-add of the two checks); behaviour for the four old kinds is unchanged
  (the existing `data-jobs.test.ts` still passes).
- A second one-active-import unique index: `(store_id) where kind = 'redirect_import' and status in ('uploaded','checking','checked','queued','running')`.
- Files use the existing private `imports` and `exports` buckets and the same paths and retention (D165 3.7); no new bucket.

### 3.5 What is private, what is copied, retention

- Everything above is private to the store and to members who pass the guards. Nothing is reachable from the storefront except the **answer** (a redirect) the resolver gives; no table is read by a page's HTML.
- **COPY_RULES** (`src/lib/store-copy-rules.ts`): `redirects`, `not_found_hits`, `not_found_ignored` are all **`never`** (history and addresses of the original). `terms` stays `settings` and now carries `seo`,
  so **`clone_store()` and `duplicate_store()` are patched** to copy `terms.seo` (their `INSERT INTO commerce.terms (…)` column lists gain it: a new migration replaces both functions as a whole, from their latest definition, never an
  edit of an older file). `src/db/commerce.test.ts` fails until the three names are in `COPY_RULES`.
- **PERSONAL_DATA / NOT_PERSONAL** (`src/lib/personal-data.ts`): the three tables are `NOT_PERSONAL` with the reason "addresses of the store's own pages and counts of requests for missing ones; no IP address, user agent,
  cookie or query string is kept, and addresses that could hold a person's data are not recorded (4.6)". `src/db/privacy.test.ts` must pass without a new detector.
- **Retention** (application code, the daily cron, `pruneNotFound()`, batched, never throws): `not_found_hits` rows 90 days after their `day`; `not_found_ignored` and `redirects` are kept until staff delete them (an
  address's history is the point). Import and export files, items and jobs follow D165 3.7 unchanged.

---

## 4. Rules and law

### 4.1 Addresses, normalisation and matching (`src/lib/redirect-path.ts`, pure)

1. **Market-relative.** A source and a target are the part of an address **after the market** (`/p/old-cup`, not `/no/p/old-cup`). A path that begins with one of the store's markets
   (`/no/…`) or with `/s/{store}/…` is refused for a source (`source.market_prefix`); for a target the market is removed with an info note (`target.market_removed`), so a pasted full address works.
   A full URL of the **store's own host** (its `{store}.{domain}`, its custom domains, Kaizen's host with `/s/{store}`) is read as its path; any other host is "external" (rule 6).
2. **Normal form** of a source (and of a target's path): percent-decode once (`%XX`, an invalid sequence is `source.invalid`) except `%2F`, `%3F`, `%23`, `%25` which stay encoded; Unicode NFC; **lower case**; collapse `//`;
   drop a trailing `/`; remove `.` and `..` segments (RFC 3986 5.2.4); at most 12 segments (the length `parseStoreRequest()` accepts), each at most 200 characters, the whole at most 500 (a target 2,000); no control
   characters, spaces or `\`. The query string and fragment are cut from a source (`source.query_dropped`, an info) and kept on a target. The root `/` is not a source (`source.root`); it is a valid target.
3. **Case.** RFC 3986 treats the path as case-sensitive. Matching here is **case-insensitive on purpose**: every Kaizen address is lower case, and an old shop's mixed-case links should still work. The request's path is
   lowered the same way before the lookup. (A choice, flagged for the lead, 9.5.)
4. **Matching is exact** on the normalised path. No wildcard, no prefix, no regular expression (section 7). The market and language of the request are never part of the match.
5. **Reserved.** A source is refused (`source.reserved`) when its first segment is a working page or a route that is not content: `account`, `cart`, `checkout`, `cookies`, `deliveries`, `download`, `order`, `returns`,
   `search`, `subscription`, `unsubscribe`, `withdraw`, `wishlist` (the store's reserved page addresses, `RESERVED_STORE_PAGE_SLUGS`, less the content routes `blog`, `category`, `p`, `products`, `tag`), and `admin`,
   `api`, `auth`, `_next`, `s`, `r`, `demo`, `kaizen`. A path under `/products/…` or `/blog/…` or `/p/…` is **not** reserved (Shopify's `/products/old-cup` is the common source); only an address that is **live** is refused (rule 7).
6. **A target** is a path on the store (a market-relative path, `/`, with optional query and fragment). A target on **another website** is refused (`target.external`): the platform serves stores on a shared
   domain, so an open redirect to any address would let one store send shoppers (and search engines) anywhere from Kaizen's own domain. This is **narrower than Shopify**, which allows full URLs (1.2). The
   decision to allow `https://` targets behind an owner-only switch is left to the lead (9.5, not a blocker). A target with a scheme other than `https`, with credentials, or with a control character is `target.invalid` whatever the host.
7. **Live addresses** (`source.live`, `liveAddressesOf(store)`): a source is refused when it is, now, the address of: an **active** product (`/p/{handle}`), a category or tag (`/category/{slug}`, `/tag/{slug}`), a
   published page (`/{slug}`, the front page and role pages included: their own address), a published article (`/blog/{slug}`), `/blog` when the store has articles, `/products`, or any route of rule 5. A **draft or
   archived** product's address is not live (retiring a product and redirecting it is the common case). The live set is read once per check, per chunk of an apply, and per save.
8. **The query string of the request** is kept: if the target has no `?`, the request's query is appended; if it has one, the request's parameters whose names the target does not have are appended; the target's fragment
   is kept. A redirect never adds a parameter of its own. A request to a redirect with a POST body is not redirected (a miss on a POST is a 404 as before; only GET and HEAD are looked up).
9. **Chains and loops.** (a) A new or changed manual redirect whose target is already the source of other redirects is **stored with the final destination** (followed up to 10 hops over manual rows and, for an
   automatic row, to the entity's current address), with the warning `target.chain`; (b) a target that leads back to the new source is a **loop** and is refused, in the service, in the plan of an import and by the
   database trigger (3.1); (c) a chain that forms later (a redirect is added for an address that others point to) is **followed at serve time** in one response, at most 10 hops (Google follows up to 10), a loop or the
   eleventh hop is a 404 (2.7), and the list flags the redirects that go through more (`Goes through N more redirects`). Automatic redirects never chain by construction: they point at the **thing**, not at an address
   (a product renamed three times has three rows, each resolving to its current handle).
10. **Status.** Always **308** (`permanentRedirect()`; RFC 9110 15.4.9; Google treats 308 as it does 301). Shopify serves 301. Temporary redirects (302, 307) are not offered (section 7).
11. **Limits** (`src/lib/data-limits.ts`): `REDIRECTS_MAX` 100,000 **manual** redirects a store (Shopify's figure; automatic ones are made by triggers and are not refused, a rename must never fail), `REDIRECT_IMPORT_MAX_ROWS`
    100,000, the file at most `IMPORT_MAX_BYTES` (15 MiB), `REDIRECT_BULK_DELETE_MAX` 200, `REDIRECT_PAGE_SIZE` 50, `REDIRECT_HOPS_MAX` 10, `REDIRECT_EXPORT_DIRECT_MAX` is `DIRECT_EXPORT_MAX_ROWS`.

### 4.2 Who may do what

Read the list, the report and the export: `website:read`. Add, edit, delete, import, ignore an address, make a redirect from the report: `website:write`. A custom role may hold either (they are the Website area's keys,
D158; `permissions.scan.test.ts` and its baseline gain the new pages and actions). The job kinds' keys: `redirect_import` `website:write`, `redirect_export` `website:read` (`JOB_KEY`). The categories' SEO fields are saved
under the Products key that the category editor already asks for (`products:write`, the page `products:read`). The AI manager's tools: 4.8.

### 4.3 What a redirect may never do

It never redirects a live address; never a working page or the admin; never to another website; never changes a price, a cart or an order; never sets or reads a cookie or storage; never reveals another store's
address (the lookup is by store id and the host); never loops. Test: `redirect-writers.test.ts` (5.2) and the resolver's integration test (6.1).

### 4.4 Findings of the check (stable codes; the tests assert them; sentences are staff-facing English)

New codes in `src/lib/data-job.ts`'s table `FINDINGS` (so `FIX_FOR` in `data-job-help.ts`, typed over every code, fails to compile until each says what to do):

| Code | Severity | Meaning |
|---|---|---|
| `file.not_redirects` | error (file) | no heading we know (names the accepted ones) |
| `source.missing` | error | the *from* cell is empty |
| `source.invalid` | error | unreadable, a control character, too long or too many parts |
| `source.external` | error | the *from* is a full address on another website (only this store's paths can be redirected) |
| `source.market_prefix` | error | the *from* begins with a country; leave it out, a redirect applies in every country |
| `source.reserved` | error | a working page or route (4.1 rule 5) |
| `source.live` | error | the address is a live page, product, category, tag or article now |
| `source.root` | error | the front page cannot be redirected |
| `source.query_dropped` | info | the query string was removed from the *from* |
| `target.missing` | error | the *to* cell is empty |
| `target.invalid` | error | unreadable, a scheme other than https, credentials |
| `target.external` | error | the *to* is on another website (4.1 rule 6) |
| `target.market_removed` | info | the country was removed from the *to* |
| `target.self` | error | the *to* is the *from* |
| `target.loop` | error | the line closes a loop (names up to five of the addresses) |
| `target.chain` | warning | the *to* is itself redirected; the final destination is stored (names the hops) |
| `target.not_found` | warning | the *to* is not a live address now |
| `duplicate.in_file` | error | the same *from* earlier in the file (the first line wins) |
| `exists.update` | info | a manual redirect from this address exists; its target is replaced (option *replace*) |
| `exists.same` | info | the redirect is already there as it is (outcome *unchanged*) |
| `exists.skipped` | info | a redirect from this address exists and the option is *skip* |
| `exists.replaced_automatic` | info | an automatic redirect from this address is replaced by this one |
| `limit.reached` | error | the store would hold more than 100,000 manual redirects |

Item outcomes reuse D165's (`created`, `updated`, `unchanged`, `skipped`, `failed`, `checked`). A sentence may name an address and a column and **never quotes any other cell**.

### 4.5 Suggestions for the 404 report (`suggestTargets()`, pure, no model)

Given a missing path and the store's live addresses (products' handles and titles, terms' slugs and names, pages' and articles' slugs and titles): the last segment's words are compared with each candidate's
handle words and title words (lower case, hyphens as spaces, accents folded); a candidate with the **same last segment** ranks first, then the largest share of shared words, then the shorter edit distance; at least
50 % of the words shared and at least one whole word, else no suggestion; at most three; products and categories before pages. Shopify-shaped prefixes help the type: `/products/x` prefers a product `x`,
`/collections/x` a category `x`, `/pages/x` a page `x`, `/blogs/…/x` an article `x`. The model is never asked.

### 4.6 What the 404 report records, and what it never does (`src/lib/not-found.ts`, pure)

Only `normalisePath()`'s output is recorded, and only if `recordablePath()` accepts it. It is **refused** when: the path is under a working page (4.1 rule 5) or `/api`, `/admin`; it has more than 8 segments or is
longer than 200 characters; a segment is 24 or more hexadecimal characters, a UUID, 8 or more digits (also with spaces, dots, hyphens or a plus sign between them, except a plain date) or longer than 100 characters; every test is made on the path and on what decoding it up to four times gives; the path contains `@`; it contains an encoded control character; it is a probe (`/wp-`, `/.`, `/cgi-bin`,
`/phpmyadmin`, `/xmlrpc`, `/vendor/`, `/node_modules/`, `.env`, `.git`, `.sql`, `.bak`, `.zip`, `.php` as the last segment unless the store's own source says otherwise: the list is `PROBES`, tested). The query string,
fragment, headers, IP address, user agent text, cookies and referrer are **never** read into the record: the crawler flag is a boolean from the user agent (`userAgent(request).isBot` of `next/server`), and that is all.
Counts are per store, per day, per address. Throttling, in memory per instance, keeps a flood of one address to one write a second.

### 4.7 Hits

`hits` on a redirect and the 404 report's counts are **lower bounds**: a request answered from a CDN or browser cache is not seen, and a write that is throttled or dropped is not counted. The pages say "at least".
No figure here is estimated or filled in.

### 4.8 The AI manager (D94)

Two owner tools, `redirect_overview` (read, `website:read`: counts by kind, the top missing addresses of the last 30 days with their suggestions, repeated from code) and `add_redirect` (gate **`public`**, because it changes the
live site; `website:write`; arguments `from` and `to`, checked by the same function as the form; kept for approval with `approvalSummary()` "Redirect /old to /new in every country"; run on the owner's yes). The AI never names an
address it was not given by a tool, never makes a number, and has no tool that deletes, imports or edits. Served by the store's MCP server like every owner tool. A playbook `fix-broken-links` in
`ASSISTANT_SKILLS`. `list_data_jobs` (D165) lists the two new kinds.

---

## 5. Where things live

Areas (the agents of the run): **foundation** (schema, migrations, database rules, pure libraries, the registries' data), **server** (`src/server`, the routes' non-visual code, the cron, the proxy), **shopper** (what a visitor's
request meets: the store routes), **admin** (the pages and components of the manager, the report and the editors), **analytics-and-ai** (the owner tools, the skill, the plan-comparison rows). Areas share no file except through
the registries of 5.6.

### 5.1 Foundation

- Migrations (`pnpm db:generate`, then custom ones with `pnpm exec drizzle-kit generate --custom --name …`; `pnpm db:check`): `*_redirects.sql` (generated: the two tables and the ignored table, the two columns, the widened
  checks and the new unique index, the indexes); `*_redirects_rules.sql` (custom: the triggers and functions of 3.1 and 3.2, the trigram indexes, row-level security on, the replaced `data_jobs_rules()` and
  `start_export_job()`); `*_redirects_audit.sql` (custom: `commerce.audit_area_of()` replaced as a whole with the new prefixes, as `20261004174410_gdpr_audit.sql` did); `*_redirects_copy.sql` (custom: `clone_store()`
  and `duplicate_store()` replaced from their latest definitions with `terms.seo` copied); `*_redirects_plan_features.sql` (the two plan rows, described only). `src/db/schema.ts` gets the tables and columns.
- Pure libraries (`src/lib`): `redirect-path.ts` (4.1: `normalisePath()`, `normaliseSource()`, `normaliseTarget()`, `splitMarket()`, `isReservedPath()`, the constants), `redirects.ts` (kinds, the types, `validateRedirect()`,
  `followChain()`, `closesLoop()`, `redirectSentences`), `redirect-plan.ts` (`planRedirectImport(file, existing, live, options)`: the pure dry run, one finding list per line, the same function the apply runs on a chunk), `redirect-csv.ts` (header aliases,
  `readRedirectFile()`, `redirectRows()` for the export, the layout), `legacy-path.ts` (`parseLegacyRequest(pathname, hostStore)` and the matcher's source, 5.3), `not-found.ts` (4.6, 4.5: `recordablePath()`, `suggestTargets()`,
  the constants), `term-seo.ts` (`TermSeo`, `termSeoInput`, `termSeoFor(term, locale)` the fallback rule of 2.4.1, `termMetaTitle()`), `data-job.ts` (the two kinds in `JOB_KINDS`, `isImport()` over the import kinds, the codes of 4.4),
  `data-limits.ts` (4.1 rule 11 and `NOT_FOUND_*`), `data-job-help.ts` (`FIX_FOR` for the new codes), `store-translate.ts` (the `terms` scope: `termUnit()`), `taxonomy.ts` (`Term.seo`, `termInput.seo`), `audit.ts` (the prefixes `redirect.`,
  `redirects.`, `not_found.` all **website**).
- Registries' data owned by foundation: `src/lib/store-nav.ts` (Website group: `item("/redirects", "Redirects", "Redirects for addresses that changed and a report of the addresses shoppers could not find.")`, after Menus),
  `src/lib/admin-map.ts` (pages `redirects`, `redirects.import`, `redirects.import.job`, `redirects.export`, `redirects.404s` with `tasks` and `keywords`: `301`, `404`, `broken link`, `moved page`, `omdiriger`, `redirect`),
  `src/lib/store-copy-rules.ts`, `src/lib/personal-data.ts`, `src/lib/data-limits.ts`, `src/lib/permission-guards.ts` and `permissions.baseline.json` (the new guards), `src/lib/cookie-consent.ts` (**no entry: nothing is set**, a test says so).

### 5.2 Server (`src/server`, routes, cron)

- `redirects.ts`: `listRedirects()` (search, kind, page), `createRedirect()`, `updateRedirect()`, `deleteRedirects()` (all `(member, input)`, validating through `validateRedirect()` with the live set, one transaction with the audit entry, the store's advisory lock for the
  count), `redirectCounts()`, `addRedirects()` (the batch door the migration importers of a later run will call, same checks). **Only this module and the triggers write `commerce.redirects`** (`redirect-writers.test.ts` scans `src/` for another writer, and for
  `commerce.not_found_hits`).
- `redirect-live.ts`: `liveOf(storeId, paths)` (4.1 rule 7: **which of the given paths are live**, one statement, never the whole catalogue: an import of 100,000 lines in chunks of 500 reads what each chunk names), `indexFor(storeId, seeds)` and `indexWithOverlay()` (the redirects a check may chain or loop through, read by a bounded recursive query from the paths a check names; the dry run lays what earlier chunks planned over it), `addressContextOf(store)`, `manualCountOf()`, and `refreshRedirects(storeId)` (every writer calls it after its commit: it refreshes `redirectsTag(store)` and this instance's short memory). **Changed in the server step:** the first draft read every live address once per check, which does not scale to 100,000 lines or a store with 100,000 products.
- `redirect-resolve.ts`: `resolveMiss(store, path, query)`: the lookup of 2.1 and 4.1 rule 9 (a bounded recursive query, one round trip, store id and source in the predicate, an entity redirect's target found live in the market asked), returning
  `{ to, redirectId } | null`; `missOrRedirect(shop, path, query = "")` is the one function a route calls (below; `query` is the request's `search` where a route has it, a prerendered page has none: only the proxy and dynamic routes carry it); `countHit()` (in `redirects.ts`, the only counter write, in the cached lookup's fill, throttled to one a second per redirect and instance). For an address with no country: `legacyAnswer(pathname, search, hostStore)` (the proxy's: a `{ location }` for a manual redirect, a `{ miss }` for the caller to count, null for a path that has a market) and `legacyRedirectFor(storeSlug, rest, search)` (the unknown-market route's own lookup of `legacyPathOf()`), both **manual redirects only**: an automatic redirect is an address inside a market.
- `not-found.ts` (server): `recordNotFound()` (calls `commerce.record_not_found()`, throttled per instance, wrapped, never throws), `notFoundReport(store, days)`, `ignoreAddress()`, `redirectFromReport()` (a `createRedirect()` with `origin: 'report'`), `pruneNotFound()` (the daily cron
  gains it next to `pruneDataJobs()` in `src/app/api/cron/subscription-reminders/route.ts`, behind the existing authorisation).
- `redirect-import.ts` / `redirect-export.ts`: the product import's shape, for redirects: `startRedirectUpload()`, `registerRedirectImport()`, `checkRedirectImport()`, `applyRedirectImport()`, `runRedirectCheck()`, `runRedirectApply()`, `redirectExportReader()`
  (an `ExportReader`), `requestRedirectExport()`. `src/server/data-jobs.ts` gets the dispatch (`runJob()` by kind, `readerFor()`, `JOB_KEY`, `AUDIT_MADE`, `AUDIT_DOWNLOADED`, `AREA`), `data-job-store.ts` the kind lists, `data-routes.ts` the `redirects` page, `data-job-emails.ts` the kind's words,
  `data-job-tools.ts` the two kinds.
- `taxonomy.ts` (server): `updateTerm()`/`createTerm()` carry `seo` (validated against the store's locales, empty removes a language, an omitted `seo` keeps), `siteTerms()` returns it, `termsTag` refreshed as now.
- `seo.ts`: `listIndexedTerms(storeId)` (cached under the catalogue tags: a term, its markets and last change) and `storeSitemap()` using it (2.5).
- `store-translate.ts` (server): `termWork()`, the scope in `translationWorklist()`, `translationCoverage()` and `applyTranslations()` (a unit `term:{id}`).
- `redirect-tools.ts` and the entries in `src/server/owner-tools.ts` (`HANDLERS`) belong to analytics-and-ai (5.5).
- Cache: the lookup of a miss is `'use cache'` with `redirectsTag(store)` (and the catalogue tag the automatic redirects follow), `cacheLife({ stale: 300, revalidate: 1, expire: 3600 })` (section 10): every writer of `commerce.redirects` (`redirects.ts`, the import's apply, the assistant's tool, `redirectFromReport()`) refreshes `redirectsTag(store)` through `refreshTag()`/`updateTag()`.

### 5.3 Shopper (the store routes and the proxy)

- **One door for a miss**, `missOrRedirect(shop, path, searchParams)` (server, called from the routes): asks a **cached** lookup (`'use cache'`, tags `redirectsTag(store)` and the store's catalogue tag, `cacheLife({ stale: 300, revalidate: 1, expire: 3600 })`: never a `stale` under 30 seconds or an `expire` under 300, which make the call dynamic and the response a streamed 200) and either `permanentRedirect(marketPath(store.slug, market.slug, to))` or `notFound()`. **Changed after the spike of section 10:** the first draft awaited `connection()` first so a miss was never cached; the spike showed that a dynamic miss is sent as a streamed shell with status **200** (`x-nextjs-postponed`), so a 308 or a 404 cannot be given. The cached lookup gives the real status, and a redirect added after a first 404 takes effect on the next request because every writer refreshes `redirectsTag(store)` (`updateTag()` in the manager's actions, `refreshTag()` in jobs and the assistant; product and category saves already refresh the catalogue tag the automatic redirects follow). A miss is **recorded inside the cached lookup's fill**, which runs at most once per `revalidate` window per address and instance: `after()` does not run for a prerender-able render, and the fill is the throttle the report wants. The robots' flag is not known there (`headers()` is not allowed in a cache), so `crawler_hits` is counted only for the requests the proxy sees (market-less addresses); the report says so instead of showing a zero.
- Routes that call it where they now call `notFound()` for a missing thing: `src/app/s/[store]/[market]/[slug]/store-page-view.tsx` (`StorePageView`), `p/[handle]/page.tsx`, `term-listing.tsx` (`TermProducts`), `blog/[slug]/page.tsx`. A **new catch-all**
  `src/app/s/[store]/[market]/[...rest]/page.tsx` (named `rest`, as the drawer slot's is: two catch-alls with other names are an ambiguous route and the build refuses them; `generateStaticParams()` returns `[{ rest: ["_"] }]` and `_` is a plain 404, as the neighbours' placeholder; calls `missOrRedirect()` at once) takes every address no route matches (`/no/collections/shoes`, `/no/products/old-cup`, `/no/pages/about`). It does not match a working page's own route; a
  path under a working prefix reaches it only as a 404 and is not recorded. (A `[slug]` route and a `[...path]` catch-all can coexist, Next's dynamic-routes docs; the spike of the first step proves it in this app, including the `@drawer/[...rest]` slot, before anything is built on it.)
- `src/proxy.ts` gains a second matcher entry and a branch: for a path **without a market** (4.1; `parseLegacyRequest()`), on a store's host or under `/s/{store}/`, it asks `resolveMiss()` and answers `NextResponse.redirect(…, 308)` to the **main market's** address, or passes the request on and
  records the miss with `after()`. The matcher excludes: paths with a market first segment (`[a-z]{2}(-[a-z0-9]{2,8}){0,2}`), `/`, `/s/{store}` alone, `_next/`, `api/`, `admin/`, `demo/`, `kaizen/` and paths ending in a static-file extension (`ico png jpg jpeg gif webp avif svg css js map txt xml json woff woff2 ttf pdf csv zip mp4 webm`). Its literal is written out
  (a matcher cannot use a constant) and a test (`legacy-path.test.ts`) keeps it in step with `parseLegacyRequest()` as the existing test does for `kaizen_ab`. The proxy keeps its A/B branch unchanged. **Fallback if the spike shows the matcher cannot be kept off real traffic:** the proxy branch is
  left out, 2.1.3 is listed as not done (section 7), and nothing else in this spec changes; the rating of the rows does not depend on it.
- Term pages' metadata (`termMetadata()` in `term-listing.tsx`): the SEO title and description of 2.4.1, the `languages` alternates, Open Graph through `storeShareTags()`.
- `KNOWN_COOKIES`: no change.

### 5.4 Admin (pages, components, actions)

- Pages under `src/app/admin/(gated)/[store]/redirects/`: `page.tsx` (list, add form), `actions.ts`, `import/page.tsx`, `import/[jobId]/page.tsx` (+ its tick route, `tickResponse()`), `import/actions.ts`, `export/page.tsx`, `export/file/route.ts`
  (POST, same site, `exportResponse()`), `404s/page.tsx`, `404s/actions.ts` (ignore, redirect, restore), `404s/export/route.ts`. Each page asks `requirePermission(slug, "website:read")` (then a 404 for an action it may not take),
  each action `website:write` (`permissions.scan.test.ts`).
- Components under `src/components/admin/redirects/`: the table, the form, the finding table (reusing `src/components/admin/data/`'s findings table and job tracker), the report table with suggestions, and `redirect-views.test.ts` (`renderToString`).
- `src/components/admin/terms.tsx` (`TermsManager`) gets the *Search results* section (reusing `SearchSnippetFields` from `src/components/admin/seo-fields.tsx`), with a per-language tab as the product editor has; the term actions in
  `src/app/admin/(gated)/[store]/products/actions.ts` (or the file that holds `updateTerm`'s action) pass `seo`.
- The product editor's save reply carries `{ handleChanged: { from, to } | null }` and the editor shows 2.2.6; the sentence lives in `src/lib/redirect-admin.ts` (pure, with the manager's other sentences and `describeRedirect()`).
- The page-level words (`redirect-admin.ts`) are English only and are in no catalogue.

### 5.5 Analytics and AI

- `src/lib/redirect-tools.ts` (the two tools' zod schemas and descriptions, `TOOL_WORDS` lines, `approvalSummary()` text, `preflightRedirectTool()`), `src/server/redirect-tools.ts` (handlers, read through `redirectCounts()` and `notFoundReport()`, write through `createRedirect()` only),
  the entries in `OWNER_TOOLS` (`src/lib/owner-tools.ts`), `TOOL_PERMISSIONS` (`src/lib/owner-tool-permissions.ts`: `website:read`, `website:write`), `HANDLERS` (`src/server/owner-tools.ts`), the playbook `fix-broken-links` (`src/lib/assistant-skills.ts`), and `list_data_jobs`
  (`src/server/data-job-tools.ts`) listing the new kinds.
- Plan comparison (D132): two rows in the existing category *Storefront and catalogue*, described only and in no plan until the platform's admin ticks one: **Redirects and 404 report** ("Redirects are made when a product, category or tag changes address, and added by hand or imported from a CSV file; a report of the addresses shoppers and search engines could not find, with a one-click redirect; up to 100,000 manual redirects.") and
  **SEO title and description for categories and tags** ("Search-result title and description for every category and tag in every language of the store.").
- **No analytics table.** The 404 report is not an analytics page; its data and CSV are the Website section's (`ANALYTICS_TABLES` is unchanged, and `analytics-export-views.test.ts` must still pass).

### 5.6 What the areas may and may not touch

| File or registry | Owner | Others |
|---|---|---|
| `src/db/schema.ts`, `supabase/migrations/*`, `src/db/*.test.ts` | foundation | read only |
| `src/lib/redirect*.ts`, `legacy-path.ts`, `not-found.ts`, `term-seo.ts`, `data-job.ts`, `data-limits.ts`, `data-job-help.ts`, `taxonomy.ts`, `store-translate.ts`, `audit.ts` | foundation | read only |
| `src/lib/store-nav.ts`, `admin-map.ts`, `store-copy-rules.ts`, `personal-data.ts`, `permission-guards.ts`, `permissions.baseline.json` | foundation (one edit each, at the start) | server, admin and analytics-and-ai ask in their hand-over, they do not edit |
| `src/server/redirects.ts`, `redirect-live.ts`, `redirect-resolve.ts`, `redirect-import.ts`, `redirect-export.ts`, `not-found.ts`, `taxonomy.ts` (server), `seo.ts`, `store-translate.ts` (server), `data-jobs.ts`, `data-job-store.ts`, `data-routes.ts`, `data-job-emails.ts`, `src/proxy.ts`, the cron route | server | read only |
| `src/app/s/[store]/[market]/…` (the five routes and the catch-all), `term-listing.tsx` metadata | shopper | |
| `src/app/admin/(gated)/[store]/redirects/**`, `src/components/admin/redirects/**`, `terms.tsx`, the product editor and the actions of the term and product pages | admin | |
| `src/lib/redirect-tools.ts`, `src/server/redirect-tools.ts`, `owner-tools.ts`, `owner-tool-permissions.ts`, `assistant-skills.ts`, `data-job-tools.ts`, the plan-feature migration | analytics-and-ai | |

The run's order: **foundation** (with the spike of 5.3 first), then **server**, then **shopper**, **admin** and **analytics-and-ai** in parallel.

---

## 6. Acceptance criteria, row by row

Test kinds: **unit** (Vitest, pure), **PGlite** (`src/db/*.test.ts`, every migration applied), **int** (`src/server/*.int.test.ts`, a real database after `scripts/db-setup.mjs --seed`), **e2e** (Playwright against `pnpm start`; the
serving tests seed rows with SQL through `e2e/db.ts` as `e2e/pages.spec.ts` does, because the repository has no signed-in admin fixture). Every criterion below is **held by a test that fails if the behaviour breaks**.

### 6.1 `storefront.url-redirect-manager`

| # | Criterion (the row's, unchanged) | Held by |
|---|---|---|
| R1 | Changing the address of a product, category, tag or article leaves a permanent redirect from the old one, as pages do now, and a later page taking that address replaces it. | **PGlite** `redirects.test.ts`: a rename of an active product, of an archived one, of a category and of a tag each leave the right row (`/p/old`, `/category/old`, `/tag/old`) pointing at the thing; a draft that never was live leaves none; two renames leave two rows that both resolve to the current handle; a swap of two handles ends consistent; a product or term **taking** an address deletes the automatic redirect from it and leaves a manual one; a deleted product takes its rows; articles and pages: the existing `commerce.test.ts` cases stay green. **int** `redirect-resolve.int.test.ts`: the old address of a renamed product, category, tag, page and article answers one redirect to the current address in the same market (`no`, `no-en`, `se`); a product renamed three times: each old address goes straight to the current one; a product that is a draft/archived/unpriced in the market is a miss. **e2e** `redirects.spec.ts`: `GET /s/demo/no/p/{old}` is **308** with `Location` the new address after a rename by SQL, and a first request for an unknown address (404) followed by the insertion of a redirect gives 308 on the next request (not a cached 404); the same for a category and a tag; status 404 for a missing address is held. |
| R2 | An owner adds, edits, deletes and searches manual redirects from a path to a path or address, scoped to the store. | **unit** `redirect-path.test.ts`, `redirects.test.ts`: the normal form (case, percent-encoding, trailing slash, dot segments, market prefix, query cut), every refusal of 4.1 (reserved, root, market, external, scheme), a table of source/target pairs with the finding each gives. **PGlite**: unique per store, the shape checks, the loop trigger (A to B to A, a longer cycle, self), manual versus automatic rows' immutability, the entity-store consistency. **int** `redirects.int.test.ts`: create, edit (replaces), delete, delete selected (limit 200), search by source and by target, filter by kind, paging; a live source (`/p/{active}`, a category, a page, an article, the working routes) is refused, a draft's address accepted; a target that is another redirect's source is stored as the final destination; the 100,001st manual redirect is refused (the limit read from the constant, a smaller test limit injected); every action refuses a member without `website:write`, a member of another store and a visitor; every change is audit-logged (`redirect.created|updated|deleted`) with the two addresses and nothing else, and the change and the entry are one transaction; **no code but `redirects.ts` writes the table** (`redirect-writers.test.ts`). **view** `redirect-views.test.ts`: the list, its statuses, the form's findings. |
| R3 | CSV import and export with validation: loops, chains, duplicates and external hosts are reported per line; an import is a resumable job. | **unit** `redirect-csv.test.ts`: Shopify's two headings, the aliases, a file with extra columns, semicolons and a byte order mark and Windows-1252, a file with no known heading refused, a formula-looking address escaped on export, the round trip (rows to file to rows is the same). `redirect-plan.test.ts`: per-line findings for every code of 4.4 in one file (a loop across two lines, a chain, a duplicate, an external host, a market prefix, a live source, a reserved path, an over-limit store), **properties**: applying a plan then planning the same file again gives all *unchanged*; the stored result has no loop and no self-redirect; order of lines changes only which duplicate wins. **int** `redirect-import.int.test.ts`: upload, register, check (writes no redirect), apply (writes the planned ones, in chunks, each line re-checked: a source that became live between check and apply is skipped and listed), **resume** after a stop mid-file (budget injected, `DataDeps`) gives the same end state and no double write, cancel, a second import refused while one is open, a changed file refused (SHA-256), the audit pair, a member without `website:write` refused; **export** a manual file imports back with every line *unchanged*; a direct export under 2,000 rows and a job over it (limit injected); the file is formula-safe; the job-ready email names the kind and holds no file. **PGlite** `data-jobs.test.ts` stays green and gains the two kinds, the second unique index and `start_export_job()` for `redirect_export`. |
| R4 | A 404 report lists the most requested missing paths, each with a one-click redirect. | **unit** `not-found.test.ts`: `recordablePath()` refuses every class of 4.6 (working pages, tokens, UUIDs, emails, long, probes) and accepts a legacy shop's paths (`/collections/shoes`, `/pages/om-oss.html`); `suggestTargets()` (same last segment first, share of words, the prefix hints, nothing below the threshold, at most three, deterministic). **PGlite**: `record_not_found()` increments, is per store and per day, stops adding addresses at the cap and counts the rest in the null row, never records another store's. **int** `not-found.int.test.ts`: a missing address asked three times by a shopper and twice by a robot reports 5 and 2; an address covered by a redirect after the fact shows *A redirect: yes*; ignore and restore; the window (7, 30, 90) and the order; the report of one store never shows another's; **one click**: `redirectFromReport()` makes the manual redirect with `origin: 'report'` and the address then answers 308; `pruneNotFound()` removes rows past 90 days and never throws; a request with a query string, an email-looking path and a token path leave **no** row. **e2e**: missing `/s/demo/no/zzz-{run}` asked twice raises the count to 2 (the dynamic miss, not a cached one); `/s/demo/no/cart/zzz`, a token-looking path and `/wp-login.php` are not recorded; a market-less missing path on the proxy branch is recorded once per request; the 404 status holds. **view**: the report table, the suggestion buttons, the "at least" wording. |

Additional behaviour held (not a row criterion, named so it is not lost): **market-less addresses** (2.1.3): **unit** `legacy-path.test.ts` (what is and is not market-less; the matcher string agrees with the function over a table of 60 paths, as `ab-routing` does); **e2e**: `GET /s/demo/collections/{x}` with a manual redirect `/collections/{x}` → `/category/{y}` answers 308 to the main market's `/s/demo/no/category/{y}`, and without one it is the 404 it was; a path with a market is never seen by the proxy branch; the A/B proxy test (`ab-routing.test.ts`, `e2e/ab-*.spec.ts`) stays green.

### 6.2 Cross-cutting tests (hold both rows)

| Test | Holds |
|---|---|
| `redirect-writers.test.ts` (unit, scans `src/`) | only `redirects.ts` and the triggers write `commerce.redirects`; only `not-found.ts` calls `record_not_found()`; no redirect or report module calls `fetch`, `safeFetch` or sets a cookie; every `notFound()` of the five store routes is reached through `missOrRedirect()`; the proxy imports no module that is not on the proxy's allowed list |
| `permissions.scan.test.ts` and baseline | every new page and action asks `website:read` or `website:write`; the actions take the store slug as bound first argument |
| `admin-map` test, `store-nav` test | the five pages are in `ADMIN_PAGES` and exactly one nav group |
| `src/db/commerce.test.ts` | the three tables are in `COPY_RULES`; `clone_store()` and `duplicate_store()` copy `terms.seo` and no redirect |
| `src/db/privacy.test.ts` | the three tables are `NOT_PERSONAL` and no detector fires |
| `src/lib/audit.test.ts` | the new prefixes are in the TypeScript table and in `commerce.audit_area_of()` (the existing parity test), and every `audit(` call names an area |
| `src/lib/data-job-help.test.ts` | `FIX_FOR` covers every new code (a compile error otherwise) |
| `e2e/csp.spec.ts`, `src/lib/pay-routes.graph.test.ts` | unchanged and green: the redirect code is not imported by a pay route (`/cart`, `/checkout`, `/order`) |

### 6.3 `catalogue.seo-fields-title-description-handle-sitemap-hreflang`

| # | Criterion (the row's, unchanged except where 6.4 says) | Held by |
|---|---|---|
| S1 | Changing a product, category, tag or page address creates a permanent redirect from the old one automatically, collapsing chains and refusing loops (integration test). | R1's tests for products, categories, tags, pages and articles; **chains**: a manual redirect whose target is another redirect's source is stored with the final destination (`redirects.int.test.ts`), a chain formed later is followed in one response (`redirect-resolve.int.test.ts`), the eleventh hop and a cycle in the data are a 404; **loops**: refused by the service, the plan and the trigger (R2, R3). Pages' redirects are keyed by the page's id and cannot chain: held by the existing `commerce.test.ts` cases, which are extended with a page renamed twice and an article renamed twice (**PGlite**). |
| S2 | Owners add, edit, import and export redirects, and see a 404 report of what shoppers and crawlers asked for (integration test). | R2, R3, R4. |
| S3 | Categories and tags carry their own SEO title and description per language. | **unit** `term-seo.test.ts`: the shape, the limits (120 and 320), a language the store does not offer is refused, empty removes a language, an omitted `seo` keeps, the fallback rule (the language's text, else the name; never another language's). **int** `term-seo.int.test.ts`: saved through `updateTerm()` and read back by `siteTerms()` per locale; a term saved without `seo` keeps it; a store's term cannot be saved with another store's locale list; the audit entry has `seo: true` and no text; `termMetaTitle()` gives the absolute title or `Name · Store`. **int** `store-translate.int.test.ts`: the `terms` scope lists a term with a main-language text and no other-language text, `applyTranslations()` writes only the ticked ones, a term with no main text is not listed. **e2e** `terms.spec.ts` (extended, seeded by SQL): `/s/demo/se/category/hjem` has the Swedish `<title>` as written (no store name), the description, `og:title`, `hreflang` alternates and its canonical; the Norwegian market of the same term without text shows `Hjem · Demo`; no Swedish text on the Norwegian page. **PGlite**: `terms.seo` is copied by `clone_store()`/`duplicate_store()`. **view**: the editor's section. |
| S4 | The sitemap lists only live addresses with hreflang alternates and never a redirected one (existing sitemap tests extended). | **int** `seo.int.test.ts` (extended): a category with a live product in two markets is listed in both with `hreflang` alternates, `x-default`, and `lastmod`; a category with no live product is not listed; after a product and a category rename the sitemap has the new addresses and **none of the old** (and no manual redirect source); a hidden store has no sitemap; entries of pages, articles and products are as before. **e2e** `smoke.spec.ts` (extended): `/s/demo/store-sitemap.xml` lists `/category/hjem` with `hreflang="da-DK"` and no redirected address after a rename by SQL. |

### 6.4 Criteria changes (for the lead; the rows are not edited here)

1. **`catalogue.seo-fields…` criterion 3** reads "Categories and tags carry their own SEO title and description per language (see collections)". Proposed text: *"Categories and tags carry their own SEO title and description per language, used in their page's title, description, Open Graph tags, hreflang alternates and the sitemap (integration test, e2e)."* The words "(see collections)" make the row depend on `catalogue.collections-manual`, which also lists the SEO text in its first criterion together with a description and a picture. Proposed: reword the SEO row as above (closed by this run) and **narrow the collections row's criterion 1** to "A category or tag has its own description and picture, kept per language, shown on its page (e2e)", so the SEO texts are counted once (README rule 8's spirit). Without the change the SEO row stays partial until wave 6.
2. **`catalogue.seo-fields…` criterion 1** says "…collapsing chains and refusing loops". Automatic redirects cannot chain or loop (they point at the thing, not at an address); the criterion is meaningful for **manual** redirects. Proposed: *"…; manual redirects collapse chains and refuse loops (integration test)."* No weakening: the test of 6.3 S1 asserts both.
3. **`storefront.url-redirect-manager` gap text** says "No redirect when a product, category, tag **or article** address changes". Articles already redirect (D57: `page_redirects.type`, `commerce.test.ts` "gives articles addresses of their own… and redirects"). Proposed gap: product, category and tag only. Criterion 1 stays as written.
4. **`storefront.url-redirect-manager` criterion 3**, "external hosts are reported per line": reported here as an **error** (a line whose target is another website is refused), for the open-redirect reason of 4.1 rule 6, where Shopify allows them. If the lead wants Shopify's behaviour, the owner-only switch of 9.5 turns the error into a warning; the criterion as written is met either way (a finding per line).
5. **`storefront.url-redirect-manager` criterion 4**, "the most requested missing paths, each with a one-click redirect": defined as the last 30 days by default (7, 30, 90), requests by shoppers and robots together with the robots' share, and **one click when the code finds a suggested target, a short form otherwise** (4.5). No row in the report is without a way to redirect it.
6. **`catalogue.seo-fields…` evidence**: add `src/lib/redirects.ts`, `src/server/redirects.ts`, `src/server/redirect-resolve.ts`, `src/lib/term-seo.ts`, `e2e/redirects.spec.ts`, `src/server/redirects.int.test.ts` at the re-rating step; the row's `history` records `partial` to `full` with the reason "D168".

---

## 7. What is deliberately not done, and why

| Not done | Why | Taken by |
|---|---|---|
| A redirect to **another website** | an open redirect on a shared domain (4.1 rule 6); Shopify allows it | the lead's decision in 9.5; an owner-only switch in a later run |
| Wildcard, prefix or pattern redirects (`/collections/*`), and Shopify's address shapes as a set (`/products/{handle}` to `/p/{handle}`) | exact matching is simple to test and cannot redirect a live page by accident; Shopify has no wildcards either | the migration importers of wave 2 (`platform.migration-from-other-platforms`: "an import can create redirects from the old product addresses") call `addRedirects()` with the exact addresses it computes |
| Temporary redirects (302 and 307) | the row asks for permanent redirects; a temporary one is a different promise to search engines | not planned |
| A redirect manager for **Kaizen's own site** (`store_id` null), SEO fields for Kaizen's own categories and tags | the platform's pages already redirect (`page_redirects`); no row asks for it | wave 9 (platform) if wanted |
| A redirect when a category or tag is **deleted** (to its parent) or a page is **deleted** | needs a rule about where to; the 404 report finds them and offers a one-click redirect | not planned |
| Redirects per market or per language | the row is about addresses; the market is part of how an address is served, not of its name | not planned |
| A category's **description, picture, translated name**, a manual order of its products, a `noindex` switch for terms, `CollectionPage` JSON-LD, terms in `llms.txt` | `catalogue.collections-manual` (what a collection is), not SEO titles | wave 6 |
| Alerts or an email about a rise in 404s; a 404 chart; Search Console import | no row asks; the report is the first step | wave 8 (analytics) |
| An AI that suggests redirects | suggestions are code and must be repeatable; a model would also see the store's addresses for no gain | not planned |
| Chains stored collapsed **retroactively** (rewriting other rows when a source is added) | serve time follows up to 10 hops in one response; rewriting rows would change data the owner exported | not planned |
| A per-plan limit on redirects | the plan rows describe, they enable nothing (D132) | the platform's admin, by hand |
| Recording redirects in `docs/analytics.md` | a redirect is not a figure | none |

---

## 8. Needs human legal review

This run adds **no consumer-facing legal text** and no text a shopper reads. Two points for a person to read, neither a blocker:

1. **The 404 report keeps the addresses of requests** (4.6): no IP address, user agent text, cookie, referrer or query string, nothing that identifies a visitor, addresses that look like they hold a person's data are never recorded, 90 days.
   Whether that makes the store's privacy policy (the starters of D158, `legalStarter()`) need a line ("we count the addresses of pages that were not found, without anything that identifies you") is for a person to judge; this run does
   **not** change a legal starter (its `REQUIRED_TOPICS` and `LEGAL_REVIEW_MANIFEST` are untouched). If it is judged to need one, it is a hand-written line in nb, sv, da and en flagged for review, not machine drafted.
2. **Redirects and consumer law** are not an issue in themselves; a store that redirects a retired product to a different one is making a commercial choice the owner owns (the page says nothing about it). No statement on price, availability or comparison is made by a redirect.

Technical sources, not law: RFC 9110 (308), RFC 3986, Google Search Central, Shopify's help pages (1.3).

---

## 9. For the lead

### 9.1 Blockers

**None.** The rows are bucket A; no decision of `docs/parity-plan.md` section 5 and no credential stops the work. Two things to know before starting, neither a decision:

- This run changes files the first run of wave 2 also owns (`data-job.ts`, `data-jobs.ts`, `data-job-store.ts`, `data-routes.ts`, the `data_jobs` checks and trigger). The plan's rule 8 (one wave edits the shared registries at a time) means **start it after run 1 is pushed** (`d522cde` is on `main`; task 146 of this session's list says its verify and ship was still in progress), or rebase on it.
- `catalogue.collections-manual` and `platform.migration-from-other-platforms` are touched only as named in 1.1; neither is re-rated by this run.

### 9.2 Migrations expected (all additive; widening a check is a drop and add of a constraint, which is safe while the old code runs because it uses none of the new values)

1. `*_redirects.sql` (generated): `commerce.redirects`, `commerce.not_found_hits`, `commerce.not_found_ignored`, `terms.seo`, `products.first_active_at`, the widened `data_jobs` and `data_job_items` checks, the second one-active-import index.
2. `*_redirects_rules.sql` (custom): row-level security on the three tables; `commerce.redirects_no_loop()`, `commerce.redirects_guard()` (immutability, entity and store), `commerce.products_leave_redirect()`, `commerce.terms_leave_redirect()`, `commerce.products_first_active()`, the "address taken" triggers on `products` and `terms`, `commerce.record_not_found()`, trigram indexes (`extensions.gin_trgm_ops`, schema-qualified as the search indexes are), the replaced `commerce.data_jobs_rules()`, `commerce.data_job_move_allowed()` unchanged, the replaced `commerce.start_export_job()`.
3. `*_redirects_audit.sql` (custom): `commerce.audit_area_of()` replaced as a whole.
4. `*_redirects_copy.sql` (custom): `clone_store()` and `duplicate_store()` replaced from their latest definitions (find them with `grep -l 'FUNCTION commerce.clone_store' supabase/migrations/*.sql | tail -1`, and likewise `duplicate_store`) with `terms.seo` copied.
5. `*_redirects_plan_features.sql`: the two rows of 5.5, positions after the category's last (read it first), `WHERE NOT EXISTS` as the data run's.

**Statements with `DELETE` or `DROP` inside functions or migrations:** `commerce.products_taken_address()` and `commerce.terms_taken_address()` (the "address taken" triggers) contain `DELETE FROM commerce.redirects`, as `commerce.pages_keep_addresses()` already does for `page_redirects`; the check migrations contain `ALTER TABLE … DROP CONSTRAINT` (a drop and add of the widened checks). `docs/ci-migrations.md`: CI's migrate job uses a direct Postgres connection, so these run as written and **nothing is for the owner to run by hand**; apply nothing to production first (CLAUDE.md). `pruneNotFound()` deletes in application code, not SQL.

**Advisors to check after the deploy** (Supabase project `ybsozesfuxuitoacntfo`): security (row-level security on with no policy on the three new tables, as every `commerce` table; the new functions all have `SET search_path = ''`); performance (the foreign keys are indexed: `redirects.created_by`, `product_id`, `term_id`, `not_found_ignored.created_by`; the trigram indexes are used by the manager's search; `not_found_hits` has its primary key as its only access path). Then record the files' versions in `docs/decisions.md` (Migration versions).

### 9.3 Decision row, draft

`D168` (the next free number: `docs/decisions.md` ends at D167):

> **Redirects and SEO fields for categories and tags (wave 2, second run).** `docs/wave-2-redirects.md` is the contract. A changed handle of a product that was live, and a changed slug of a category or tag, leave an automatic permanent redirect (`commerce.redirects`, kinds `product`, `category`, `tag`, made by database triggers, pointing at the thing so they never chain; a thing taking an address replaces its automatic redirect); pages and articles keep `page_redirects`. Staff add, edit, delete, search, import and export **manual** redirects (a source path to a target path on the store, market-relative so one redirect serves every country and language, exact and case-insensitive match, 308, at most 100,000 a store, never from a live address or a working page, never to another website, loops refused by the service, the dry run and a database trigger, a chain stored as its final destination and followed in one response up to 10 hops) at `/admin/{store}/redirects`; the CSV (Shopify's `Redirect from` and `Redirect to`) is a job on the D165 pipeline (`redirect_import`, `redirect_export`) with a per-line dry run. A request is looked up only where it would be a 404 (`missOrRedirect()`, a catch-all `[...rest]` route, the proxy for paths with no market), never for a live page. `/admin/{store}/redirects/404s` reports what shoppers and robots asked for that was not there (`commerce.not_found_hits`, the address only, no IP, user agent, cookie, referrer or query string, noise and anything that could hold a person's data never recorded, 90 days) with a suggested target and a one-click redirect. Categories and tags have an SEO title and description per language (`terms.seo`), used in their page's title, description, Open Graph tags and hreflang alternates, in the translation worklist, and the sitemap lists them. `catalogue.seo-fields…` and `storefront.url-redirect-manager` re-rated on tests. *Why:* the rows; renaming a product or category left its old address dead and an owner moving from another shop had no way to keep its links. Migration versions: `20261005162057_redirects`, `20261005162105_redirects_rules`, `20261005162114_redirects_audit`, `20261005162123_redirects_copy`, `20261005171916_redirects_plan_features`, applied by CI on 5 October 2026 (D168 in `docs/decisions.md`).

### 9.4 CLAUDE.md bullet, draft (Storefront section, after the Search bullet, or Admin section)

> - **Redirects and the 404 report (wave 2, D168, `docs/wave-2-redirects.md`)**: an address that changes leaves a permanent redirect: pages and articles in `page_redirects` (D42, by the page's id), products, categories and tags in `commerce.redirects` (kinds `product`, `category`, `tag`, written only by the triggers `products_leave_redirect()`/`terms_leave_redirect()`, pointing at the thing so they never chain, deleted when a thing takes the address), and **manual** redirects (kind `manual`, written only by `src/server/redirects.ts`, `validateRedirect()` in `src/lib/redirects.ts` is the one check: market-relative exact paths in the normal form of `src/lib/redirect-path.ts`, case-insensitive, never from a live address or a working page, never to another website, loops refused by the service, the import plan and `commerce.redirects_no_loop()`, 100,000 a store). A redirect is looked up **only where a request would be a 404**, through `missOrRedirect()` (`src/server/redirect-resolve.ts`: a cached lookup tagged `redirectsTag(store)` with a `revalidate` of one second, because a dynamic miss streams with status 200 (section 10), 308 or 404 before the first flush, a bounded lookup that follows up to 10 hops and treats a loop or a failure as a 404); the five store routes' `notFound()` and the catch-all `[market]/[...rest]` call it, and `src/proxy.ts` calls it for a path with **no market** (`parseLegacyRequest()`, a matcher kept in step by a test): never add a redirect lookup to a path that can be a live page. Imports and exports of redirects are D165 jobs (`redirect_import`, `redirect_export`, Shopify's `Redirect from` and `Redirect to`), never a second pipeline. The 404 report (`commerce.not_found_hits`, `record_not_found()`, `recordablePath()`) keeps the address, the day and counts only: never an IP, user agent, cookie, referrer or query string, never a working page's, a token's or a person's address; `pruneNotFound()` in the daily cron. Categories' and tags' SEO title and description are `terms.seo` per language (`termSeoFor()`, never another language's text), in the store translation worklist (scope `terms`) and in the sitemap (`listIndexedTerms()`, live addresses only). New tables are `never` in `COPY_RULES`; `terms.seo` is copied by `clone_store()` and `duplicate_store()`.

### 9.5 Other for the hand-over

- **Choices to confirm** (none blocks): (a) match **case-insensitively** (4.1 rule 3); (b) **no external targets** (4.1 rule 6; Shopify allows them; an owner-only switch is the easy extension); (c) a **draft's** address change leaves no redirect (3.3); (d) automatic redirects are not refused or capped (a rename must never fail); (e) the report's day is the **UTC** day.
- **Spike first** (foundation, before anything is built on it): in this app, with `cacheComponents` on, prove that (1) a `[...path]` catch-all beside `[slug]` and the `@drawer/[...rest]` slot builds and routes, (2) a `connection()` then `permanentRedirect()` in a miss branch of a route with `generateStaticParams` answers a real **308** and a `notFound()` there a real **404**, uncached, and (3) the proxy's second matcher entry leaves `/s/demo/no/…` and `/` alone. If (3) fails, drop the proxy branch (5.3 fallback). Report the result in `docs/wave-2-redirects.md` section 10.
- Fixtures: the CSV fixtures are written for the test with Shopify's two headings and made-up paths; no Shopify text is copied.
- The e2e needs no signed-in member (it seeds rows by SQL and requests the public routes; the admin routes are checked to give a visitor nothing, as `e2e/data-export.spec.ts` does).
- `pnpm parity:write` after the rows are re-rated; `docs/shopify-parity.md` is generated. Plan comparison: the two rows of 5.5. AI manager: `redirect_overview`, `add_redirect`, the `fix-broken-links` playbook.

---

## 10. Spike result (foundation, 2026-10-05)

Run in a scratch Next 16.3.6 app with `cacheComponents: true` laid out like the store routes (`[market]` root layout with a `@drawer/[...rest]` and `@drawer/(.)cart` slot, `[slug]` and `p/[handle]` with `generateStaticParams`, a catch-all, a proxy with the second matcher), built and started (`next build`, `next start`):

1. **A catch-all beside `[slug]` and the drawer slot builds and routes, with two conditions.** It must be named `[...rest]` (a `[...path]` beside `@drawer/[...rest]` fails the build: "Ambiguous app routes"), and it needs `generateStaticParams()` with a placeholder (`[{ rest: ["_"] }]`) or the build stops on "uncached or runtime data during prerendering".
2. **`connection()` then `permanentRedirect()` or `notFound()` does NOT give a status.** The response is a streamed 200 with `x-nextjs-postponed: 1` and an empty shell (with `export const instant = false` too). The same lookup as a **`'use cache'` function** (tag, `cacheLife({ stale: 300, revalidate: 1, expire: 3600 })`) gives a real **404** and a real **308** with the `Location`, and after `revalidateTag()` the next request for an address that was a 404 is a 308 (a 404 is cached for its window, one second, or until its tag is refreshed). A `stale` of 0 or an `expire` under 300 turns it back into a 500/200 dynamic hole. Section 5.3 is changed to this design.
3. **The proxy's second matcher leaves `/s/demo/no/…`, `/` and the market pages alone and runs for `/s/demo/collections/…`** (a response header set by the proxy is absent for the first and present for the second), and answers a 308 for an address that has a redirect. `src/lib/legacy-path.ts` holds the matcher literal and a test holds it to `parseLegacyRequest()`.
4. **Two things the spike found that the contract did not say:** `after()` never runs in a render that can be prerendered (so a miss cannot be counted from the page that draws it: it is counted in the cached lookup's fill, 5.3), and the robots' flag is therefore not known for such a miss. A first part that only looks like a market (`/om-oss`) is excluded by the matcher; the market route that finds it unknown looks it up with `legacyPathOf()` (5.3).

## 11. Shopper step findings (built and run against `next start`, 2026-10-05)

The store routes, the catch-all and the market layout were built and run in a real production build (`next build`, `next start`, a database seeded with every migration), with a throw-away experiment route that refreshed the lookup's tag. What the run showed:

1. **The routes work.** A renamed product, category or tag answers 308 with its `Location` in every market; a missing address is a 404 with the 404 status (page routes, catch-all, and the market layout for an address whose first part only looks like a market, `/om-oss`); the proxy answers a market-less address.
2. **A redirect that is a response's first render carries its `Location`, twice.** Next sets the header in two places while it streams, so an address rendered on demand for the first time has two identical `Location` headers (browsers accept it; a test makes the values one). Cached answers after it carry one.
3. **A redirect that comes out of a background re-render has NO `Location` header.** When a cached 404 is re-rendered into a redirect without the tag being expired (a time-based re-render after the lookup's one second, or `revalidateTag(tag, "max")`, which is stale-while-revalidate), the response is `308` with a body that redirects only in a browser (meta refresh) and **no `Location`**, which search engines and `curl` cannot follow; it stayed so for as long as it was watched (a minute). A blocking refresh, `updateTag()` in an action or `revalidateTag(tag, { expire: 0 })` anywhere, gives a normal first render with its `Location`. **Consequence for the code:** `refreshRedirects()` (and anything that refreshes the catalogue tag after a handle changed) must expire at once, not stale. `refreshTag()` falls back to `revalidateTag(tag, "max")` outside an action, which is the case of the CSV import, the assistant's tool and the cron; for redirects the fallback must be `revalidateTag(tag, { expire: 0 })`. Variant tried: a `revalidate` of an hour instead of one second removes the time-based re-render but not the stale refresh; the one second life was kept.
4. **The market layout's lookup.** An address whose first part only looks like a market is no market of the store, so the layout would 404, and the proxy's matcher leaves it alone. The layout asks `legacyLocation()` (`src/app/s/[store]/[market]/legacy-redirect.ts`, a cached lookup of the same life and tags as `missOrRedirect()`; a lookup that reads the database per request would stream a 200). Only the first part of the address is known to a layout, so `/om-oss/team` is the 404 it was.
5. **A title.** The term page's title is the language's SEO title as written (absolute) or the term's name, and the layout's template adds ` · Store` once; the first draft of `termMetadata()` returned `Name · Store` itself and the template doubled the store (`Hjem · Store · Store`, which the page had before this run).

## Verified in production

On 6 October 2026 the owner tried the redirect manager on a store: adding a manual redirect (it works, whatever the case), the refusal of a redirect from a live address, an automatic redirect after changing a product's handle, and the CSV export and import with its dry run.
