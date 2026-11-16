# Admin redesign, round 22: a new coupon, notifications and gift cards on a phone

Decision D687, 16 November 2026. The boards are on the design canvas of round 22 (today at 390 px and a phone proposal for each page).
On a phone a new coupon was four cards and about 2,400 px of radio buttons, dates and tick boxes before Save code; Notifications was
5,300 px, every email with its trigger, its law and a line per language; Gift cards, while off, said it was off twice.

## A new coupon, or changing one (`DiscountEditor`, `/admin/{store}/discounts/new` and `/{id}`)

- The code with *Suggest* (SAVE15, OFF100, FREESHIP from what it gives, in the admin's words), and what it gives as three choices side by
  side (still radios), then its amount.
- What it applies to, Who, When and how often, and With other codes are one card of rows (`FoldRow`): each says what is chosen
  (*Everything, no minimum*, *Every shopper who has the code*, *From now, no end, no limit*, *Alone, works with campaigns*) and opens its
  choices in place with *Change*. Every choice is kept, only folded.
- The button names the code (*Save WINTER15*), wide on a phone, on the first screen.

## Notifications (`/admin/{store}/settings/notifications`)

- One line under the title (*The emails customers get. Tap one to change its words.*); the long words, and what Kaizena Flow always adds,
  are behind *How these emails work* at the end.
- Each group says how many of its emails go out (*Orders · 11 emails, 9 on*); each email is one line: its name (the link to its page),
  *your words* when the store wrote its own, and a switch (`SwitchButton`, `role="switch"`, named for what pressing it does) or *Always on*
  / *Fixed*. When it is sent, why it is required and the languages are on the email's own page, which already said them.

## Gift cards while off (`/admin/{store}/gift-cards`)

- No lead and no *Issue a card* button above the offer: one card with the three amounts a shop usually sells, what selling them gives, a
  wide *Sell gift cards* and what pressing it does under it.
- *How cards work* says once that cards already sold or issued can still be spent, and *Issue a card* is a row there.
  With gift cards on, the page is as before.

## What differs from the boards

- The three amounts are pictures of what a shop usually sells, not a product the button makes: *Sell gift cards* switches them on, and the
  product is made after, as before (the words under the button say so).
- The notification rows keep *Always on* rather than *Always*.

## Platform

Kaizena Flow's own emails (Platform → Emails, round 16) and its plan offers (round 16) keep their pages; its coupons are the plan offers.
Gift cards and the customer notifications are store-only: Kaizena Flow sells plans through Stripe, with no orders, parcels or returns.

## Tests

`notifications-views.test.ts` counts switches by `role="switch"` and finds *your words*; `e2e/signed-in/notifications.spec.ts` finds the
switches by role and *Order sent your words*; `e2e/signed-in/segments.spec.ts` opens the *Who* row and presses *Save {code}*.
