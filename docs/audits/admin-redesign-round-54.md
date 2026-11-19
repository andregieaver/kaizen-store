# Admin redesign, round 54: Export stock, Speed and Heatmaps on a phone

Decision D802, 19 November 2026. The boards are on the design canvas of round 54.

These were the tallest store pages on a phone that no round had reworked. Export orders (1,047 px) was passed over: round 39 reworked it.

| Page | Before | After |
|---|---|---|
| Export stock (`/inventory/export`) | 1,060 px | 664 px |
| Speed (`/analytics/speed`) | 1,051 px | 711 px |
| Heatmaps (`/analytics/heatmaps`) | 1,044 px | 874 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Export stock

- **One line says what the file is:** *A row for each variant at each location, to count and bring back.*
- **The format and Export stock stay as they are.**
- **About the file is a row** (*Its columns, counting from it, figures below zero*) that opens the three notes.

## Speed (`SpeedView`)

- **One line says what the page shows:** *How fast your pages load for the people who open them.*
- **Visit counting off is a strip** (*Visit counting is off · Speed is measured only while it is on*) with *Turn on*, in place of the
  notice whose link came at its end.
- **What the three figures mean is a row.** Its subtitle names them; it opens their explanations.
- **What it cannot measure is a row** (*Quiet pages, checkout, visitors who opt out*) that opens the list.

## Heatmaps (`HeatmapsHub`)

- **One line says what the page shows:** *Where visitors click, scroll and look, page by page.* The periods stay.
- **Each page where visitors get stuck is one line:** its name and figures, then *Recordings* (for the owner) and *Map*. The sections'
  descriptions are left out.
- **Every measured page is a line** (*160 views · 12.5 % stuck · 81.3 % reached half*, then *Map*) in place of the five-column table,
  which split numbers from their units.

## How this differs from the boards

- **Speed:** the report's heading, its dates and *No page loads were measured* stay as they were, rather than becoming one small card.
- **Speed:** the three figures are four on this page (*First answer* too); the row names all of them.
- **Heatmaps:** the most viewed pages keep their heading (*Most viewed pages*); the board called it *Every measured page*.

## Platform

- Heatmaps reach Kaizena Flow through its own store, which serves kaizenaflow.com (D484, `docs/platform-parity.md`): the same page, so
  the same change.
- The platform's own speed figures are on Usage and limits (`OwnSpeedView`), a page of its own that this round does not touch.
- Kaizena Flow sells plans, not goods: it has no stock file.

## Tests

- Lint passes. Types pass except one error in `src/server/flows.int.test.ts`, from another change pushed 14 minutes before
  (D767, `d56e1a008`), which this round does not touch.
- All unit tests pass.
- `inventory.spec.ts`, `heatmaps.spec.ts` and `recordings.spec.ts` pass against a local build (10 tests). The recordings assessment
  first failed: five migrations of 18 and 19 November had not been applied to the local database. Applied, it passes.
