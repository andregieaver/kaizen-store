# Admin redesign, round 32: Activity, Analytics and the chat agent on a phone

Decision D706, 17 November 2026. The boards are on the design canvas of round 32.

The tallest store pages on a phone after round 31:

| Page | Before | After |
|---|---|---|
| Activity log | 3,849 px | 1,691 px |
| How you're doing (analytics overview) | 2,995 px | 1,740 px |
| Chat agent | 2,909 px | 963 px |

Below 640 px wide, each page changes as described here; from 640 px it is as before. Measuring also found the new A/B test page
722 px wide on a 390 px phone; it is fixed in this round.

## Activity log (`ActivityList`, the store's and the platform's)

- **A run is one row.** A run is changes one after another by the same person, made the same way (themselves, the AI manager or the
  autopilot), in the same area, at most ten minutes apart (`activityRuns()`).
  - The row names the kinds of change, with how many of each, the first two by name: *Integration: api token revoked (3),
    Integration: api token made (3)*.
  - Under it: who, when and how many changes.
  - *Show* opens each entry, unaltered, with its Details.
- **Paging:** the first 20 rows show, then *Show 20 more* (`PhoneMore`). *Older entries* follows once every row of the page is shown.
- **The line under the title** is the week alone. What is kept, and who sees what, goes under the list, after *More filters and
  download*.

## How you're doing (`/admin/{store}/analytics`)

- **The four figures share one card**, two by two, with a line between them. Each shows its value and the change against the
  previous period, without its trend line or last year's change (`KpiCard` `phoneCompact`).
- **Two rows replace two sections:**
  - *Steps to see more*, saying what they give (*What your products cost · Visit counting*), with *Start*.
  - *Best sellers*, naming the first and how many follow, with *Open*.

## Chat agent (`ChatAgentView`, the store's and the platform's)

- **First:** whether the chat is on.
  - Off without a model: an amber card with *Choose a model*.
  - Off with one: how to switch it on.
  - On: who answers.
- **Then the form's parts as rows that say what is set:**
  - The agent (*Off · No name yet · no picture*)
  - Greeting
  - Guidance
  - Let visitors talk
  - Messages a day
- **After the rows:** one wide Save, then the knowledge base as a row (*0 documents · the site's pages are read anyway*), and *How it
  works* as the last row.

## New A/B test

- The *More goals* link names all its goals and could not wrap; it now wraps at every width.

## How this differs from the boards

- **Analytics:** *Needs you today* is as before. It is the alerts' own view, shared with Home's, and folding it into one strip is its
  own step. The sales chart keeps its axes.
- **Activity:** a run's line names the kinds of change in the log's own words (*Customer: data exported, Customer: tag added and 3
  more*), not a summary the code would have to invent (*Articles: 5 saved, 3 published*).
- **Activity:** in the test data the page holds fewer than 20 rows once runs are folded, so *Show 20 more* does not appear there; the
  unit test draws it.

## Platform

- The platform's activity log uses the same list, so its runs fold and its rows page in 20s too.
- The platform's chat agent uses the same view, so it gets the status card and the rows.
- The platform has no shop analytics of this kind.

## Tests

- Unit tests cover the runs, their titles, and the rows kept back.
- Lint, types and all unit tests pass.
