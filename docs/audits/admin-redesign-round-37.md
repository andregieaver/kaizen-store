# Admin redesign, round 37: a new A/B test, Search and Product analytics on a phone

Decision D725, 17 November 2026. The boards are on the design canvas of round 37.

After round 36 no store page on a phone was above 2,500 px. The three tallest:

| Page | Before | After |
|---|---|---|
| A new A/B test (`/experiments/new`) | 2,495 px | 1,349 px |
| Search (`/search`) | 2,305 px | 681 px |
| Product analytics (`/analytics/products`) | 2,255 px | 1,608 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before.

## A new A/B test (`ExperimentForm`)

- **Where is one choice of page**, with its history (*Never tested*) and its visits a day under it. It replaces a card for every
  page.
- **How long it will take is one row**, with the weeks to an answer or *Not known yet*.

## Search

- **The three figures share one card.** Search by meaning says *Off* where it is off; what it needs is said from 640 px.
- **Three rows:**
  - Synonyms (*No synonyms yet · 3 languages*)
  - Results and pages (*No rules yet · 0 of 200*)
  - The most searched
- **Searches that found nothing** keep their *Add a synonym* and *Send to a page*, which open the row they name.

## Product analytics (`ProductsView`)

- **One amber strip** says what is missing, costs or visit counts or both, with *Fix*. It replaces the two notes. A partly known
  cost or a part period of visits keeps its note.
- **The three figures share one card** (`KpiCard` `phoneCompact`).
- **Every product is one line with its revenue.** From 640 px the table is as before.

## How this differs from the boards

- **A/B test:** the goal keeps its three cards and *More goals*.
- **A/B test:** Customise stays the fold it was rather than a second row.
- **Product analytics:** a product's line gives its revenue without the change against the period before. The change stays in the
  table and in the CSV.

## Platform

- The platform's A/B tests page lists Kaizena Flow's own tests and has no new-test form of its own; one would use this form.
- Kaizena Flow has no shop search or product analytics: it sells plans.

## Tests

- Lint, types and all unit tests pass.
