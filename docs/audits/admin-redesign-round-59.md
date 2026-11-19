# Admin redesign, round 59: Add a customer, Bring a domain here and Recordings on a phone

Decision D819, 19 November 2026. The boards are on the design canvas of round 59.

These were the tallest store pages on a phone that no round had reworked (Gift cards, Media, Broadcasts, Export products, Roles,
Automations, Content and Heatmaps, as tall, had been).

| Page | Before | After |
|---|---|---|
| Add a customer (`/customers/new`) | 897 px | 733 px |
| Bring a domain here (`/settings/domains/move-in`) | 871 px | 664 px |
| Recordings (`/analytics/recordings`) | 826 px | 700 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Add a customer

- **One line says how they sign in:** *They sign in with a code to their email. Nothing is sent now.*
- **The form's one card has no heading** (Details stays for screen readers).
- **The name and phone share a line under the email**, so *Add customer* is on the first screen. The customer page's form is the
  same form and gets the same line.

## Bring a domain here

- **One line says what it is for:** *Move its DNS, its registration, or both to Kaizena Flow.*
- **The two moves are two rows of one card**, each saying what it waits for: *Connect a domain to the store first* and *Opens soon*,
  or, when it can start, *Your email and site keep working the whole time* and *It then renews with your store*. A move that can
  start opens by itself.

## Recordings

- **One line says what they are:** *Watch visits to see where visitors get stuck. Only you can.*
- **The filters are one line that scrolls** sideways.
- **Each visit is one row:** its time, device, length and pages, then its page with its rage and dead clicks in words, and *Watch* (or
  *Watched*) as a link at its end.

## How this differs from the boards

- **Add a customer:** a Company row came to the form after the boards (another change of the same day); the name and phone share a
  line so the button stays on the first screen.
- **Bring a domain here:** the DNS row opens with *Open*, not a *Domains* link; the line on email and site is the DNS row's sub when it
  can start.
- **Recordings:** *Newest first* keeps its own line under the filters; the filters' fold keeps its name, *Filters*.

## Platform

- Customers and recordings reach Kaizena Flow through its own store (D484): the same pages, so the same change.
- Bringing a domain here stays store-only (`docs/platform-parity.md`): Kaizena Flow's own domain is set in Vercel.

## Tests

- Lint, types and all unit tests pass.
- `customers-staff.spec.ts`, `recordings.spec.ts` and `ab-behaviour.spec.ts` pass against a local build (12 tests). No spec opens
  Bring a domain here.
