# Admin redesign, round 53: Live, Stock locations and Authors on a phone

Decision D798, 19 November 2026. The boards are on the design canvas of round 53.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Live (`/analytics/live`) | 1,106 px | 680 px |
| Stock locations (`/inventory/locations`) | 1,105 px | 664 px |
| Authors (`/articles/authors`) | 1,093 px | 728 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Live (`LiveView`)

- **One line says what the page does:** *Your store now, read again every 10 seconds.* The time of the last reading stays under it.
- **Visit counting is said once.** While it is off, a strip says *Visit counting is off* (*No cookies; it counts from the day it is on*)
  with *Turn on*. The two visitor figures show a dash, without the note and the link under each (`KpiCard` `phoneCompact`).
- **The six figures share one card, two by two.** All of them fit on one screen.

## Stock locations (`LocationsView`)

- **One line says what locations are:** *Where your stock is held. Orders are taken from the top one first.*
- **Each location is a line:** its place in the order, its name, and *country · state · online orders · what it holds*. *Change* opens
  its buttons under it: up, down, rename, deactivate, online orders, reactivate. Each button is shown only to those who may use it.
  The table is not shown on a phone.
- **Add a location is a row** (*A name and its country*). Its help is left out; the note at the limit of 20 stays.
- **How orders pick a location is a row** at the end of the page. Its subtitle says what is chosen (*Top first, kept together where it
  can*, or *The delivery country's first*). It holds the rule and, with two or more active locations, the choice.

## Authors

- **One line says what authors are:** *Who writes your articles, shown under each one.*
- **No authors yet is a small card.** Its heading is left for screen readers.
- **The name and Save the author stay open.** The picture, a few words and the link are one row (*Optional*), open when an author is
  being edited (`BlogAuthorForm`).

## How this differs from the boards

- **Live:** the time of the last reading stays its own line, as the page reads it again, rather than joining the lead.
- **Stock locations:** the two rows are two cards, not one. The rule sits at the end of the page, where the table's paragraph is
  moved with CSS `order`, and the form stays where it is.
- **Stock locations:** each line also says what the location holds (*223 units across 4 variants*), which the board left out.

## Platform

- Live and Authors reach Kaizena Flow through its own store, which serves kaizenaflow.com (D484, `docs/platform-parity.md`): the
  same pages, so the same change.
- Kaizena Flow sells plans, not goods: it has no stock locations to show.

## Tests

- Lint and types pass.
- All unit tests pass.
- `live.spec.ts`, `blogs.spec.ts`, `suppliers.spec.ts` and `stock-transfers.spec.ts` pass against a local build (9 tests).
