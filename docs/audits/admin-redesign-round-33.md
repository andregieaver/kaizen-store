# Admin redesign, round 33: Endpoints, Integrations and Pages on a phone

Decision D707, 17 November 2026. The boards are on the design canvas of round 33.

## The pages

After round 32, no store page on a phone was above 2,900 px. The three tallest:

| Page | Before | After |
|---|---|---|
| Your own endpoints | 2,831 px | 994 px |
| Integrations | 2,803 px | 1,943 px |
| Pages | 2,761 px | 1,357 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before.

## Your own endpoints (`webhook-endpoints.tsx`, the store's and the platform's pages)

- **The events are one row.** It says how many are chosen and the first four by name (*4 of 30: Order paid, Order sent, …*). It
  follows each tick, and *Change* opens the list.
- **The same form edits an endpoint**, so the edit form gets the row too.
- **The privacy note** is one sentence on a phone.
- **How to check the signature** is a row at the end, for the developer of the receiving system.

## Integrations (`/admin/{store}/integrations`)

- **Every service is one line**: its mark, name, state and action. What it does is said on its own page.
- **The five kinds** are one choice beside the search (`SelectNav`), in place of chips that wrapped over three lines.
- **A good start** shows its first suggestion only.

## Pages (`PageCards`, the store's pages and its articles)

- **Each page is one line of name**, with a line of words under it: its state, its place in the shop and the day (*Published, draft
  has changes · Front page · 16 Nov*). The words take the state's colour and are never cut off.
- **No empty square:** a page without a picture has none on a phone; a page with one keeps it.
- **The first ten pages show**, then *Show all 18* (`PhoneMore`). A search shows every match.
- **The shop's own pages are one row** (*2 your own · 12 standard*), whose *Change* opens the list as before.

## How this differs from the boards

- **Integrations:** a service connected still appears in its group as well as under Connected, as at every width.
- **Integrations:** the good start keeps its card, with its sentence, rather than a single line.
- **Pages:** *Show all* is a button under the list rather than a line inside it.
- **Pages:** the count of standard pages follows the page's own rule. The front page is not counted, so it reads *12 standard*, not
  *13*.

## Platform

- The platform's endpoints page uses the same form and gets the same signature row.
- The platform's integrations list is its own shorter page, and its pages list is a table that rounds 5 and 28 left as it was.

## Tests

- `round-33-phone.test.ts` covers ten pages then *Show all*, the one-line state, and the events row's count.
- Lint, types and all unit tests pass.
