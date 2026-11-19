# Admin redesign, round 64: Kaizena Flow's Record of processing, Themes and Languages on a phone

Decision D830, 19 November 2026. The boards are on the design canvas of round 64.

The next tallest pages of Kaizena Flow's own admin after round 63.

| Page | Before | After |
|---|---|---|
| Record of processing (`/admin/platform/processing`) | 10,323 px | 2,386 px |
| Themes (`/admin/platform/themes`) | 7,827 px | 6,403 px |
| Languages (`/admin/platform/languages`) | 7,676 px | 2,253 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Record of processing

- **One line says what it is:** *What Kaizena Flow does with personal data, purpose by purpose (GDPR Art. 30). Not legal advice.*
- **Each purpose is one row** of one card: the purpose, then its article, who decides and *for the lawyer* where it is marked for
  review, opening the whole record (basis and why, whose data, how long, where it is kept).

## Themes

- **One line says what a theme is:** *Whole looks owners apply from Design settings; every change is a draft until you publish it.*
- **Each theme is a short row:** its name and state, when it was published and how many stores use it, *Edit* and *More*. More holds
  Preview, Publish, Archive, Delete and Move up and down; the picture, the position and the line about it show from `sm` up.
- The cards under the list (store pages, demo stores, launch themes, a new theme) are as before; with the test suite's themes the
  page is still 6,403 px.

## Languages

- **One line says what it is:** *The languages owners can offer; the interface is translated by AI and reviewed here.*
- **Kaizena Flow's own site and adding a language are rows**, the site's saying which languages it is offered in.
- **Each language is one row:** its names and code, then how far its interface is and how many stores use it, opening its locales,
  Translate and review and Switch off.

## How this differs from the boards

- **Themes:** no New theme button at the top; the new theme form stays at the foot. Archived and Submissions keep their tabs and card.
- **Languages:** a right-to-left language's mark shows from `sm` up only.

## Platform

These are the platform's own pages; stores have none of them.

## Tests

- Lint, types and all unit tests pass. The copies budget caught the Themes row's buttons written twice (in the row and behind More);
  they are now one value shown in both places.
- `theme-store-pages.spec.ts` and `themes-unified.spec.ts` pass against a local build. `a11y.spec.ts` fails on seven pages, Themes and
  Processing among them, on the one finding of round 63: the sidebar's *Access requests, 2 waiting* link, which none of this round's
  files make.
