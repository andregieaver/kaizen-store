# Admin redesign, round 65: Kaizena Flow's Duty rates, Content notices and Usage and limits on a phone

Decision D832, 19 November 2026. The boards are on the design canvas of round 65.

The next tallest pages of Kaizena Flow's own admin after round 64.

| Page | Before | After |
|---|---|---|
| Duty rates (`/admin/platform/duty-rates`) | 5,610 px | 2,512 px |
| Content notices (`/admin/platform/reports`) | 4,333 px | 1,795 px |
| Usage and limits (`/admin/platform/capacity`) | 4,175 px | 1,166 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Duty rates

- **One line says what it is:** *What every customs estimate is worked out from. Not customs advice.*
- **Each row is one line** in place of the table: who it is for (*EU Base row · Any origin · VAT not collected at the sale*), then its
  threshold or rate, when it applies and whether it is verified. It opens its source, the day it was read, its note and Verify,
  Edit and Remove. The source and the actions are one component each, shown in the table and in the row.

## Content notices

- **One line says what it is:** *Notices about content on stores. The sender is told what you decide.* The count stays above it.
- **Each waiting notice is one row:** its kind and when it came, then the AI's urgency and the store, with *Decide* opening the
  notice, the AI's reading and the decision. The AI check of listings and the decided notices are as before.

## Usage and limits

- **One line says what it is:** *What every store used this month, measured each night.*
- **The database stays a card**; every other reading (owners' style text, flags, recordings, scheduled jobs, cache refreshes, speed,
  cold starts, the admin from Dublin) is a row of one card, opening its explanation and table.

## How this differs from the boards

- **Usage and limits:** the rows say their name only, not their state in a line; the state needs each reading's own words.
- **Content notices:** no link to the decided notices; they stay a card under the AI check.

## Platform

These are the platform's own pages; stores have none of them.

## Tests

- Lint, types and all unit tests pass.
- `customs.spec.ts` and `platform-reports.spec.ts` pass against a local build (4 tests).
