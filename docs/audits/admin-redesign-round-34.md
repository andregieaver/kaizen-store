# Admin redesign, round 34: Inventory, a report and Features on a phone

Decision D708, 17 November 2026. The boards are on the design canvas of round 34.

## The pages

After round 33 no store page on a phone was above 2,730 px. The three tallest:

| Page | Before | After |
|---|---|---|
| Inventory (`/analytics/inventory`) | 2,726 px | 1,763 px |
| A report (`/analytics/reports/view`) | 2,722 px | 1,133 px |
| Features (`/settings/features`) | 2,672 px | 1,532 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before.

## Inventory (`InventoryView`)

- **The seven figures share one card**, two by two, each its label and value (`KpiCard` `phoneCompact`). The odd last one spans the
  width.
- **Costs missing is said once**, in the note above the figures. A card without a figure shows its dash alone, not its own *Enter
  what your products cost*.
- **Every variant is one line:** its name, and in its state's colour the state and what is on hand (*Running low · 3 on hand*). From
  640 px the table is as before.
- **The status choices** scroll sideways in one line.
- **What the columns mean** is left out, since a phone shows no columns.

## A report (`ReportView` and its page)

- **Build the report is one row** under the sentence that says what the report shows. *Change* opens the form, and a new
  report with nothing to show opens with the form.
- **The chart comes first**, with each figure's total under it.
- **The table is one row** (*The figures in a table · 14 rows*) with *Show*. A report shown as a table keeps its table.
- `PhoneRow` gains `defaultOpen`.

## Features (`FeaturesView` and its page)

- **Each feature is its name**, *In use* where it is, a small *i*, and its switch centred beside it. What it does opens under the
  *i*.
- **A feature that needs another** still says so.
- **The online shop** keeps its words.
- **The time zone and the reminder** are one row (*Europe/Oslo · 24 hours before*) with *Change*.

## How this differs from the boards

- **Inventory:** the cost note keeps its full words. Running out keeps its lines with their pills, and the figures are two by two
  rather than three by two.
- **Report:** saving keeps its card with the name over the button, rather than side by side.
- **Report:** the dates in the table are not shortened. The table is folded on a phone, so they no longer wrap in sight.

## Platform

- Kaizena Flow sells plans, not stock, so it has no inventory, and it has no store features or reports of this kind.
- The platform's own analytics are a separate step in `docs/platform-parity.md`.

## Tests

- `features-view.test.ts` finds the switch by its role now that a row holds the small *i* too, and checks the *i* and the folded
  words.
- Lint, types and all unit tests pass.
