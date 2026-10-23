# Cells: Dedicated and Private cloud (spike)

Status: **a proposal for the owner to accept, change or reject** (D314, `docs/capacity.md` step 5.0). Nothing here is built. Steps
5.1 onwards in `docs/capacity.md` wait for the owner's yes on this file. Facts about Vercel and Supabase are marked *verify*: check them
in the vendors' documentation (with its address and the date read) before building on them.

## 1. What a cell is

A **cell** is one complete running copy of Kaizena Flow: a Vercel project and a Supabase project, both in the EU, running the same commit
of this repository. Today there is one cell, `eu-1` (the Vercel project in `dub1`, Supabase `ybsozesfuxuitoacntfo` in eu-west-1). It is
*Shared* and it is also the **control plane**.

| Level | Cell | What the store gets |
|---|---|---|
| Shared | `eu-1` with every other store | Per-store limits, budgets and timeouts (phases 2 and 3) |
| Dedicated | a cell of its own, or a small one shared with a few Dedicated stores | Its own database compute and connection pool, its own function concurrency and spend limit, higher limits, its own maintenance window, SLO 99.95 % |
| Private cloud | a cell in the region and accounts the contract names | As Dedicated, plus the customer's keys and, optionally, their own Vercel team and Supabase organisation |

Why the database decides: Vercel runs each request in its own function instance and scales them by itself, so compute is already
isolated per request. What stores share, and what one store can exhaust for the others, is Postgres (connections, CPU, I/O, locks).
A level is therefore a question of which database a store's rows live in.

## 2. What the control plane keeps, and what a cell holds

**Proposal.** The control plane keeps:
- accounts and sign-in;
- plans, billing and Kaizena Flow's Stripe account;
- the platform admin;
- Kaizena Flow's own site and the theme store;
- themes and their versions;
- the AI providers and prices.

A cell holds:
- **every row of its stores.** `COPY_RULES` today classifies 243 store-owned tables, and each has `store_id`;
- **a one-way copy of the reference data its stores read.** Candidates are `plans` and `plan_prices` (names only), `design_presets`
  and `design_preset_versions`, `platform_languages`, `ui_translations`, `vat_categories` and `vat_rates`, `ecb_reference_rates`,
  `retention_rules`, `ai_model_prices`, `countries`, `postal_points`, and the parts of `platform_settings` a store reads.

**Before building:** classify every table in `src/db/schema.ts` as *control plane*, *store* or *copied reference*. Add a test like
`COPY_RULES`' so that a new table needs a decision. Tables that join a store to the platform (`store_billing`, `store_members`,
`accounts`) need a rule each; the likely rule is that the control plane owns them and the cell reads a copy.

## 3. Signing in to a store in another cell

**Proposal:** each cell's Supabase Auth trusts the control plane as an OpenID Connect provider. This is the pattern D95 already uses
between Kaizena Flow and Kaizen Life (`src/server/kaizen-life.ts`, `/auth/callback?via=kaizen-life`).
- The cell admits only the store's members, through a copy of `store_members` it keeps in step.
- Two-step sign-in stays the control plane's. The cell trusts the `aal` claim the control plane signs. *Verify* that Supabase passes
  the provider's claims through.

## 4. Addresses

- A store's own domains are attached to the cell's Vercel project, not to `eu-1`'s. *Verify* that a domain moves between projects
  without a new certificate gap, and that the move can be timed.
- `{slug}.{store domain}` and `/s/{slug}` on the control plane redirect (308) to the cell:
  - `src/lib/store-hosts.ts` builds its routing at build time and gains each store's cell origin;
  - a store that moves then needs a deploy of `eu-1`, as a domain change does today (P8).
- The admin's links to a store's pages already go through `storeHref()` and `storeSiteUrl()`, which then name the cell.

## 5. Webhooks and jobs

Every external sender has to reach the cell that holds the store.

- **Stripe Connect** names the store's account in `event.account`. There are two ways to route it:
  - (a) the control plane receives every event and forwards it to the cell. This is one endpoint, but every event travels twice;
  - (b) each cell has its own Connect webhook endpoint, and Stripe filters by connected account. *Verify* whether Stripe can filter a
    Connect endpoint by account. If it cannot, (a) is the way.

  Kaizena Flow's own billing webhook stays the control plane's.
- **Mollie, the carriers and the WordPress plugin:** the same question per sender. Mollie's webhook names only a payment id, so the
  URL must name the cell (a webhook URL per cell).
- **Scheduled jobs:** each cell runs its own `pg_cron` jobs for its stores. The control plane's jobs leave a moved store alone (a rule
  `stores.cell = current cell`).

## 6. Moving a store

D129's store copy cannot be used. It makes `C-…` copies of orders (history), but a move must keep every id, order number (D141) and
invoice number (D159).

**Proposal:**
1. Make the store read-only for a few minutes. A new `stores.moving_at` makes database rules refuse writes to its rows, as
   `orders_store_open()` refuses orders. The storefront keeps serving cached pages, and checkout says it is paused.
2. Copy every store row (by the classification of section 2) and its Storage objects (`{storeId}/…` in every bucket) to the cell.
3. Check counts and a checksum per table, which `scripts/move-store.mjs` (step 5.2) prints.
4. Switch the domains and the routing.
5. Lift read-only in the cell.
6. Keep the source rows untouched and marked for 30 days, then a person removes them.

Estimate the read-only time from the largest store's row counts before promising a window.

## 7. Costs

The owner fills these in from current prices. *Verify* each.
- Vercel: a project per cell (team plan), with its own spend limit;
- Supabase: a project per cell at the chosen compute size, point-in-time recovery, a read replica if wanted;
- a log drain per cell (traffic metering, D314 step 1.4);
- the time to run and watch one more cell.

The *Dedicated* price must cover all of this with margin.

## 8. Private cloud

Private cloud is a cell of kind `private`, built with the same tools in the region and accounts the contract names. The contract work
(data processing agreement, SLA, support hours, the customer's keys) is the company's. The code work is only what Dedicated did not
already cover, and is added here when a customer signs.

## 9. The owner's decision

Accept this proposal, change it, or reject it. On a yes, steps 5.1 (cells as data), 5.2 (the mover's dry run) and 5.3 onwards are
written into `docs/capacity.md` and built in that order, with one pilot store moved to a test cell and back, its numbers unchanged,
before any real store moves.
