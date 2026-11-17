# Admin redesign, round 43: Support settings, Text messages and Producer responsibility on a phone

Decision D740, 17 November 2026. The boards are on the design canvas of round 43.

These were the tallest store pages on a phone that no round had reworked.

| Page | Before | After |
|---|---|---|
| Support settings (`/support/settings`) | 1,851 px | 939 px |
| Text messages (`/text-messages`) | 1,822 px | 775 px |
| Producer responsibility (`/settings/producer-responsibility`) | 1,739 px | 1,036 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Support settings (`SupportSettingsForm`, `SupportEmailCard`)

- **Who answers, When nobody is there and Opening hours are rows of one card.** Each says what is chosen: *The AI first, then your team*,
  *Answer by email · team told after 5 min*, *Not shown*.
- Advanced stays a fold under the rows. Save follows it.
- **Support by email is a row** saying where to forward to, or that it is not set up.
- Kaizena Flow's own support settings use the same form and card, so they change the same way.

## Text messages

- **One line says what the page is for.**
- The texts are as they were.
- **Who gets texts is a row** with its counts, opening the numbers.
- **Account and rules is a row**: *E2EShop · 09:00 to 20:00 · up to 500.00 SEK*.

## Producer responsibility (`ProducerRegistrationForm`)

- **One line says what the page is for.**
- **Nothing held back and no registrations yet are one card** while both are true. Otherwise the two cards are as before.
- **A new registration** shows the scheme and the country side by side, then the number, registered with and the first day.
- ***More*** opens the rest: registered or not needed, whether the number is shown, the last day. Its line names them. It opens by itself
  for an edit, and when the browser finds a field empty.

## How this differs from the boards

- **Support settings:** the note on what an AI reads keeps its full words. A shorter line would have taken the support area's words over
  their budget (`admin-words-handed.scan.test.ts`), so the page uses existing words where it could.
- **Support settings:** Advanced stays a fold, not a row.
- **Producer responsibility:** *Registered with* stays open, because the form requires it.
- **Producer responsibility:** the note that numbers are not checked stays a line.
- **Text messages:** New text message keeps its place under the title, and the month's cost its own line.

## Platform

- Kaizena Flow's support settings share the form, so they get the rows too.
- Kaizena Flow sends no text offers and sells no goods under producer responsibility: it sells plans.

## Tests

- Lint and types pass.
- All unit tests pass. Seven files time out under the full run's load and pass when run alone.
- `agents-privacy.spec.ts`, `producer-responsibility.spec.ts` and `text-messages.spec.ts` pass against a local build. The
  text-messages spec read the counts twice at first. The row now joins them with commas, so the desktop card's line is the only exact
  match.
