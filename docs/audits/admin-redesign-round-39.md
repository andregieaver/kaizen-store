# Admin redesign, round 39: Settings, Export orders and VAT reports on a phone

Decision D731, 17 November 2026. The boards are on the design canvas of round 39.

After round 38 the tallest store pages on a phone were these three, apart from the product layout builder's preview, which round 35 already reworked:

| Page | Before | After |
|---|---|---|
| Settings (`/settings`) | 2,122 px | 1,472 px |
| Export orders (`/orders/export`) | 2,113 px | 1,047 px |
| VAT, OSS and IOSS (`/analytics/tax`) | 2,100 px | 1,015 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Settings (`SettingsHub`)

- **The setup card is one line.** It shows *3 of 5 set up* with a thinner bar under it and the next fix beside them.
- **Everything else is one row**: *25 more settings most stores never change*, with *Show*. The search finds every one of them, and while
  searching, the names it finds show without the row.
- The groups are as they were.
- Kaizena Flow's own Settings draws the same hub. It has no setup card and no other settings, so nothing changes there.

## Export orders

- **One line says what the file is**, and personal data is one line too. *More* opens both of the full paragraphs.
- **The period stays open.** *Or some orders by their numbers* is the other choice, and its list of numbers shows once that choice is made.
- **Which of them, Layout, About the buyer and File format are rows** that say what is chosen. The line is read from the form by CSS
  (`:has`), so it is right without a script and after a change. The form still posts without JavaScript.
- **Amounts and VAT is a row** (*Not a statement for a tax return*) that opens its three paragraphs.

## VAT, OSS and IOSS

- **One line says what the page is.**
- **The three views are one choice** (`SelectNav`).
- **Not a tax return is one line**, with *More* opening its full words. The OSS and IOSS views get this too.
- **A period with no documents is said once.** The empty card stands without its section's heading and description.
- **VAT by country and rate, VAT by country and Reconciliation are rows of one card.** Each says what it holds: *No VAT*, a count of rows or
  countries, *Equal: every difference is named* or *Does not reconcile*.

## How this differs from the boards

- **VAT, OSS and IOSS:** the period stays the analytics chips that scroll sideways, rather than a select beside the view's.
- **Export orders:** the period and the rows share the form's one card rather than two.
- **Settings:** the lead keeps its sentence naming what needs you.

## Platform

- Kaizena Flow's Settings uses the same hub.
- Kaizena Flow has no order export or VAT reports of its own: it sells plans, and its own books are under Finance.

## Tests

- Lint, types and all unit tests pass. Seven files time out under the full run's load and pass when run alone.
- `tax-view.test.ts` now also reads the phone's choice of view.
- `targets`, `admin-text-fallbacks` and `data-export` pass against a local build.
- `tax-report.spec.ts`: two of its three tests pass. The VAT test's own invoice on the local database is dated two days earlier than the
  `period=today` it reads. CI runs it on a fresh database.
