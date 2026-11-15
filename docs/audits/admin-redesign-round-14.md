# Admin redesign, round 14: Companies, Deals, the activity log

Decision D641, 16 November 2026. The boards are on the design canvas of round 14 (today and proposal for each page). Built as drawn,
for Homer first, with Lisa's depth one step away. The round first meant sales activities; they live inside Deals, so the store's activity
log, which needed it more, took their place.

## Switched off, one press on

The panel every page behind a store feature shows while the feature is off (`FeatureOffPanel`) now has *Switch it on* for owners, beside
*Go to Features*: a plain form to `/admin/{store}/settings/features/on`, which switches the feature on (owners alone, `setFeature()`, as on
Features; on needs no confirmation) and comes back to the page, or opens Features when it is refused (a need that is off). A form to a
route rather than a server action keeps server code out of a client part drawn on a hundred pages. Companies and Deals are the first pages
of this round to use it; every other gated page has it too.

## Companies (`/admin/{store}/companies`)

- A sentence: *No companies yet.* or *{n} companies buy from you.*, then what a company is.
- *Add a company* asks first for the organisation number or name (the register lookup); the found company fills in the fields, and
  *Fill in by hand instead* opens them empty. The employees' share and the most accounts are in *More settings*, today's defaults kept;
  *Make company* shows with the fields (`CompanyFields` `stepped`, `submit`). A company's own page is as before.

## Deals (`/admin/{store}/deals`)

- A sentence: *No deals yet.* and what a deal is, or *{n} open deals worth {amount}.*
- With no deal, one card, *Add your first deal*, with the stages as small labels (the first one marked) and *New deal*; the board, its
  drag hint and the 90-day note come with the first deal. Leads and Pipelines stay where they were.

## Activity log (`/admin/{store}/activity`, and the platform's)

- A sentence: *{n} changes this week, by {n} people.* (`activityWeek()`, what this viewer may see), and who sees what.
- People and areas are chips; the action, the period and the CSV are under *More filters and download* (open while one is chosen).
- Entries are grouped by day (*Today*, *Yesterday*, then the date), each saying its time; an entry whose target has no name no longer
  shows its type and id (`bank_statement 379927ca-…`): the action's words stand alone, and a written sentence says *it*.
- The platform's activity log uses the same list, so its rows read the same.

## What differs from the boards

- The log's rows keep their action words ("Work bank statement imported") where no sentence is written; naming every kind of target in
  plain words ("a bank statement") needs words per target type and is left for its own change.
- Companies: the found company fills the existing fields (its name and number, with the register's note) rather than becoming a card.

## Platform

Kaizena Flow has no companies or deals of its own (it sells plans); its activity log has the new rows and days.

## Tests

`e2e/signed-in/deals.spec.ts` reads the stages on the first-deal card; `activity-and-legal.test.ts` the day and the time apart.
