# Admin redesign, round 62: Kaizena Flow's VAT rates, Accounts and Data retention on a phone

Decision D823, 19 November 2026. The boards are on the design canvas of round 62.

Every store page is now within a screen on a phone or near it (Product settings, 717 px, and Blog comments, 691 px, are left), so
this round measured Kaizena Flow's own admin. Its tallest pages were wide tables squeezed into 390 px.

| Page | Before | After |
|---|---|---|
| VAT rates (`/admin/platform/vat`) | 29,264 px | 2,163 px |
| Accounts (`/admin/platform/plans/accounts`) | 20,072 px | 9,262 px |
| Data retention (`/admin/platform/retention`) | 11,823 px | 4,283 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## VAT rates

- **One line says what they are:** *The rates every store charges, read from public sources.*
- **What needs verifying comes first:** *231 rates to verify* (*Still charged; check them with an accountant*) with **Verify next**,
  opening the first country with a rate to verify.
- **Each country is one row** (`VatPhoneList`): *AT · Austria*, *8 rates · 0 % to 20 %*, and *8 to verify* or *All verified*,
  opening the country's own page. The table of unverified rates and the table of categories by country show from `sm` up.
- **Set a rate, the categories and shipping are rows** of one card, each opening its card.

## Accounts

- **One line says what launch does:** *At launch each account moves to one plan; move one first to try it.*
- **How many are left comes first:** *122 accounts still billed store by store* (*Each owner gets an email and credit for the time not
  used*).
- **Each account is one row:** its name, owner and stores, and *Move* opening what the move does and the button. An account on one
  plan keeps its chip.

## Data retention

- **One line says what it is:** *How long each kind of personal data is kept before the daily job removes it.*
- **Each kind of data is one row** of one card: *Orders, invoices and payments (bookkeeping)*, *5 in force · 5 to review*, opening its
  table of countries.

## How this differs from the boards

- **VAT rates and Accounts:** no search yet; Accounts lists its 122 rows (9,262 px). A search is the next step if the list grows.
- **Accounts:** no *Move one* button in the strip; each row's *Move* opens its own move.
- **Data retention:** Not reviewed yet keeps its card and sentence; the register, the job's runs and changing a period stay as cards
  under the rows.

## Platform

These pages are Kaizena Flow's own (`/admin/platform`); stores have no VAT table, accounts list or retention schedule of their own.

## Tests

- Lint, types and all unit tests pass.
- `vat-screens.spec.ts` and `privacy.spec.ts` pass against a local build (7 tests). The retention test looked for the first text
  *Orders, invoices and payments (bookkeeping)*, now also the phone row's title, hidden on a computer; it now asks for the section's
  heading.
