# Admin redesign, round 9: Reports, Coupons, Blog

Decision D630, 15 November 2026. The boards are on the design canvas of round 9 (today and proposal for each page). The pages were
built as drawn, for Homer first, with Lisa's depth one step away.

## Reports (`/admin/{store}/analytics/reports`)

- The header asks *What do you want to know?* and says each answer is for the last 30 days. *Build your own* (secondary) replaces
  the green *New report*: the ready reports are Homer's main way in.
- Saved reports come first, and only when there are any (the empty card is gone).
- The ten ready reports sit under four questions: *What sells?* (product, variant, category), *Where do they buy?* (country,
  currency, channel), *How do they pay?* (payment method, discount codes) and *When, and do they come back?* (day, new and
  returning). Each row is one link with a short name and its answer: the top row's label and its share of net sales
  (`src/server/report-answers.ts`, `readyAnswers()`, each report run with `limit: 1` over 30 days), or *No sales in the last 30 days*.
- The answers stream in a Suspense boundary; the page draws without them first. A report that fails to run is logged
  (`reports.ready_answer_failed`) and simply shows no answer.

## Coupons (`/admin/{store}/discounts`)

- A sentence: *No codes yet.* or *{n} codes are live.*, then *Start from an offer most shops make*. *Write your own* opens the blank
  form.
- Four ready offers (`src/lib/discount-offers.ts`): WELCOME10 (10 %, once per customer), FRAKTFRI (free shipping), NEWS15 (15 %,
  ends in two weeks, at 23:59 Oslo time) and TAKK100 (100 off over 500 in the main currency's markets, once per customer). *Make it*
  opens New coupon with `?offer=` and the form filled in; nothing is saved until the owner presses Save. An offer whose code already
  exists keeps its card without *Make it*.
- Existing codes stay listed above the offers with uses, what they gave, status, Edit and Delete.

## Blog (`/admin/{store}/articles`)

- A sentence: how many articles are live and the newest one's title and date, or, with none, that the first stays a draft until it
  is published.
- Articles are the Pages list's picture cards (`PageCards`, now with `label`, `newLabel` and `newSub`), with the *New article* card
  last; Edit, View and Duplicate are in each card's ⋯ menu.
- Categories and tags, Blogs and Comments are under More, Comments keeping its waiting count; comments waiting show as a line above
  the articles with *Read them*.

## What differs from the boards

- *Write with AI* on the blog was left out: articles have no AI route of their own yet (pages have `/pages/ai`). The new card's
  sub-line says *a draft until you publish it* instead of the AI draft.
- The coupons board shows the first offer's button green and the others as links; built, the first is green only while there are no
  codes, the others secondary buttons (a link alone was too small a target on a phone).
- The waiting-comments line links to the comments list rather than approving in place; approving stays on that page, where the
  comment can be read first.

## Platform

Kaizena Flow's own blog (`/admin/platform/articles`, `PagesListView`) and its plan coupons (`/admin/platform/discounts`) keep their
layout; the same sentence, cards and ready offers for them are the next step. The platform has no ready reports.

## Tests

`src/lib/discount-offers.test.ts` (new); `e2e/signed-in/reports.spec.ts` opens *By product*.
