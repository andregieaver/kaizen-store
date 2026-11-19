# Admin redesign, round 56: New segment, Google reviews and Wishlists on a phone

Decision D809, 19 November 2026. The boards are on the design canvas of round 56.

These were the tallest store pages on a phone that no round had reworked. The VAT term page (1,029 px) was passed over: it was
measured at its route's pattern, not at a real term.

| Page | Before | After |
|---|---|---|
| New segment (`/segments/new`) | 975 px | 906 px |
| Google reviews (`/integrations/google-reviews`) | 971 px | 784 px |
| Wishlists (`/wishlists`) | 971 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## New segment (`SegmentEditor`)

- **The four starts are rows of one card**, each its name and one line, under a small *Start from*.
- The name, who is in it, the count and *Save segment* follow as before.

## Google reviews (`GoogleReviewsSettings`)

- **One line says what it does:** *Your rating and reviews on Google, on your pages.*
- **Step 1 is the key and Save key.** How to get a key is a row after it (*Places API (New), billed by Google*). A saved key's last
  characters still show.
- **Step 2 is one line until a key is saved:** *Once the key is saved: find your business by name and town.* Its search shows once
  there is a key.
- **Google's terms are one small line at the end.**

## Wishlists

- **One line says what it shows:** *What shoppers saved with the heart, and what they bought.*
- **The four figures share one card, two by two.**
- **A store with no lists yet is not offered a search**, and *Most wished for* waits for something saved. The empty card keeps its
  words (*No wishlists yet. They show here once a shopper taps a heart.*).

## How this differs from the boards

- **New segment:** *Who is in it* and its line (*No conditions: everyone*) stay, so *Save segment* is just under the first screen
  rather than on it.
- **Google reviews:** step 2 keeps its card and title; only its text and form wait.
- **Wishlists:** the empty card keeps the page's own words rather than the board's.

## Platform

- Kaizena Flow's own Google reviews page (`/admin/platform/google-reviews`) shares `GoogleReviewsSettings` and takes the same lead.
- Segments reach Kaizena Flow through its own store (D484): the same page, so the same change.
- Wishlists stay store-only: Kaizena Flow sells plans, not goods.

## Tests

- Lint, types and all unit tests pass.
- `segments.spec.ts`, `admin.spec.ts` and `components.spec.ts` pass against a local build (29 tests).
