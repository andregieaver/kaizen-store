# Admin redesign, round 41: Notifications, Local delivery and Pages not found on a phone

Decision D737, 17 November 2026. The boards are on the design canvas of round 41.

Notifications became the tallest store page on a phone after its own sending address was added today (D727). The pages earlier rounds
reworked are left out (the builder's preview, Activity, Customers, Integrations, a new product). That leaves these three:

| Page | Before | After |
|---|---|---|
| Notifications (`/settings/notifications`) | 2,377 px | 699 px |
| Local delivery (`/settings/shipping/local`) | 1,935 px | 989 px |
| Pages not found (`/redirects/404s`) | 1,907 px | 936 px |

Below 640 px wide, each page changes as described here. From 640 px it is as before.

## Notifications (`NotificationList`)

- **Each group is a row of one card** that says how many of its emails go out and opens its list:
  - *Orders · 11 emails, 9 on*.
  - Pickup and local delivery adds *none offered yet* while the store offers neither.
- **Send from your own address is a row after the emails**, saying where emails go from now: Kaizena Flow's address, waiting for a domain,
  or the store's own. It opens the card as it was.
- Staff alerts and *How these emails work* stay as they were.

## Local delivery (`LocalView`, `AreaForm`)

- **One line says what local delivery is.**
- **A new area shows its name, its postal codes and its price**, then *More choices* (*Norge · Postal codes · offered*). That row opens the
  country, postal codes or a distance, the minimum basket, free above, the delivery information and whether it is offered.
- **No areas yet is left out**: the form under it is where the first area is added.
- **Checking a postal code and the note on distances are rows** after the areas.

## Pages not found (`NotFoundTable`, `RedirectsHead`)

- **One line says what the page is.**
- **The five tabs are one choice** on every redirect page (`SelectNav`), and so is the period.
- **Each address is a line** with its requests. The best suggested redirect is one green press, and *More* shows the other targets,
  *Another target* and *Ignore*. An address without a suggestion keeps *Redirect* and *Ignore*.
- An address that is covered or hidden says so on its line.
- **How to read the counts is a row.**

## How this differs from the boards

- **Local delivery:** the card keeps its title *Add an area* rather than *Your first area*.
- **Local delivery:** postal codes keep their larger field.
- **Pages not found:** the two choices are stacked, one under the other, rather than side by side.
- **Pages not found:** *Show the addresses that have a redirect*, *Show the ignored addresses* and *Download as CSV* stay as links under
  them.

## Platform

- Kaizena Flow sends no order, return or delivery emails and has no local delivery: it sells plans.
- Kaizena Flow's own redirects and pages not found are kept by its own store (D484). That store uses these pages, so they change with this round.

## Tests

- Lint, types and all unit tests pass. Seven files time out under the full run's load and pass when run alone.
- The notification, shipping and redirect view tests pass.
- `notifications.spec.ts`, `shipping-handover.spec.ts`, `redirects.spec.ts` and `redirects-admin.spec.ts` pass against a local build.
