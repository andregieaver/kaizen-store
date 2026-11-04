---
title: Gift cards
summary: Sell gift cards in your store, issue one by hand, and see what customers hold, each card's history and its balance.
track: owners
section: marketing
kind: how-to
areas: [marketing, products, payments]
features: [gift_cards]
plans: []
admin: /admin/{store}/gift-cards
order: 30
checked: 2026-11-04
sources: [D178, D300, D381]
---

## Switch gift cards on

Gift cards are off until you switch them on: open **Settings**, choose [Features](/admin/{store}/settings/features) and switch on
**Gift cards**.

If you switch them off later, gift cards can no longer be bought. Cards already sold or issued can still be spent and refunded, since
the money is the customer's, and the Gift cards page stays.

## Sell gift cards

1. Open **Products** in the menu and press **Add product**.
2. Under **What is it?**, choose **A gift card**.
3. Give it one variant for each amount you sell. A variant's price in each country is what the card is worth there.
4. Publish it as any other product.

On the product page, the shopper chooses the amount. To give it, they tick **Send it to someone** and fill in the person's email and
name, who it is from, a message and the day to send it, from today to a year ahead. The card is emailed to that person on the day,
from 08:00 in your store's time zone, and the buyer is told it is on its way. Otherwise it is emailed to the buyer at once.

A card is made when its order is paid. Its code is in the email only: Kaizena Flow keeps only a fingerprint of it, so nobody can read a
code back, staff included.

### What is different about a gift card

- **No VAT on the sale.** A gift card is a multi-purpose voucher: VAT is charged on the goods when it is spent, and the invoice says so.
- **Nothing comes off it.** Campaigns, discount codes, group discounts and bonus credits never reduce a gift card, and it does not count
  towards a minimum or towards free shipping.
- **A withdrawal.** The buyer may withdraw from a card within 14 days while nothing of it is spent; the card is then deactivated and
  refunded ([Returns and withdrawals](/docs/owners/orders/returns-and-withdrawals)).
- **Test payments.** Cards bought while your store takes test payments are test cards and cannot be spent with real payments.

## How shoppers spend them

In the cart and at checkout, beside the discount code, shoppers type the **Gift card code** and press **Use**. An order can take up to
three cards.

- A card pays like money. The order's total and its VAT stay the same; the cards pay first, and the rest is paid as usual. When the
  cards pay it all, there is no payment page.
- A card holds one currency and pays only in it.
- A card cannot pay for another gift card or a subscription.
- When you refund an order paid with a card, the card's part goes back on the card. The shopper's other money is refunded first.

A wrong code gets only *This gift card can't be used*, never whether such a code exists.

## The Gift cards page

Open **Products** and choose [Gift cards](/admin/{store}/gift-cards). At the top, **Customers hold** shows what is on the cards now, per
currency. Under **All cards**, search by the last four characters of a code, an order number or, if you may see customers, a person, and
filter by state: *Not sent yet*, *Active*, *Spent*, *Expired* or *Deactivated*.

Open a card to see its value and what is left, when it expires, how it came to be, its whole history and the orders it paid for.

### Issue a gift card by hand

1. Press **Issue a gift card**.
2. Give the **Amount** and the **Currency**, one your store sells in.
3. Under **Who it is for (optional)**, give their email, and the code is sent there, with their name, a message and the language of the
   email.
4. Under **Why it is issued**, write a note for your own records, such as a make-good for an order. They do not see it.
5. Press **Issue the gift card**.

The code is shown once, here: press **Copy the code** if you will pass it on yourself. Issuing, changing and deactivating cards needs
the right to change products.

### Change a card

On a card's page:

- **Change the balance**: **Add** or **Take off** an amount, and say **Why**. The reason is kept with the change. A card never goes
  below zero.
- **Deactivate**: the card can never be spent again, and what is left on it goes. Orders it already paid for keep their money.
- **A new code**, for a code that was lost or seen by someone it was not for: tick **Stop the old code and make a new one** and press
  **Send a new code**. The old code stops at once and the balance stays. The new code is emailed to the address the card went to, or
  shown to you once to pass on.
- **Try sending it again**, for a bought card whose email did not go.

### How long cards last

Under **How long cards last**, choose how long **New cards last**: from 1 to 10 years, or *Never*. New stores start at 3 years. A card
keeps the date it was issued with, and what is left on it when it expires goes. Many countries expect at least three years: check
yours.

## In your figures

A gift card sold is not a sale until it is spent. **Analytics**, **Finance** leaves gift cards sold out of your sales and shows what
customers hold on them, per currency, with what was issued, spent, refunded back and expired in the period
([Analytics](/docs/owners/analytics/analytics)).
