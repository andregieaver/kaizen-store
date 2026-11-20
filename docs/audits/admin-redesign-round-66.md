# Admin redesign, round 66: Kaizena Flow's Plan analytics, AI usage and Access requests on a phone

Decision D835, 20 November 2026. The boards are on the design canvas of round 66.

The next tallest pages of Kaizena Flow's own admin after round 65.

| Page | Before | After |
|---|---|---|
| Plan analytics (`/admin/platform/plans/analytics`) | 3,918 px | 1,123 px |
| AI usage (`/admin/platform/ai/usage`) | 3,788 px | 1,207 px |
| Access requests (`/admin/platform/requests`) | 3,518 px | 2,384 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Plan analytics

- **One line says what it is:** *What the stores' plans earn and how many who ask end up paying.*
- **The four figures are a compact strip** (every month, stores paying, on a free trial, leaving); their explanations and the late
  count show from `sm` up.
- **Each report is a row** of one card (targets, from asking to paying, where owners came from, ad platforms, cohorts, how the revenue
  moved, by plan, sales and VAT, payouts), opening it.

## AI usage

- **The figures are a compact strip of four**; the fifth (tokens on Kaizena Flow's key) shows from `sm` up.
- **The day chart and each breakdown are rows** (by provider and model, by owner account, by store, by what asked), and tokens per call
  is a row under them. The owner's own usage page (`/admin/account/usage`) shares the report, so it gets the same rows.

## Access requests

- **One line says what approving does:** *Approving makes the store and emails the owner a sign-in link.*
- **Self-serve sign-up and the sandbox are rows** saying *On* or *Off*, opening their switch.
- **Each waiting request is one row:** the store's name, who asked and when, with *Approve* opening the form (name, address, theme,
  Approve and Decline). Recently decided stays a list.

## How this differs from the boards

- **Plan analytics:** the late count, a sub of Stores paying, shows from `sm` up only.
- **Access requests:** the row's sub leaves out what the store sells; it shows when the row opens.

## Platform

These are the platform's own pages; stores have none of them. The owner's AI usage page shares the report and its rows.

## Tests

- Lint, types and all unit tests pass.
- `admin.spec.ts` (which opens Access requests) passes against a local build (12 tests). No signed-in spec opens these pages.
