---
title: Set up payments
summary: Try your checkout with test payments at once, set up your own Stripe account for real payments, and choose when the customer's card is charged.
track: owners
section: payments
kind: how-to
areas: [payments, setup]
features: []
plans: []
admin: /admin/{store}/settings/payments
order: 10
checked: 2026-11-04
sources: [D15, D17, D20, D289, D292]
---

## How payments work

Shoppers pay your business directly, through your store's own Stripe account, and Stripe pays the money out to your bank. Everything
about payments is set on one page: open **Settings** in the menu and choose [Payments](/admin/{store}/settings/payments), under Selling.
Only the store's owners can open it. **Recent changes**, at the bottom, lists the store's latest recorded changes, with who made them.

## Test payments

A new store takes test payments from the start, with nothing to set up: Kaizena Flow creates a test Stripe account for your store.
**Test payments** on Payments says *Ready* once it is there.

Try your checkout as a shopper would:

1. Put something in the cart in your store and go to the checkout.
2. Pay with the card `4242 4242 4242 4242`, any future date and any CVC.
3. Open **Orders** in the admin: the test order is there. No real money moves.

While the store takes test payments, your storefront says it is in test mode.

## Take real payments

Real payments need your own Stripe account. Set it up when you are ready to open.

1. On Payments, under **Real payments**, press **Set up Stripe**.
2. Answer Stripe's questions on the page: who runs the business and where to send payouts. It takes about ten minutes; have your
   organisation number and bank account ready. Stripe saves your answers as you go, so you can finish later.
3. Wait for Stripe to check your details. The line under **Real payments** says where it is:
   - *Stripe needs a few more details before your store can take payments.* Answer what Stripe still asks.
   - *Stripe is checking your details.* This usually takes minutes, sometimes a day or two.
   - *Ready: your store can take payments.*
4. Under **Checkout**, choose **Live** as the **Mode**, keep **Shoppers can pay** ticked and press **Save**.

From then on shoppers pay with real money. Until your account is ready, the choice reads *Live (set up Stripe above first)* and cannot
be chosen.

> [!NOTE]
> If there is no **Real payments** card and **Checkout** says *Real payments open when Kaizena Flow goes live*, real payments are not
> offered yet. Your store keeps taking test payments until they are.

### Your Stripe account afterwards

Once the account is ready, **Business and bank details** on Payments opens your details at Stripe, such as the bank account payouts go
to. **Open your Stripe Dashboard** leads to Stripe's own pages for payouts, refunds, receipts and payment methods.

To stop taking payments for a while, untick **Shoppers can pay** and press **Save**.

## Choose when the card is charged

The card is charged when the order is placed, unless you choose otherwise. To charge it later, open **Settings**, choose
[Orders](/admin/{store}/settings/orders) under Selling, and under **Take payment** choose:

- **When the order is placed**: the card is charged at checkout. The usual choice.
- **When the order is sent**: the card is held at checkout and charged when you record the first parcel.
- **When you capture it**: the card is held at checkout and charged when you press **Capture** on the order.

Press **Save**. Only the owner can change this, and it applies to orders placed from then on.

### When a card is held

- The order shows *Card held, to capture*. It is not a sale in your figures, and no invoice is issued until you capture.
- On the order, **Capture** charges the card. You can capture less than was held: the rest is released and credited.
  **Cancel and release** cancels the order instead, and nothing is charged.
- A card is held for up to 7 days. You are emailed a day before the hold ends, and an order not captured by then is cancelled and its
  stock released.
- Subscriptions, bookings, deposits, hosts' listings and downloads are always charged at checkout, as are draft orders, order changes,
  exchanges and subscription boxes.

To find the orders waiting, filter **Orders** by **Payment**: *Card held, to capture*.

## More options

### Invoices from Stripe

Under **Checkout**, **Email an invoice (PDF) with each order** has Stripe send one with your business details and the VAT included.
Stripe charges a small fee per invoice. While Kaizena Flow makes your invoices, this is not used: every paid order gets a numbered
invoice from your store instead (see [Invoices and credit notes](/docs/owners/orders/invoices-and-credit-notes)).

### Mollie

When Kaizena Flow offers it, a **Mollie** card on Payments lets you take payments through your own Mollie account instead of Stripe:
PayPal, Vipps, Swish, MobilePay, iDEAL, Bancontact and more.

1. Press **Connect Mollie** and approve Kaizena Flow at Mollie.
2. Under **Shoppers pay with**, choose Mollie for **Test payments**, **Real payments** or both, and press **Save**.
3. Under **Methods at Mollie**, press **Activate** beside a method you want. It shows *Active* once Mollie has switched it on. Vipps and
   MobilePay need your own agreement with them, and Swish a business in the EEA.

Good to know before you connect:

- Shoppers pay on Mollie's own page. Kaizena Flow asks for their name, email and delivery address first.
- Kaizena Flow's fee is taken on each Mollie payment and is not given back when you refund one.
- Subscriptions, deposits and hosts' listings are still paid through Stripe.
- Klarna and other pay-later methods show *Not offered yet*.

**Disconnect Mollie** takes your checkouts back to Stripe.

### Next steps

- [Payment methods](/docs/owners/payments/payment-methods): which methods each country's checkout offers, and wallets.
- [Payouts and fees](/docs/owners/payments/payouts-and-fees): what reaches your bank, and what is taken on the way.
