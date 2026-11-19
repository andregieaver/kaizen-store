# Admin redesign, round 63: Kaizena Flow's Customers, Extensions and Stores on a phone

Decision D827, 19 November 2026. The boards are on the design canvas of round 63.

The next tallest pages of Kaizena Flow's own admin after round 62.

| Page | Before | After |
|---|---|---|
| Customers (`/admin/platform/customers`) | 11,762 px | 7,606 px |
| Extensions (`/admin/platform/plans/extensions`) | 11,597 px | 926 px |
| Stores (`/admin/platform/stores`) | 11,356 px | 7,072 px |

The local database holds the test suite's many accounts and stores; the lists are as long as the data. Below 640 px wide, each page
changes as described here. From 640 px it is as before.

## Customers

- **The search is one line** with its button inside the field.
- **Each person is one row:** their name, then their email and first store (*+1* for each more). Their stores' roles and plans and the
  day they joined show from `sm` up and on their own page.

## Extensions

- **One line says what the page is:** *What each extension costs and includes. Prices exclude VAT.*
- **The launch is a row:** *Not sold yet · Every account has every extension until launch*, with *Launch* opening the launch card.
- **Each extension is one row:** *Email automation · 4 sizes · offered*, with *Edit* opening its form.
- **The bundles and what each plan includes are rows** too, each opening its section.

## Stores

- **The page builder sandbox is one row** saying whether it is on, opening its table.
- **Each store is one row:** its name, then its address, plan and fee a sale. A closed or paused store keeps its chip; the owner, the
  plan's state and an own fee show from `sm` up and on the store's page.

## How this differs from the boards

- **Customers:** the row says the person's first store, not their role and plan (they show on their page); the date is not on the row.
- **Stores:** the lead keeps its full text; the row leaves out the owner's name.

## Platform

These are the platform's own pages; stores have none of them.

## Tests

- Lint, types and all unit tests pass.
- `a11y.spec.ts` (which opens Stores) fails on seven pages, Stores among them, with one finding none of this round's files make: a
  sidebar link whose accessible name (*Support, 4 waiting*, *Access requests, 2 waiting*) does not contain its visible text. It shows
  on pages this round does not touch (`/admin`, `/admin/account`, `/admin/platform`).
