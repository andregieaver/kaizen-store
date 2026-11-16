# Admin redesign, round 23: the first settings on a phone

Decision D688, 16 November 2026. The boards are on the design canvas of round 23 (today at 390 px and a phone proposal for each page).
On a phone Settings was eleven separate cards before the rest; Company's card of what is missing asked for six fields though three were
missing; Languages and currencies opened on four paragraphs of how it works before what is chosen. Tax (round 15) and Countries, short
already, were left as they are.

## Settings (`SettingsHub`, the store's and the platform's)

- On a phone each group (Get paid, Sell and deliver, Your business and team, Look and legal) is one card of rows: each row keeps its icon,
  its state and its arrow, without a card and a gap of its own. From 640 px the tiles are as before. The set-up card and Everything
  else are unchanged.

## Company (`/admin/{store}/settings/company`)

- The card of what is missing asks only for what is (legal name, registered address, country: `BusinessDetailsFields` with `only`), the
  rest sent as it is, hidden; *Save business details* is wide on a phone.
- *Store name and contact* is a row with *Change* whether or not something is missing, opening every field.

## Languages and currencies (`/admin/{store}/settings/localization`)

- One line under the title (*Shoppers read Norsk bokmål and pay in NOK.*); the paragraphs on how it works are behind *How languages and
  currencies work* at the end.
- While Several languages is off: a row *Language* (the main language and any country's own) that opens the form, and *More languages*
  with *Offer more*, which switches the feature on here (`switchOnFromPageAction`, the owner's, as Gift cards since round 12).
- While Several currencies is off: *Each country's currency* (set under Countries, linked) and *More currencies* with *Offer more*.
- With them on, the tables are as before.

## What differs from the boards

- Main language and each country's language are one row (*Language*): they are saved together by one form.
- Company's organisation number is in the contact row's form, not a row of its own.

## Platform

The hub is shared, so Platform → Settings gets the phone rows too. Kaizena Flow's own site has its languages under Platform → Languages
(D312) and its business details on Platform → Settings; they keep their pages.

## Tests

No spec reads these pages' changed words or fields.
