# Admin redesign, round 47: Setup, Cart reminders and Redirects on a phone

Decision D755, 18 November 2026. The boards are on the design canvas of round 47.

These were the tallest store pages on a phone that no round had reworked. A new article (1,323 px) was passed over: it uses the page
editor that rounds 27 and 45 reworked. `/experiments/variants` (1,552 px) only leads to the A/B tests of round 37.

| Page | Before | After |
|---|---|---|
| Setup, "What will you sell?" (`/setup/features`) | 1,595 px | 975 px |
| Cart reminders (`/cart-reminders`) | 1,315 px | 824 px |
| Redirects (`/redirects`) | 1,303 px | 664 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Setup, "What will you sell?" (`FeatureQuestion`)

- **One line says what the step is for:** *Change it later under Settings, Features.*
- **Each answer is its name.** Its words show once it is ticked, so the answer ticked for you says what it is. This is done in CSS
  (`group-has-checked`), so the step still works without a script.
- **The closing note is left out.** The line under the title says it.
- Save and continue, the Dream Factory link and Skip for now stay.

## Cart reminders

- **One line says what the page is for.**
- **While reminders are off, the card says what turning them on does in one line:** *On, three go: after an hour, a day and three
  days.*
- **The four figures of the last 30 days are one card,** its cells divided by lines.
- **With no reminders and no carts, one line says both:** *None yet. No carts with an email either.* The empty cards, and the Latest
  carts section, are left out on a phone.
- **For your privacy policy is a row** (*What to tell shoppers*) that opens the text.

## Redirects

- **One line says what the page is for:** *Old addresses that lead to new ones. Kaizena Flow makes its own.*
- **Add a redirect is a row that opens the form.** *Many addresses at once?* is a row to the import.
- **The search is left out while there is nothing to search.**
- **An empty list is a line, not a card.**
- **The warning that redirects are permanent is the page's last line.**

## How this differs from the boards

- **Setup:** the steps across the top stay as they are. The Dream Factory link keeps its words.
- **Cart reminders:** *Reminders are off* stays a card with its button, not a strip. *The last 30 days* keeps its heading.
- **Redirects:** *Your redirects* keeps its count's full words (*0 of 100,000 manual redirects*). The link to the pages not found is
  reached through the page choice above, not from the empty line.

## Platform

- Kaizena Flow's own redirects are kept by its own store (D484), which uses these pages, so they change with this round.
- Kaizena Flow has no setup wizard of its own and sells plans, not carts: it sends no cart reminders.

## Tests

- Lint and types pass.
- All unit tests pass.
- `store-features-onboarding.spec.ts`, `sign-up.spec.ts` and `redirects-admin.spec.ts` pass against a local build.
