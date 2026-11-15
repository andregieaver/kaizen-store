# Admin redesign, round 11: Shipping methods and pickup, Customer groups, Countries

Decision D634, 15 November 2026. The boards are on the design canvas of round 11 (today and proposal for each page). Built as drawn,
for Homer first, with Lisa's depth one step away.

## Shipping methods (`/admin/{store}/settings/shipping/methods`) and Pickup

- A sentence: *Every order in Norway pays the flat rate.* while the country has no method, or *{n} ways to deliver in Norway.* and that
  checkout shows them in this order when they cost the same. *Write your own* opens the blank method.
- Ways most shops offer (`src/lib/shipping-ways.ts`): home delivery (2–4 working days), to a pickup point (1–3) and express (next working
  day). *Add it* opens Add a method with `?way=`: the name, in the shop's language since shoppers choose it at checkout, and the delivery
  time filled in (`MethodEditor`'s `start`); the price is the owner's. *Collect from you* opens Pickup.
- Pickup's empty page has *Add a store* and *Add a pickup point* of its own, opening the place form under Company.

## Customer groups (`/admin/{store}/customer-groups`)

- A sentence: *Everyone pays the same price.* or *{n} groups get a better price.*, then what a group gives.
- Groups most shops keep: Wholesale 10 %, Staff 20 %, Regulars 5 %, Friends and family 15 %. *Make it* makes the group in one press
  (the same save as the form) and opens its page, where customers are added and the percentage changed. A group whose name is taken is
  not offered.
- *Make your own* (the header's button opens it) holds the form and what the percentage leaves out.

## Countries (`/admin/{store}/settings/countries`)

- A sentence: *You sell in Norway, in NOK.* or *You sell in {n} countries.*, then what each country gets.
- With one country: *Where you sell* has the country as a row (its currency; reports are in it) with *Change country* opening today's
  28-country form, and *More countries* as a row naming the countries kept, with *Sell in more countries* (owners) to Features.
- With Several countries on, the page is as before (own country, the list to tick, prices worked out per country), under the new sentence.

## What differs from the boards

- *Sell in more countries* opens Features, where Several countries is switched on, rather than switching it on in place: the switch has
  its own checks and notes there.
- Customer groups: *Make it* opens the new group's page (the save redirects there), so the owner adds its customers next.
- The ready buttons: the first is green only while nothing of its kind exists; the others are secondary.

## Platform

Kaizena Flow sells plans through Stripe: it has no shipping, customer groups or selling countries of this kind. Nothing to carry over.

## Tests

Typecheck, lint and unit tests; `e2e/signed-in/markets-in-depth.spec.ts` (Several countries on) reads the page as before.
