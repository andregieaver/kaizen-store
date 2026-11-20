# Admin redesign, round 72: Kaizena Flow's 100-day challenge, Categories and tags and Fonts on a phone

Decision D858, 20 November 2026. The boards are on the design canvas of round 72.

The next tallest pages of Kaizena Flow's own admin after round 71 that no round has reworked. New content type was round 44 and
Endpoints round 33.

| Page | Before | After |
|---|---|---|
| 100-day challenge (`/admin/platform/challenges`, no store in one) | 1,097 px | 664 px (one screen) |
| Categories and tags (`/admin/platform/pages/categories`, the same for articles) | 959 px | 751 px |
| Fonts (`/admin/platform/fonts`) | 905 px | 845 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before. Measured on the dev server.

## 100-day challenge

- **One line says what it is:** *Stores the autopilot runs alone for 100 days, judged on three ratios.*
- **The stores in a challenge come first** as before; **setting a challenge is a row** (*Locks the owner's settings but for the pause*)
  opening its form and its terms.

## Categories and tags (`TermsManager`, the store's and the platform's)

- **One line says what they are for.**
- **What there is comes first:** each card lists its categories or tags, then *New category* or *New tag* is a row saying what one is
  (*Can hold subcategories*, *A flat list across categories*), with *Add* opening the field. The card's explanation shows from `sm` up.
  The store's categories and tags pages use the same manager, so they get the same order and rows.

## Fonts

- **One line says what it is:** *Any Google Fonts family for Kaizena Flow's own site, served from the site.*

## How this differs from the boards

- **Fonts:** the sample keeps its full text, so *Save fonts* is just below the first screen rather than on it.

## Platform

The 100-day challenge and Fonts are the platform's pages (a store's fonts page has its own); Categories and tags shares its manager with
the store's.

## Tests

- Lint, types and all unit tests pass.
