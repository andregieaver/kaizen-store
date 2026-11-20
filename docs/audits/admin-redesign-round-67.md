# Admin redesign, round 67: Kaizena Flow's Domains, AI and Change log on a phone

Decision D837, 20 November 2026. The boards are on the design canvas of round 67.

The next tallest pages of Kaizena Flow's own admin after round 66.

| Page | Before | After |
|---|---|---|
| Domains (`/admin/platform/domains`) | 3,191 px | 886 px |
| AI (`/admin/platform/ai`) | 2,353 px | 687 px |
| Change log (`/admin/platform/activity`) | 2,344 px | 1,888 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Domains

- **One line says what it is:** *Stores buy domains here at the registrar's price plus your margin.*
- **Each currency is a row** saying its margin and lowest price a year (*25 % margin · at least NOK 150.00 a year*), with *Change*
  opening its form.
- **The rest is one card of rows:** stores that may buy (how many are open), domains on their own (on or off), the way in (how many came
  for a domain and opened a store), purchases waiting for a look (open when there are any), purchases that need a look and registrations
  (how many), each opening its card.

## AI

- **The lead is the status and the AI usage link**; the line on pictures shows from `sm` up.
- **No model that sees pictures is a strip:** *No model looks at pictures yet*, with *Choose one* opening the provider's row.
- **AI acting on its own is a row** saying running or paused, with *Pause all of it* on the row.
- **Provider and models, web search, the tests and Dream Factory runs are rows** saying what is set (the provider and on or off, the
  search service or no key yet, how many recent runs), each opening its form or list.

## Change log

- **One line says what it is:** *What platform admins did. Kept 24 months, never changed.*
- **The five filters are behind one Filter row** saying what is chosen (*Everyone · All areas · any time*). The entries start on the
  first screen; they are as long as the log, so the page stays long.

## How this differs from the boards

- **Domains:** the currencies' heading stays inside their card.
- **AI:** the provider is one row opening the whole form, whose models are already rows with *Change*; the board drew them as rows of
  the page. Pause and the settings are two cards.
- **Change log:** the Filter row's sub leaves out a chosen action.

## Platform

These are the platform's own pages. A store's AI settings and log were reworked in earlier rounds; stores have no domain pricing.

## Tests

- Lint, types and all unit tests pass.
- `a11y.spec.ts` and `permissions.spec.ts` against a local build: 12 pass; 7 a11y pages, among them AI, fail on the sidebar's
  *Access requests, 2 waiting* label, which fails the same on pages this round does not touch.
