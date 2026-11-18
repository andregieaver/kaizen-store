# Admin redesign, round 50: Import redirects, Log a privacy request and Creators on a phone

Decision D765, 18 November 2026. The boards are on the design canvas of round 50.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Import redirects (`/redirects/import`) | 1,216 px | 683 px |
| Log a privacy request (`/privacy/new`) | 1,211 px | 912 px |
| Creators (`/creators`) | 1,189 px | 679 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Import redirects (`RedirectUpload`)

- As Import stock (round 46) and Import products (round 49): every import now reads the same on a phone.
- **One line says what the page is for.**
- **The file's hint is one line:** *Needs Redirect from and Redirect to. Nothing changes until you have seen the check.*
- **How the file is read is a row** (*Paths, refusals, what is replaced*) that opens the five rules.
- **The note on keeping the file is one line.**

## Log a privacy request (`LogRequestForm`)

- **One line says what the page is for:** *For one that came by email, post or phone.*
- **The card's title is read out but not shown,** as the page's title says it.
- **The four fields keep their labels.** Their hints are left out.
- **The deadline is one line:** *Answer within one month of the date received.*
- **How the month is counted is a row under the button** that opens the full text on extensions, weekends and the law.

## Creators (`CreatorSettingsForm`)

- **One line says what the programme is.** Whether it is on is the switch's own word.
- **The programme card shows the switch, the commission and Save.**
- **Categories' own commission and the link's cookie are behind *More choices*.** Their fields are sent either way. A reader, whose
  fieldset is disabled, sees them all.
- **With no creators and no payouts, one line says both.** Otherwise the cards are as before.

## How this differs from the boards

- **Creators:** the board showed the page scrolling sideways. At 390 px it does not: the measurement's flag did not come again, so there
  was nothing to fix.
- **Log a privacy request:** the note keeps its label's own words (*Note (optional, for staff only)*).

## Platform

- Kaizena Flow's own redirects are its store's (D484), which uses these pages, so its import changes with it.
- Kaizena Flow has no privacy requests page of its own and no creator programme: its affiliates are their own programme (D131).

## Tests

- Lint and types pass.
- All unit tests pass.
- `redirects-admin.spec.ts` passes against a local build.
