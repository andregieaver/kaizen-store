# Admin redesign, round 69: Kaizena Flow's New form, Referrals and Docs guide on a phone

Decision D844, 20 November 2026. The boards are on the design canvas of round 69.

The next tallest pages of Kaizena Flow's own admin after round 68 that no round has reworked. New article, New page and New header,
taller still, are the page editor that round 27 reworked.

| Page | Before | After |
|---|---|---|
| New form (`/admin/platform/forms/new`) | 1,897 px | 1,008 px |
| Referrals (`/admin/platform/referrals`) | 1,875 px | 668 px |
| Docs guide (`/admin/platform/docs/guide`) | 1,717 px | 719 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before. The heights after are measured on the dev server:
the production build stops at another change's page (`/no/sign-up/extensions`, ci-red #30).

## New form

- **Each template is a row** of one card: a small icon, the name, what it asks with its kind and how many questions; one press makes
  the form, as before. `FormStart` is the store's New form too, so stores get the same rows.

## Referrals

- **One line says what it is:** *Owners who refer a store earn credit on their own invoices.*
- **The program is a row** saying whether it is on and its terms (*Off · 10 % for 12 months · credit after 30 days*), opening the form
  with the switch and the terms.
- **The five figures are one strip.**
- **Referrers and referred stores are rows** with their counts (or that there are none), opening their tables.

## Docs guide

- **The switch and the settings come first;** how it works is a row under them, saying where answers come from and how long talks are
  kept, or that it needs Kaizena Flow's AI.
- **Name, picture and greeting are one row** saying what is set, and **messages a day a row** with its limit; Customise stays a fold.

## How this differs from the boards

- **New form:** a template's line wraps to two under its name, as it keeps the full description.
- **Referrals:** the program has no *Turn on* of its own on the row; the switch is in the form the row opens, saved with the terms.
- **Docs guide:** the switch stays the form's checkbox, saved with Save, not a *Turn on* on its row.

## Platform

New form is the store's and the platform's one component; Referrals and the Docs guide are the platform's own.

## Tests

- Lint, types and all unit tests pass.
- On the dev server: `docs-guide.spec.ts`'s settings test and `forms.spec.ts`'s test that makes a form from a template pass. The
  docs guide's axe test fails on the sidebar's *Access requests, 2 waiting* label, as on pages this round does not touch;
  `forms.spec.ts`'s storefront test (a visitor sends the form on a page) fails waiting for the sent message on the dev server, a part
  this round does not change.
