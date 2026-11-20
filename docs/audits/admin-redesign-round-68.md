# Admin redesign, round 68: Kaizena Flow's Search, AI prices and A/B tests on a phone

Decision D841, 20 November 2026. The boards are on the design canvas of round 68.

The next tallest pages of Kaizena Flow's own admin after round 67.

| Page | Before | After |
|---|---|---|
| Search (`/admin/platform/seo`) | 2,166 px | 859 px |
| AI prices (`/admin/platform/ai/prices`) | 2,021 px | 805 px |
| A/B tests (`/admin/platform/experiments`) | 2,018 px | 1,287 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Search

- **One line says what it is:** *How Kaizena Flow's own pages show in search, when shared and to AI.*
- **The front page's search result shows first**, as a search engine would draw it. The preview is `SnippetPreview`, taken out of the
  snippet fields, which keep drawing it under the fields everywhere.
- **The form is three rows** saying what is set: title and description (or, in the warning colour, how many characters the description
  is too long), the share picture (yours, or drawn from the name), and profiles, AI text and site codes. Save follows the rows; closed
  rows still post their fields. The links to robots.txt, the sitemap and llms.txt are a line under Save.

## AI prices

- **One line says what it is,** with the AI usage link.
- **Used without a price** keeps its list with *Set a price*; its explanation shows from `sm` up.
- **Setting a price is a row,** *Price another model*, that opens the form. It opens by itself when a model's *Set a price* or *Change*
  led here; its anchor `#set-price`, which those links always named, now exists on every width.
- **Each model's price now is one row** (*openai · in $0.40 · out $1.60*) with *Change* opening the form filled with it. Earlier prices
  and the other units are in the table from `sm` up.

## A/B tests

- **One line says what it is.**
- **The four counts are one strip** of a card; their notes show from `sm` up.
- **Each test is one line** with its state at the end; the verdict's sentence shows from `sm` up, and what needs a look stays in red.
- **Kaizena Flow's own site and the tests that run on their own are rows** of one card, each saying where it stands.

## How this differs from the boards

- **Search:** profiles, AI text, crawler rules and the site codes are one row, as they are one card from `sm` up.
- **AI prices:** used without a price stays a card with its heading, not a strip.
- **A/B tests:** a test's line keeps its versions and goal words, so it wraps to two lines under the name.

## Platform

These are the platform's own pages. A store's search settings (round 31) and A/B tests were reworked before; stores have no AI prices.

## Tests

- Lint, types and all unit tests pass.
- `admin.spec.ts`, which opens Search and A/B tests, passes against a local build (12 tests). No signed-in spec opens these pages.
