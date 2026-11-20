# Admin redesign, round 70: Kaizena Flow's Status page, API and Limits on a phone

Decision D846, 20 November 2026. The boards are on the design canvas of round 70.

The next tallest pages of Kaizena Flow's own admin after round 69 that no round has reworked. The Footer editor is the page editor of
round 27; Cookies is built from round 30's parts.

| Page | Before | After |
|---|---|---|
| Status page (`/admin/platform/status`) | 1,603 px | 983 px |
| API (`/admin/platform/integrations/api`) | 1,600 px | 664 px (one screen) |
| Limits (`/admin/platform/plans/limits`, one plan) | 1,332 px | 1,084 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before. Measured on the dev server: the production build
still stops at another change's page (`/no/sign-up/extensions`, ci-red #30).

## Status page

- **One line says what it is,** with the subscribers and *Open the status page* as before.
- **Each part's latest check is a short row** with its state at the end; when it was checked shows from `sm` up.
- **Posting an incident is a row** that opens its form. Ongoing incidents stay above it, each with its update form.

## API

- **One line says what it is:** *Read-only tokens for Kaizena Flow's own tools.*
- **Tokens in use come first.** Making a token (for a platform owner) and using the API are rows under them, opening the form and the
  address, rules and routes.

## Limits

- **One line says what it is,** and a traffic limit says *Only warns* under its name.
- **The table is a list:** each limit one row with its name, then each plan's field and Unlimited on its line (the plan's name above it
  when there is more than the default).

## How this differs from the boards

- **Status page:** the subscribers stay a line of their own and *Open the status page* a button, as the page header draws them.
- **Limits:** the fields stay open in each row instead of a row saying the value that opens its field: the limits are one form, and a
  second set of fields for the phone would post every value twice.

## Platform

These are the platform's own pages; a store's API keys page was reworked before, and stores have no status page or plan limits.

## Tests

- Lint, types and all unit tests pass. No end-to-end spec opens these pages.
