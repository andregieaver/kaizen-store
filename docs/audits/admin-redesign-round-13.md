# Admin redesign, round 13: Subscribers, Email automations, Text messages

Decision D639, 16 November 2026. The boards are on the design canvas of round 13 (today and proposal for each page). Built as drawn,
for Homer first, with Lisa's depth one step away.

## Subscribers (`/admin/{store}/subscribers`)

- A sentence: *Nobody is on your list yet.* and how people join, or *{n} people want your emails.* and how many wait for their link.
- *How people join*, three rows: a sign-up form on the site (how many published pages carry a newsletter form, `newsletterFormPages()`,
  a jsonpath over the published content; none: *Add to the front page*, green while the list is empty), the box at checkout and My account
  (in place while the online shop is on).
- The counters show only when not zero; the list, search and Download stay as they were once there are people.

## Email automations (`/admin/{store}/automations`)

- A sentence: *None is on yet.* and that most shops start with Welcome, or which are on (*Welcome and Win-back are on.*).
- The first lifecycle email still off is marked *Start here* with a green edge and the only main button; the others' *Set it up* is
  secondary. Back in stock keeps its own switch.

## Text messages (`/admin/{store}/text-messages`)

- Before an account is connected: *Texts are not set up.*, then *What you get* (only to people who ticked the box, sent in the daytime,
  paid per text to 46elks), then *Connect 46elks*, which opens the connect form in place, and *Make a 46elks account* (46elks.com).
- Connected, the page is as before.

## What differs from the boards

- Subscribers: Import is not under More: the list has no import of its own (people come from Shopify or WooCommerce through Moving in).
- Automations: the sentence names what is on but not how many emails went this month; each card that is on already says what it sent
  in the last 30 days.

## Platform

Kaizena Flow's own broadcasts and subscribers are its marketing; the same sentence and rows for its subscriber list are the next step. It
sends no text messages and has no back-in-stock email (it sells plans).

## Tests

`e2e/signed-in/text-messages.spec.ts` opens *Connect 46elks* before filling the form.
