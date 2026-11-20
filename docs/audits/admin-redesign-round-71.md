# Admin redesign, round 71: Kaizena Flow's Stripe, Stores' support and Docs feedback on a phone

Decision D853, 20 November 2026. The boards are on the design canvas of round 71.

The next tallest pages of Kaizena Flow's own admin after round 70 that no round has reworked. Menus and the chat agent are built from
parts earlier rounds reworked.

| Page | Before | After |
|---|---|---|
| Stripe (`/admin/platform/stripe`) | 1,329 px | 664 px (one screen) |
| Stores' support (`/admin/platform/support/stores`, 19 stores) | 1,179 px | 1,485 px |
| Docs feedback (`/admin/platform/docs/feedback`) | 1,160 px | 935 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before. Measured on the dev server: the production build
still stops at another change's page (`/no/sign-up/extensions`, ci-red #30).

## Stripe

- **One line says what it is:** *Stores sell through their own Stripe; Kaizena Flow bills plans from its own.*
- **Test and live mode are rows** of one card, each saying keys and webhooks in a line (*No keys · webhooks not connected*), with
  Connect on the row when keys are set.
- **Where shoppers pay and the default fee are rows** saying what is set, opening their forms.

## Stores' support

- **The summary is one line:** *16 conversations in 19 stores · 4 waiting now.*
- **Each store is a row,** those with someone waiting first: its mode and conversations, *1 waiting* at its end, opening its rates (AI
  alone, handed over, first answer, missed, said we helped) and a link to the store's page. From `sm` up the table.

## Docs feedback

- **One line says what it is.** The explanation of searches that found nothing shows from `sm` up.
- **Each page with answers and each search that found nothing are rows:** a search with its language, how often and the latest, Remove
  at its end.
- **The answers' filters are one row** saying what is chosen, opening the form.

## How this differs from the boards

- **Stores' support is taller than before** (1,485 px against 1,179): the table showed three of its nine columns in one line a store,
  the rows show every store's figures in two lines and the rest one press away.
- **Docs feedback:** By page keeps its card and heading over its rows.

## Platform

These are the platform's own pages; a store's Stripe connection, support reports and docs have their own pages, reworked before.

## Tests

- Lint, types and all unit tests pass.
- On the dev server: `docs-guide.spec.ts`'s settings test and `empty-states.spec.ts`'s docs feedback test pass.
